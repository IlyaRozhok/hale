import { Inject, Injectable, Optional, type OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";
import { Account, Job, Transaction } from "../db/entities";
import { JOB_CLOCK, type JobClock, JobRunner, isFinalFailure } from "./jobs/job-runner";
import { MonoClient } from "./mono.client";
import type { MonoClientInfo, MonoStatementItem } from "./mono.schemas";
import { ReclassifyService } from "../transactions/reclassify.service";
import { CURRENCY_ALPHA } from "../domain/money";
import { planWindows, splitWindow } from "./windows";

export const WINDOW_JOB_KIND = "history.window";
/**
 * monobank's docs name no row cap; a response this large is treated as possibly truncated
 * and the window is halved. This threshold is our own decision.
 */
export const SPLIT_THRESHOLD = 500;

const ACCOUNT_KINDS = new Set(["black", "white", "fop"]);

const kyivDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Kyiv",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface WindowPayload {
  accountId: string; // monobank id (accounts.external_id)
  from: number;
  to: number;
}

export const currencyName = (code: number) => CURRENCY_ALPHA[code] ?? `#${code}`;

@Injectable()
export class ImportService implements OnModuleInit {
  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(MonoClient) private readonly client: MonoClient,
    @Inject(JobRunner) private readonly runner: JobRunner,
    @Inject(JOB_CLOCK) private readonly clock: JobClock,
    @Optional() @Inject(ReclassifyService) private readonly reclassifier?: ReclassifyService,
  ) {}

  onModuleInit(): void {
    this.runner.register(WINDOW_JOB_KIND, (job) => this.runWindow(job));
  }

  /** Syncs accounts and jars, then queues one job per statement window since `from`. */
  async enqueueHistory(from: Date): Promise<void> {
    const toSec = Math.floor(this.clock.now() / 1000);
    const fromSec = Math.floor(from.getTime() / 1000);
    const accountIds = await this.syncAccounts();
    for (const id of accountIds) {
      for (const [wFrom, wTo] of planWindows(fromSec, toSec)) {
        await this.enqueueWindow({ accountId: id, from: wFrom, to: wTo });
      }
    }
  }

  /**
   * Upserts accounts and jars (balance, credit limit) from client-info, which is fetched
   * unless the caller already has it. Returns the monobank ids it wrote.
   */
  async syncAccounts(info?: MonoClientInfo): Promise<string[]> {
    const data = info ?? (await this.client.clientInfo());
    const balanceAt = new Date(this.clock.now());
    const accounts = [
      ...data.accounts.map((a) => ({
        id: a.id,
        kind: ACCOUNT_KINDS.has(a.type) ? a.type : "other",
        currency: currencyName(a.currencyCode),
        balance: a.balance,
        creditLimit: a.creditLimit,
        iban: a.iban ?? null,
        title: null as string | null,
      })),
      ...data.jars.map((j) => ({
        id: j.id,
        kind: "jar",
        currency: currencyName(j.currencyCode),
        balance: j.balance,
        creditLimit: 0,
        iban: null,
        title: j.title,
      })),
    ];
    for (const a of accounts) {
      await this.ds.query(
        `INSERT INTO accounts (external_id, kind, currency, balance, credit_limit, balance_at, iban, title)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (external_id) DO UPDATE
           SET kind=EXCLUDED.kind, currency=EXCLUDED.currency, balance=EXCLUDED.balance,
               credit_limit=EXCLUDED.credit_limit, balance_at=EXCLUDED.balance_at,
               iban=COALESCE(EXCLUDED.iban, accounts.iban), title=COALESCE(EXCLUDED.title, accounts.title)`,
        [a.id, a.kind, a.currency, a.balance, a.creditLimit, balanceAt, a.iban, a.title],
      );
    }
    return accounts.map((a) => a.id);
  }

  private async enqueueWindow(p: WindowPayload): Promise<void> {
    const payload = JSON.stringify({ accountId: p.accountId, from: p.from, to: p.to });
    await this.ds.query(
      `INSERT INTO jobs (kind, payload, run_after)
       SELECT $1, $2::jsonb, $3
        WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE kind=$1 AND payload=$2::jsonb AND status <> 'failed')`,
      [WINDOW_JOB_KIND, payload, new Date(this.clock.now())],
    );
  }

  private async runWindow(job: Job): Promise<void> {
    try {
      await this.importWindow(job);
    } catch (e) {
      // The history that did arrive still gets classified, even if the last window gives up.
      if (isFinalFailure(job, e)) await this.reclassifyAfterLastWindow(job.id);
      throw e;
    }
  }

  private async importWindow(job: Job): Promise<void> {
    const { accountId, from, to } = job.payload as WindowPayload;
    const account = await this.ds.getRepository(Account).findOneByOrFail({ external_id: accountId });
    const items = await this.client.statement(accountId, from, to);

    if (items.length >= SPLIT_THRESHOLD) {
      const halves = splitWindow(from, to);
      if (halves) {
        for (const [f, t] of halves) await this.enqueueWindow({ accountId, from: f, to: t });
        return;
      }
    }
    const ids: number[] = [];
    for (const item of items) ids.push((await this.upsertRow(account.id, item)).id);
    await this.reclassifier?.reclassifyIds(ids);
    await this.reclassifyAfterLastWindow(job.id);
  }

  /** Once no other history window is waiting or running, queue a whole-history reclassify. */
  private async reclassifyAfterLastWindow(thisJobId: number): Promise<void> {
    if (!this.reclassifier) return;
    const rows: { n: number }[] = await this.ds.query(
      `SELECT count(*)::int AS n FROM jobs WHERE kind=$1 AND id<>$2 AND status IN ('pending','running')`,
      [WINDOW_JOB_KIND, thisJobId],
    );
    if (rows[0]?.n === 0) await this.reclassifier.enqueue(new Date(this.clock.now()));
  }

  /**
   * Upserts one item and classifies it (type and category are never taken from the bank).
   * `live` is set only for an item that has just happened (the webhook): the account's stored credit
   * limit is then the limit at the moment of the operation and is kept with a new row. A row found later
   * (history, the daily check) may be days old, when the limit could have been different, so it gets none.
   */
  async upsertStatementItem(accountId: number, item: MonoStatementItem, opts: { live?: boolean } = {}): Promise<Transaction> {
    const tx = await this.upsertRow(accountId, item, opts.live ?? false);
    if (!this.reclassifier) return tx;
    await this.reclassifier.reclassifyIds([tx.id]);
    return this.ds.getRepository(Transaction).findOneByOrFail({ id: tx.id });
  }

  private async upsertRow(accountId: number, item: MonoStatementItem, live = false): Promise<Transaction> {
    const account = await this.ds.getRepository(Account).findOneByOrFail({ id: accountId });
    let fxRate: number | null = null;
    let amountUah: number | null = item.amount;
    if (account.currency !== "UAH") {
      const rows: { rate: string }[] = await this.ds.query(
        `SELECT rate FROM fx_rates WHERE currency=$1 ORDER BY fetched_at DESC LIMIT 1`,
        [account.currency],
      );
      fxRate = rows[0] ? Number(rows[0].rate) : null;
      amountUah = fxRate === null ? null : Math.round(item.amount * fxRate);
    }
    const occurredAt = new Date(item.time * 1000);

    // type, category, type_source and credit_limit_at are only set on insert; later syncs never overwrite them.
    await this.ds.query(
      `INSERT INTO transactions
         (external_id, account_id, occurred_at, local_date, description, comment, mcc,
          amount, amount_uah, fx_rate, hold, counter_iban, counter_name, type_source, raw,
          balance_after, credit_limit_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'auto',$14,$15,$16)
       ON CONFLICT (external_id) DO UPDATE SET
         description=EXCLUDED.description, comment=EXCLUDED.comment, mcc=EXCLUDED.mcc,
         amount=EXCLUDED.amount,
         amount_uah=CASE
           WHEN transactions.fx_rate IS NOT NULL
             THEN ROUND(EXCLUDED.amount * transactions.fx_rate)::bigint
           ELSE EXCLUDED.amount_uah
         END,
         fx_rate=COALESCE(transactions.fx_rate, EXCLUDED.fx_rate),
         hold=EXCLUDED.hold, counter_iban=EXCLUDED.counter_iban,
         counter_name=EXCLUDED.counter_name, raw=EXCLUDED.raw, balance_after=EXCLUDED.balance_after`,
      [
        item.id,
        accountId,
        occurredAt,
        kyivDate.format(occurredAt),
        item.description,
        item.comment ?? null,
        item.mcc,
        item.amount,
        amountUah,
        fxRate,
        item.hold,
        item.counterIban ?? null,
        item.counterName ?? null,
        JSON.stringify(item),
        item.balance,
        live ? account.credit_limit : null,
      ],
    );
    return this.ds.getRepository(Transaction).findOneByOrFail({ external_id: item.id });
  }
}
