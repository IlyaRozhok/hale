import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { LedgerCheckDto, LedgerCheckIssueDto } from "@hale/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { APP_CONFIG } from "../config.module";
import type { AppConfig } from "../config";
import { walletBalance, walletChangesSql } from "../cash/wallet";
import type { TxType } from "../domain/classify";
import { type AccountKind, type LedgerContext, type LedgerRow, limitSpentByDay } from "../domain/ledger";
import {
  CHECK_INVARIANTS,
  type ChainRow,
  type CheckInvariant,
  bankBalanceCheck,
  cashWalletCheck,
  categoriesCheck,
  daySpentCheck,
  loneLegsCheck,
} from "../domain/ledger-check";
import { addDays, kyivDate } from "../domain/money";
import { ownPairSql } from "../domain/own-pair";
import { Clock, KYIV_TZ, kyivDaySql } from "../time/clock";
import { counterKeySql } from "../transactions/counter-key";
import { ScreenSpent } from "./screen-spent";

/** Invariants 3 and 4 look at the last 30 Kyiv days, today included. */
export const CHECK_WINDOW_DAYS = 30;
/** Runs older than this are deleted after each run. */
export const CHECK_KEEP_DAYS = 30;
/** A nightly result older than this is not shown: the app says nothing rather than an old «всё сходится». */
export const CHECK_FRESH_DAYS = 2;
const DAY_MS = 86_400_000;

interface ResultRow {
  invariant: CheckInvariant;
  ok: boolean;
  accountId: number | null;
  amount: number;
  since: string | null;
  details: Record<string, unknown>;
}

const byDay = (rows: { date: string; spent: number }[]): Map<string, number> => new Map(rows.map((r) => [r.date, r.spent]));

/**
 * Task Б11: the ledger check (audit 6.5, step 2, invariants 1-4 and 7). It reads the accounting tables in one
 * read-only transaction, compares through the pure functions of domain/ledger-check.ts and writes only its own
 * table, ledger_checks. It changes nothing about how money or the limit is counted.
 */
@Injectable()
export class LedgerCheckService {
  private readonly log = new Logger(LedgerCheckService.name);

  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ScreenSpent) private readonly screens: ScreenSpent,
  ) {}

  get enabled(): boolean {
    return this.config.LEDGER_CHECK_ENABLED === true;
  }

  /** Nightly, after the bank reconcile at 04:00. Does nothing while LEDGER_CHECK_ENABLED is off; true when it ran. */
  @Cron("0 5 * * *", { timeZone: KYIV_TZ })
  async scheduledRun(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      await this.run(true);
    } catch (e) {
      this.log.error(`ledger check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return true;
  }

  /**
   * Runs every check now and stores the result; a run of the same kind at the same moment replaces the earlier one.
   * Only nightly (`scheduled`) runs are shown in the app; a run by hand answers with its result and is kept for history.
   */
  async run(scheduled = false): Promise<LedgerCheckDto> {
    const now = this.clock.now();
    const rows = await this.ds.transaction("REPEATABLE READ", async (m) => {
      await m.query(`SET TRANSACTION READ ONLY`);
      return this.check(m, kyivDate(now));
    });
    await this.ds.transaction(async (m) => {
      await m.query(`DELETE FROM ledger_checks WHERE (ran_at = $1 AND scheduled = $3) OR ran_at < $2`, [
        now,
        new Date(now.getTime() - CHECK_KEEP_DAYS * DAY_MS),
        scheduled,
      ]);
      for (const r of rows) {
        await m.query(
          `INSERT INTO ledger_checks (ran_at, scheduled, invariant, ok, account_id, amount, since, details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [now, scheduled, r.invariant, r.ok, r.accountId, r.amount, r.since, JSON.stringify(r.details)],
        );
      }
    });
    return dto(now, rows);
  }

  /**
   * The latest nightly run, or null (the app then shows nothing): the check is off, no nightly run yet, or the
   * latest is older than CHECK_FRESH_DAYS. A run by hand is never shown, so a trial made with the check off does
   * not appear once it is turned on.
   */
  async latest(): Promise<LedgerCheckDto | null> {
    if (!this.enabled) return null;
    const fresh = new Date(this.clock.now().getTime() - CHECK_FRESH_DAYS * DAY_MS);
    const rows: { ran_at: Date; invariant: CheckInvariant; ok: boolean; account_id: number | null; amount: string; since: string | null; details: Record<string, unknown> }[] =
      await this.ds.query(
        `SELECT ran_at, invariant, ok, account_id, amount::text AS amount, since::text AS since, details FROM ledger_checks
          WHERE scheduled AND ran_at = (SELECT max(ran_at) FROM ledger_checks WHERE scheduled) AND ran_at >= $1 ORDER BY id`,
        [fresh],
      );
    if (rows.length === 0) return null;
    return dto(
      rows[0]!.ran_at,
      rows.map((r) => ({ invariant: r.invariant, ok: r.ok, accountId: r.account_id, amount: Number(r.amount), since: r.since, details: r.details })),
    );
  }

  private async check(m: EntityManager, today: string): Promise<ResultRow[]> {
    const settings = (await m.query(`SELECT cash_start::text AS cash_start FROM settings WHERE id=1`))[0] as { cash_start: string | null };
    const ctx: LedgerContext = { cashStart: settings.cash_start };
    const from = addDays(today, 1 - CHECK_WINDOW_DAYS);
    return [
      ...(await this.bankBalances(m)),
      await this.ownTransfers(m),
      ...(await this.spending(m, ctx, from, today)),
      ...(await this.cashWallet(m)),
    ];
  }

  /** Invariant 1, for every account with a bank balance; the wallet has no bank statement. */
  private async bankBalances(m: EntityManager): Promise<ResultRow[]> {
    const accounts: {
      id: number;
      kind: string;
      currency: string;
      title: string | null;
      balance: number;
      credit_limit: number;
      balance_at: Date;
      balance_date: string;
    }[] = await m.query(
        `SELECT id, kind, currency, title, balance::float8 AS balance, credit_limit::float8 AS credit_limit, balance_at,
                ${kyivDaySql("balance_at")}::text AS balance_date
           FROM accounts WHERE kind <> 'cash' AND balance_at IS NOT NULL ORDER BY id`,
      );
    const out: ResultRow[] = [];
    for (const a of accounts) {
      const rows: { id: number; occurred_at: Date; local_date: string; amount: number; balance_after: number | null; credit_limit_at: number | null }[] =
        await m.query(
          `SELECT id, occurred_at, local_date::text AS local_date, amount::float8 AS amount, balance_after::float8 AS balance_after,
                  credit_limit_at::float8 AS credit_limit_at
             FROM transactions WHERE account_id = $1 ORDER BY occurred_at, id`,
        [a.id],
      );
      const chain: ChainRow[] = rows.map((r) => ({
        id: r.id,
        at: r.occurred_at.getTime(),
        localDate: r.local_date,
        amount: r.amount,
        balanceAfter: r.balance_after,
        creditLimitAt: r.credit_limit_at,
      }));
      const result = bankBalanceCheck({
        balance: a.balance,
        balanceAt: a.balance_at.getTime(),
        balanceDate: a.balance_date,
        creditLimit: a.credit_limit,
        rows: chain,
      });
      if (result === null) continue; // no bank balance on any row yet: nothing to start from
      out.push({
        invariant: "bank_balance",
        ok: result.since === null,
        accountId: a.id,
        amount: result.amount,
        since: result.since,
        details: { kind: a.kind, title: a.title, currency: a.currency },
      });
    }
    return out;
  }

  /**
   * Invariant 2: a transfer between own accounts with no other leg here (the pair rule of domain/own-pair.ts).
   * Left out: the wallet's own rows, transfers to a card the owner said is his at another bank (cash_cards), and
   * (in loneLegsCheck) money coming in from his account at another bank: their other leg is outside by nature.
   */
  private async ownTransfers(m: EntityManager): Promise<ResultRow> {
    const rows: { date: string; amount: number; description: string }[] = await m.query(
      `SELECT t.local_date::text AS date, t.amount::float8 AS amount, t.description FROM transactions t JOIN accounts ta ON ta.id = t.account_id
        WHERE t.type = 'own_transfer' AND ta.kind <> 'cash'
          AND NOT EXISTS (SELECT 1 FROM transactions o JOIN accounts oa ON oa.id = o.account_id WHERE ${ownPairSql("t", "ta", "o", "oa")})
          AND NOT EXISTS (SELECT 1 FROM cash_cards c WHERE c.counter_key = ${counterKeySql("t")})`,
    );
    const r = loneLegsCheck(rows.map((x) => ({ localDate: x.date, amount: x.amount, description: x.description })));
    return { invariant: "own_transfers", ok: r.count === 0, accountId: null, amount: 0, since: r.since, details: { count: r.count, currency: "UAH" } };
  }

  /**
   * Invariants 3 and 4 over the window. The ledger's figure comes from ledgerEffect over the rows; the screens' from
   * ScreenSpent, which runs the services' own queries.
   */
  private async spending(m: EntityManager, ctx: LedgerContext, from: string, to: string): Promise<ResultRow[]> {
    const rows: { type: TxType | null; kind: AccountKind; amount_uah: number | null; local_date: string; category: string | null }[] = await m.query(
      `SELECT t.type, a.kind, t.amount_uah::float8 AS amount_uah, t.local_date::text AS local_date, t.category
         FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.local_date BETWEEN $1 AND $2`,
      [from, to],
    );
    const ledger: LedgerRow[] = rows.map((r) => ({ type: r.type, accountKind: r.kind, amountUah: r.amount_uah, localDate: r.local_date, category: r.category }));
    const categories = categoriesCheck(ledger, ctx);
    const days = daySpentCheck(limitSpentByDay(ledger, ctx), await this.screens.byDay(m, from, to));
    return [
      { invariant: "categories", ok: categories.since === null, accountId: null, amount: categories.amount, since: categories.since, details: { from, to, currency: "UAH" } },
      { invariant: "day_spent", ok: days.since === null, accountId: null, amount: days.amount, since: days.since, details: { from, to, days: days.days, currency: "UAH" } },
    ];
  }

  /** Invariant 7. The balance is walletBalance's; the changes by day are its own parts (walletChangesSql) by day. */
  private async cashWallet(m: EntityManager): Promise<ResultRow[]> {
    const wallet = await walletBalance(m);
    if (wallet.start === null) return [];
    const changes = byDay(await m.query(`SELECT w.d::text AS date, SUM(w.x)::float8 AS spent FROM (${walletChangesSql()}) w GROUP BY w.d`));
    const r = cashWalletCheck(wallet.start, wallet.balance, changes);
    if (r === null) return [];
    return [{ invariant: "cash_wallet", ok: r.since === null && r.amount >= 0, accountId: null, amount: r.amount, since: r.since, details: { currency: "UAH" } }];
  }
}

const ORDER = new Map(CHECK_INVARIANTS.map((k, i) => [k, i]));

function dto(ranAt: Date, rows: ResultRow[]): LedgerCheckDto {
  const issues = rows
    .filter((r) => !r.ok)
    .sort((a, b) => ORDER.get(a.invariant)! - ORDER.get(b.invariant)! || (a.accountId ?? 0) - (b.accountId ?? 0))
    .map((r): LedgerCheckIssueDto => {
      const issue: LedgerCheckIssueDto = {
        kind: r.invariant,
        amount: r.amount,
        currency: typeof r.details.currency === "string" ? r.details.currency : "UAH",
        since: r.since,
      };
      if (r.invariant === "bank_balance") {
        issue.accountKind = String(r.details.kind);
        issue.accountTitle = typeof r.details.title === "string" ? r.details.title : null;
      }
      if (r.invariant === "own_transfers") issue.count = Number(r.details.count);
      return issue;
    });
  return { ranAt: ranAt.toISOString(), issues };
}
