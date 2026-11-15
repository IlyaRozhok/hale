// One definition of what an operation does: how much it spends from the day limit, how it changes
// own money, which category it goes to and what it is linked with (audit 6.5, step 1).
// Pure: no Nest, no I/O, no clock. The SQL helpers below are built from the same constants so the
// services can filter in the database without a second copy of the rule.
//
// This encodes the rule the server uses as of 13 November 2026. «Сегодня» and the calendar count the limit
// with limitSql (Б1 PR 2); the «Траты» group of the list is filtered by spendGroupSql (Б1 PR 3), while its
// day totals, its summary and the inLimit mark of every row go by limitSql (Б2); test/ledger.e2e.test.ts
// checks all of it against ledgerEffect in Postgres.
import type { TxType } from "./classify";
import type { Minor } from "./money";

/** accounts.kind, as the database check allows it. */
export type AccountKind = "black" | "white" | "fop" | "jar" | "other" | "cash";
export const ACCOUNT_KINDS: readonly AccountKind[] = ["black", "white", "fop", "jar", "other", "cash"];

/**
 * Accounts whose money is the owner's own: the cards, the fop account and the cash wallet, as the
 * «Сегодня» sum reads them. Jars are savings and 'other' accounts are not read at all.
 */
export const OWN_MONEY_ACCOUNT_KINDS: ReadonlySet<AccountKind> = new Set(["black", "white", "fop", "cash"]);

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

/** Where the services read the wallet start. */
export const CASH_START_SQL = "(SELECT cash_start FROM settings WHERE id=1)";

export interface LedgerContext {
  /** The cash wallet's first day ('YYYY-MM-DD'), or null while there is no wallet. */
  cashStart: string | null;
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
  /** Signed hryvnia kopecks; positive is money in. Null when there was no rate. */
  amountUah: Minor | null;
  /** Kyiv day, 'YYYY-MM-DD'. */
  localDate: string;
  category: string | null;
  /** A deposit the owner said came from the cash wallet. */
  fromWallet?: boolean;
  /** Cash a transfer to the owner's card at another bank put into the wallet (cardCashSql in cash/wallet.ts). */
  walletCash?: Minor;
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
   * Change to own money (cards, fop and wallet together); null without a hryvnia amount.
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
  if (row.accountKind === LIMIT_EXCLUDED_ACCOUNT_KIND || row.amountUah === null) return false;
  if (isLimitType(row.type)) return true;
  return row.type === CASH_OUT && cashOutCounts(row.localDate, ctx.cashStart);
}

export function inSpendGroup(row: LedgerRow, ctx: LedgerContext): boolean {
  if (!(SPEND_GROUP_TYPES as readonly string[]).includes(row.type ?? "")) return false;
  return row.type !== CASH_OUT || cashOutCounts(row.localDate, ctx.cashStart);
}

/**
 * The wallet side of a row, as walletBalance in cash/wallet.ts adds it up: rows on the wallet, card
 * withdrawals from the wallet start, cash from transfers to another bank, less deposits from the wallet.
 */
function walletChange(row: LedgerRow, amount: Minor, cashStart: string | null): Minor {
  if (cashStart === null) return 0;
  let change = 0;
  if (row.accountKind === "cash") change += amount;
  if (row.type === CASH_OUT && row.accountKind !== "cash" && row.accountKind !== "jar" && row.localDate >= cashStart) change -= amount;
  change += row.walletCash ?? 0;
  if (row.fromWallet) change -= amount;
  return change;
}

function ownMoneyChange(row: LedgerRow, ctx: LedgerContext): Minor | null {
  if (row.amountUah === null) return null;
  const onAccount = row.accountKind !== "cash" && OWN_MONEY_ACCOUNT_KINDS.has(row.accountKind) ? row.amountUah : 0;
  return onAccount + walletChange(row, row.amountUah, ctx.cashStart);
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
  return `${a}.kind <> '${LIMIT_EXCLUDED_ACCOUNT_KIND}' AND ${t}.amount_uah IS NOT NULL AND (${t}.type IN (${sqlList(LIMIT_TYPES)})
  OR (${t}.type = '${CASH_OUT}' AND NOT COALESCE(${t}.local_date >= ${CASH_START_SQL}, false)))`;
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
