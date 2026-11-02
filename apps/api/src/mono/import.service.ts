import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";
import { Account, Job, Transaction } from "../db/entities";
import { JOB_CLOCK, type JobClock, JobRunner } from "./jobs/job-runner";
import { MonoClient } from "./mono.client";
import type { MonoStatementItem } from "./mono.schemas";
import { planWindows, splitWindow } from "./windows";

export const WINDOW_JOB_KIND = "history.window";
/**
 * monobank's docs name no row cap; a response this large is treated as possibly truncated
 * and the window is halved. This threshold is our own decision.
 */
export const SPLIT_THRESHOLD = 500;

const CURRENCY_CODES: Record<number, string> = {
  980: "UAH", 840: "USD", 978: "EUR", 826: "GBP", 985: "PLN", 756: "CHF", 203: "CZK",
};
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

export const currencyName = (code: number) => CURRENCY_CODES[code] ?? `#${code}`;

@Injectable()
export class ImportService implements OnModuleInit {
  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(MonoClient) private readonly client: MonoClient,
    @Inject(JobRunner) private readonly runner: JobRunner,
    @Inject(JOB_CLOCK) private readonly clock: JobClock,
  ) {}

  onModuleInit(): void {
    this.runner.register(WINDOW_JOB_KIND, (job) => this.runWindow(job));
  }

  /** Syncs accounts and jars, then queues one job per statement window since `from`. */
  async enqueueHistory(from: Date): Promise<void> {
    const info = await this.client.clientInfo();
    const toSec = Math.floor(this.clock.now() / 1000);
    const fromSec = Math.floor(from.getTime() / 1000);
    const balanceAt = new Date(this.clock.now());

    const accounts = [
      ...info.accounts.map((a) => ({
        id: a.id,
        kind: ACCOUNT_KINDS.has(a.type) ? a.type : "other",
        currency: currencyName(a.currencyCode),
        balance: a.balance,
        creditLimit: a.creditLimit,
      })),
      ...info.jars.map((j) => ({
        id: j.id,
        kind: "jar",
        currency: currencyName(j.currencyCode),
        balance: j.balance,
        creditLimit: 0,
      })),
    ];
    for (const a of accounts) {
      await this.ds.query(
        `INSERT INTO accounts (external_id, kind, currency, balance, credit_limit, balance_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (external_id) DO UPDATE
           SET kind=EXCLUDED.kind, currency=EXCLUDED.currency, balance=EXCLUDED.balance,
               credit_limit=EXCLUDED.credit_limit, balance_at=EXCLUDED.balance_at`,
        [a.id, a.kind, a.currency, a.balance, a.creditLimit, balanceAt],
      );
      for (const [wFrom, wTo] of planWindows(fromSec, toSec)) {
        await this.enqueueWindow({ accountId: a.id, from: wFrom, to: wTo });
      }
    }
  }

  private async enqueueWindow(p: WindowPayload): Promise<void> {
    const payload = JSON.stringify({ accountId: p.accountId, from: p.from, to: p.to });
    await this.ds.query(
      `INSERT INTO jobs (kind, payload, run_after)
       SELECT $1, $2::jsonb, $3
        WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE kind=$1 AND payload=$2::jsonb)`,
      [WINDOW_JOB_KIND, payload, new Date(this.clock.now())],
    );
  }

  private async runWindow(job: Job): Promise<void> {
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
    for (const item of items) await this.upsertStatementItem(account.id, item);
  }

  async upsertStatementItem(accountId: number, item: MonoStatementItem): Promise<Transaction> {
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

    // type, category and type_source are only set on insert; later syncs never overwrite them.
    await this.ds.query(
      `INSERT INTO transactions
         (external_id, account_id, occurred_at, local_date, description, comment, mcc,
          amount, amount_uah, fx_rate, hold, counter_iban, counter_name, type_source, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'auto',$14)
       ON CONFLICT (external_id) DO UPDATE SET
         description=EXCLUDED.description, comment=EXCLUDED.comment, mcc=EXCLUDED.mcc,
         amount=EXCLUDED.amount,
         amount_uah=COALESCE(EXCLUDED.amount_uah, transactions.amount_uah),
         fx_rate=COALESCE(EXCLUDED.fx_rate, transactions.fx_rate),
         hold=EXCLUDED.hold, counter_iban=EXCLUDED.counter_iban,
         counter_name=EXCLUDED.counter_name, raw=EXCLUDED.raw`,
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
      ],
    );
    return this.ds.getRepository(Transaction).findOneByOrFail({ external_id: item.id });
  }
}
