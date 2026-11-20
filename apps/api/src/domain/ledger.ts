// One definition of what an operation does: how much it spends from the day limit, how it changes
// own money, which category it goes to and what it is linked with (audit 6.5, step 1).
// Pure: no Nest, no I/O, no clock. The SQL helpers below are built from the same constants so the
// services can filter in the database without a second copy of the rule.
//
// This encodes the rule the server uses as of 13 November 2026, with a count's shortfall taken out of the limit
// on 18 November (Б47 (2)). «Сегодня» and the calendar count the limit with limitSql (Б1 PR 2); the «Траты»
// group of the list is filtered by spendGroupSql (Б1 PR 3), while its day totals, its summary and the inLimit
// mark of every row go by limitSql (Б2); test/ledger.e2e.test.ts checks all of it against ledgerEffect in Postgres.
import type { TxType } from "./classify";
import type { Minor } from "./money";

/** accounts.kind, as the database check allows it. */
export type AccountKind = "black" | "white" | "fop" | "jar" | "other" | "cash";
export const ACCOUNT_KINDS: readonly AccountKind[] = ["black", "white", "fop", "jar", "other", "cash"];

/** The kind whose money is set aside unless the person says otherwise: a jar is savings. */
export const SET_ASIDE_BY_DEFAULT_KIND: AccountKind = "jar";

/**
 * Whether an account of this kind is own money while the person has not marked it (Д2а): every kind but a jar. A card
 * of another monobank type ('other') is own from the start, since its purchases already spend the limit. Accounts that
 * existed before the mark carry the earlier rule written out (migration 0038): their 'other' accounts are off.
 */
export function defaultCountsAsOwn(kind: AccountKind): boolean {
  return kind !== SET_ASIDE_BY_DEFAULT_KIND;
}

/**
 * Whether an account's money is own money (Д2а): the person's mark (accounts.counts_as_own), or the kind's default
 * when there is none. The cash wallet is always own money. An account that is not own money still spends the limit
 * with its purchases: countsAgainstLimit does not look at the mark.
 */
export function countsAsOwn(kind: AccountKind, mark: boolean | null | undefined): boolean {
  if (kind === "cash") return true;
  return mark ?? defaultCountsAsOwn(kind);
}

/** SQL over `a` (accounts): countsAsOwn, for the services that read balances in the database. */
export function countsAsOwnSql(a = "a"): string {
  return `(${a}.kind = 'cash' OR COALESCE(${a}.counts_as_own, ${a}.kind <> '${SET_ASIDE_BY_DEFAULT_KIND}'))`;
}

/** Types that always count against the limit (spend refunds reduce it). */
export const LIMIT_TYPES = ["spend", "person_transfer"] as const satisfies readonly TxType[];
/** A withdrawal counts only until the cash wallet starts; from then it moves money into the wallet. */
export const CASH_OUT: TxType = "cash_out";
/** Nothing on this account kind counts against the limit. Every other kind does, 'other' included. */
export const LIMIT_EXCLUDED_ACCOUNT_KIND: AccountKind = "jar";

/**
 * Types the «Траты» list group shows. It is wider than the limit on purpose: payments, taxes, debts and
 * loans out are listed but not counted, and neither jars nor rows without a hryvnia amount are filtered
 * out. The tab's totals are the limit's and the rows outside it are marked (Б2, the owner's decision).
 */
export const SPEND_GROUP_TYPES = [
  "spend", "obligation", "tax", "debt_payment", "person_transfer", "cash_out", "loan_out",
] as const satisfies readonly TxType[];

/**
 * Payments outside the limit, which «Итоги» names in one quiet line under its categories (В2а): planned payments
 * (rent, utilities, and a person transfer that settled one is stored as 'obligation'), taxes, and debt payments
 * (installments and loans repaid; installments have no type of their own). These are the types a planned payment
 * settles (plan.service SETTLING_TYPES). The limit never counts them: none is in LIMIT_TYPES or CASH_OUT. Not
 * payments: own transfers and withdrawals move own money; a loan given comes back; goal contributions are savings;
 * a count's shortfall is a 'spend' row the limit leaves out (Б47 (2)). The account and amount rules are the limit's.
 */
export const OUT_OF_LIMIT_PAYMENT_TYPES = ["obligation", "tax", "debt_payment"] as const satisfies readonly TxType[];

/**
 * A row a count of the pocket wrote for what it found missing («Не записано», cash.service `count`). The money is
 * gone, so the row lowers own money and the wallet on the day of the count, but it is not that day's spending
 * against its limit (Б47 (2), the owner's decision of 18 November 2026): it stays in the «Траты» list, marked as
 * outside the limit. It is known by the marker the count writes into `raw` (the one Б40 reads too), not by its note,
 * which the owner can change. Counts made before that marker (17 November 2026) wrote rows without it; those count.
 */
export function cashCountShortSql(t = "t"): string {
  return `(${t}.raw->>'cash_count' IS NOT DISTINCT FROM 'short')`;
}

/** Where the services read the wallet start. */
export const CASH_START_SQL = "(SELECT cash_start FROM settings WHERE id=1)";

export interface LedgerContext {
  /** The cash wallet's first day ('YYYY-MM-DD'), or null while there is no wallet. */
  cashStart: string | null;
  /**
   * The moment the wallet started (epoch ms, settings.cash_started_at; Б39). Only what the wallet receives from the
   * cards depends on it; the limit stays by day. Left out or null, the whole first day counts.
   */
  cashStartedAt?: number | null;
}

/** Ids the caller found for the row; the ledger only names them. */
export interface LedgerLinksInput {
  /** scheduled_payments.transaction_id: the planned payment this row paid. */
  paymentId?: number | null;
  /** loans.source_transaction_id: the loan this row brought in. */
  loanId?: number | null;
  /** The row is in loan_repayments: it paid short loans. */
  shortLoanRepayment?: boolean;
  /** income_events.matched_transaction_id: the expected income this row was. */
  incomeEventId?: number | null;
  /** The other leg of a transfer between own accounts. */
  pairId?: number | null;
}

export interface LedgerRow {
  type: TxType | null;
  accountKind: AccountKind;
  /** The account's mark that it is own money (accounts.counts_as_own); null or left out follows the kind (countsAsOwn). */
  accountCountsAsOwn?: boolean | null;
  /** Signed hryvnia kopecks; positive is money in. Null when there was no rate. */
  amountUah: Minor | null;
  /** Kyiv day, 'YYYY-MM-DD'. */
  localDate: string;
  /** When it happened (epoch ms, occurred_at). Needed only to judge a withdrawal on the wallet's first day against its start moment. */
  occurredAt?: number;
  category: string | null;
  /** A deposit the owner said came from the cash wallet. */
  fromWallet?: boolean;
  /** Cash a transfer to the owner's card at another bank put into the wallet (cardCashSql in cash/wallet.ts). */
  walletCash?: Minor;
  /** A count of the pocket wrote it for what it found missing (cashCountShortSql): never the day's spending. */
  cashCountShort?: boolean;
  links?: LedgerLinksInput;
}

export type LedgerLink =
  | { kind: "payment"; id: number }
  | { kind: "loan"; id: number }
  | { kind: "loan_repayment" }
  | { kind: "income"; id: number }
  | { kind: "pair"; id: number };

export interface LedgerEffect {
  /** Kopecks this row takes from the day limit; negative for a refund, 0 when it does not count. */
  limitSpend: Minor;
  /** Shown in the «Траты» list group. */
  inSpendGroup: boolean;
  /**
   * Change to own money (the accounts that count as own, and the wallet); null without a hryvnia amount.
   * It is a per-row view at the rate of the operation day (amount_uah). «Сегодня» converts foreign-currency
   * balances at today's rate and adds manual_balances (Binance), so a sum of ownMoney will not reproduce it.
   */
  ownMoney: Minor | null;
  /** The stored category, unchanged. */
  category: string | null;
  links: LedgerLink[];
}

/** A withdrawal counts while there is no wallet, or before its first day. Mirrors NOT COALESCE(date >= start, false). */
export function cashOutCounts(localDate: string, cashStart: string | null): boolean {
  return cashStart === null || localDate < cashStart;
}

const isLimitType = (type: TxType | null): boolean => (LIMIT_TYPES as readonly string[]).includes(type ?? "");

export function countsAgainstLimit(row: LedgerRow, ctx: LedgerContext): boolean {
  if (row.accountKind === LIMIT_EXCLUDED_ACCOUNT_KIND || row.amountUah === null || row.cashCountShort) return false;
  if (isLimitType(row.type)) return true;
  return row.type === CASH_OUT && cashOutCounts(row.localDate, ctx.cashStart);
}

/**
 * Kopecks a payment outside the limit took (OUT_OF_LIMIT_PAYMENT_TYPES), signed as limitSpend: money back lowers it;
 * 0 for every other row. Mirrors outOfLimitPaymentSql.
 */
export function outOfLimitPayment(row: LedgerRow): Minor {
  if (row.accountKind === LIMIT_EXCLUDED_ACCOUNT_KIND || row.amountUah === null) return 0;
  // `0 - x` rather than `-x`: a zero amount gives 0, not -0.
  return (OUT_OF_LIMIT_PAYMENT_TYPES as readonly string[]).includes(row.type ?? "") ? 0 - row.amountUah : 0;
}

export function inSpendGroup(row: LedgerRow, ctx: LedgerContext): boolean {
  if (!(SPEND_GROUP_TYPES as readonly string[]).includes(row.type ?? "")) return false;
  return row.type !== CASH_OUT || cashOutCounts(row.localDate, ctx.cashStart);
}

/**
 * A card operation happened since the wallet start: on or after its first day, and at or after its start moment
 * when both are known (Б39). Mirrors sinceWalletStartSql in cash/wallet.ts.
 */
function sinceWalletStart(row: LedgerRow, ctx: LedgerContext): boolean {
  if (ctx.cashStart === null || row.localDate < ctx.cashStart) return false;
  return ctx.cashStartedAt == null || row.occurredAt === undefined || row.occurredAt >= ctx.cashStartedAt;
}

/**
 * The wallet side of a row, as walletBalance in cash/wallet.ts adds it up: rows on the wallet, card
 * withdrawals since the wallet start, cash from transfers to another bank, less deposits from the wallet.
 * A withdrawal before the start moment on the first day is neither spending nor a wallet change: the opening
 * balance holds its cash. 0 without a hryvnia amount, as SUM skips it.
 */
export function walletChange(row: LedgerRow, ctx: LedgerContext): Minor {
  if (ctx.cashStart === null || row.amountUah === null) return 0;
  const amount = row.amountUah;
  let change = 0;
  if (row.accountKind === "cash") change += amount;
  if (row.type === CASH_OUT && row.accountKind !== "cash" && row.accountKind !== "jar" && sinceWalletStart(row, ctx)) change -= amount;
  change += row.walletCash ?? 0;
  if (row.fromWallet) change -= amount;
  return change;
}

function ownMoneyChange(row: LedgerRow, ctx: LedgerContext): Minor | null {
  if (row.amountUah === null) return null;
  const onAccount = row.accountKind !== "cash" && countsAsOwn(row.accountKind, row.accountCountsAsOwn) ? row.amountUah : 0;
  return onAccount + walletChange(row, ctx);
}

function linksOf(input: LedgerLinksInput | undefined): LedgerLink[] {
  if (!input) return [];
  const out: LedgerLink[] = [];
  if (input.paymentId != null) out.push({ kind: "payment", id: input.paymentId });
  if (input.loanId != null) out.push({ kind: "loan", id: input.loanId });
  if (input.shortLoanRepayment) out.push({ kind: "loan_repayment" });
  if (input.incomeEventId != null) out.push({ kind: "income", id: input.incomeEventId });
  if (input.pairId != null) out.push({ kind: "pair", id: input.pairId });
  return out;
}

export function ledgerEffect(row: LedgerRow, ctx: LedgerContext): LedgerEffect {
  return {
    // `0 - x` rather than `-x`: a zero amount gives 0, not -0.
    limitSpend: countsAgainstLimit(row, ctx) ? 0 - row.amountUah! : 0,
    inSpendGroup: inSpendGroup(row, ctx),
    ownMoney: ownMoneyChange(row, ctx),
    category: row.category,
    links: linksOf(row.links),
  };
}

/** What the rows took from the limit, refunds included. Same as SUM(-amount_uah) over the counted rows. */
export function limitSpent(rows: readonly LedgerRow[], ctx: LedgerContext): Minor {
  return rows.reduce((s, r) => s + ledgerEffect(r, ctx).limitSpend, 0);
}

/** Spent per Kyiv day; a day is present only when one of its rows counts, as with GROUP BY over the counted rows. */
export function limitSpentByDay(rows: readonly LedgerRow[], ctx: LedgerContext): Map<string, Minor> {
  const out = new Map<string, Minor>();
  for (const r of rows) {
    if (!countsAgainstLimit(r, ctx)) continue;
    out.set(r.localDate, (out.get(r.localDate) ?? 0) + ledgerEffect(r, ctx).limitSpend);
  }
  return out;
}

const sqlList = (xs: readonly string[]): string => xs.map((x) => `'${x}'`).join(",");

/** SQL over `t` (transactions) and its wallet start: a withdrawal on or after the wallet's first day. */
const cashOutFromStartSql = (t: string): string => `${t}.type = '${CASH_OUT}' AND COALESCE(${t}.local_date >= ${CASH_START_SQL}, false)`;

/** SQL condition over `t` (transactions) and `a` (its account): the row counts against the limit. */
export function limitSql(t = "t", a = "a"): string {
  return `${a}.kind <> '${LIMIT_EXCLUDED_ACCOUNT_KIND}' AND ${t}.amount_uah IS NOT NULL AND NOT ${cashCountShortSql(t)}
  AND (${t}.type IN (${sqlList(LIMIT_TYPES)}) OR (${t}.type = '${CASH_OUT}' AND NOT COALESCE(${t}.local_date >= ${CASH_START_SQL}, false)))`;
}

/** SQL condition over `t` (transactions) and `a` (its account): a payment outside the limit (outOfLimitPayment). */
export function outOfLimitPaymentSql(t = "t", a = "a"): string {
  return `(${a}.kind <> '${LIMIT_EXCLUDED_ACCOUNT_KIND}' AND ${t}.amount_uah IS NOT NULL AND ${t}.type IN (${sqlList(OUT_OF_LIMIT_PAYMENT_TYPES)}))`;
}

/** SQL condition over `t` (transactions): the row is in the «Траты» list group. */
export function spendGroupSql(t = "t"): string {
  return `(${t}.type IN (${sqlList(SPEND_GROUP_TYPES)}) AND NOT (${cashOutFromStartSql(t)}))`;
}

/**
 * SQL for what counted against the limit per Kyiv day between two date parameters (e.g. "$1", "$2"): rows
 * (date text, spent float8), a day only when one of its rows counts. The calendar, the streak and the ledger check
 * run exactly this query.
 */
export function spentByDaySql(from: string, to: string): string {
  return `SELECT t.local_date::text AS date, SUM(-t.amount_uah)::float8 AS spent FROM transactions t JOIN accounts a ON a.id=t.account_id
        WHERE ${limitSql("t", "a")} AND t.local_date BETWEEN ${from} AND ${to} GROUP BY t.local_date`;
}

/**
 * SQL for what counted against the limit between two date parameters, one row (s float8): «потрачено» on «Сегодня»
 * and the average day. The ledger check runs it for every day it looks at.
 */
export function spentSql(from: string, to: string): string {
  return `SELECT COALESCE(SUM(-t.amount_uah),0)::float8 AS s FROM transactions t JOIN accounts a ON a.id=t.account_id
        WHERE ${limitSql("t", "a")} AND t.local_date BETWEEN ${from} AND ${to}`;
}

/**
 * SQL for what counts of the pocket found missing on one Kyiv day (a date parameter, e.g. "$1"), one row (s float8):
 * the wallet spending rows with the marker (cashCountShortSql), which the limit leaves out. «Сегодня» adds them back,
 * as it adds back «потрачено», when it fixes the day's limit from the money of now: a count does not change the
 * limit of its own day (Б47 (2)), only of the days after it.
 */
export function cashCountShortfallSql(day: string): string {
  return `SELECT COALESCE(SUM(-t.amount_uah),0)::float8 AS s FROM transactions t JOIN accounts a ON a.id=t.account_id
        WHERE a.kind = 'cash' AND t.type = 'spend' AND t.amount_uah IS NOT NULL AND ${cashCountShortSql("t")} AND t.local_date = ${day}`;
}
