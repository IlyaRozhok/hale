// The nightly ledger check (task Б11, audit 6.5 step 2): invariants 1-4 and 7, as pure functions over what the
// service read. They only compare; nothing here changes how money or the limit is counted. Each result is an
// amount and the first day it applies, enough for one sentence in Settings; `since` is null when all is well.
import { FROM_PREFIX, mentionsOwnName } from "./classify";
import { type LedgerContext, type LedgerRow, ledgerEffect } from "./ledger";
import type { Minor } from "./money";

export const CHECK_INVARIANTS = ["bank_balance", "own_transfers", "categories", "day_spent", "cash_wallet"] as const;
export type CheckInvariant = (typeof CHECK_INVARIANTS)[number];

/** How far apart two figures are and since which Kyiv day; `since` is null when they agree. */
export interface Divergence {
  amount: Minor;
  since: string | null;
}

/** One operation of a bank account, in the account's currency. */
export interface ChainRow {
  id: number;
  /** Epoch milliseconds. */
  at: number;
  /** Kyiv day, 'YYYY-MM-DD'. */
  localDate: string;
  /** Signed minor units of the account's currency. */
  amount: Minor;
  /** The balance right after the operation, as the bank sent it; null on rows stored before it was kept. */
  balanceAfter: Minor | null;
  /** The account's credit limit stored when the row arrived by webhook (credit_limit_at); null when not known. */
  creditLimitAt?: Minor | null;
}

export interface ChainAccount {
  /** The balance the bank reported last, at `balanceAt`. */
  balance: Minor;
  balanceAt: number;
  /** Kyiv day of `balanceAt`. */
  balanceDate: string;
  /** The account's credit limit now (accounts.credit_limit); monobank's balances include it. */
  creditLimit?: Minor;
  rows: readonly ChainRow[];
}

/** Rows by time, then id; rows of the same moment are put in the order their bank balances chain. */
function chainOrder(rows: readonly ChainRow[], start: Minor | null): ChainRow[] {
  const sorted = [...rows].sort((a, b) => a.at - b.at || a.id - b.id);
  const out: ChainRow[] = [];
  let running = start;
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j]!.at === sorted[i]!.at) j++;
    const group = sorted.slice(i, j);
    while (group.length > 0) {
      const k = running === null ? -1 : group.findIndex((r) => r.balanceAfter !== null && r.balanceAfter - r.amount === running);
      const next = group.splice(Math.max(k, 0), 1)[0]!;
      out.push(next);
      if (next.balanceAfter !== null) running = next.balanceAfter;
      else if (running !== null) running += next.amount;
    }
    i = j;
  }
  return out;
}

/**
 * Invariant 1: the bank's balance after each operation follows from the one before plus the operation, and the
 * balance the bank reports now follows from the last one. A break is money the bank moved and the base did not
 * (a lost operation, negative) or money the base moved and the bank did not (a hold the bank dropped, positive).
 * The amount is the bank's balance minus ours; `since` is the first operation (or the bank's balance) at which
 * the present difference shows. Operations after the moment of the bank's balance are left out. Null when no
 * row carries a bank balance: there is nothing to start from.
 *
 * monobank's balances include the credit limit, so a new limit moves them with no operation behind it. Between
 * two points whose limits are known (credit_limit_at on webhook rows, the account's limit now) the change of the
 * limit is taken out of the gap; a limit stored late cancels out at the next known point. On an account that has
 * or had a limit, a link where the limit is not known on one side is skipped: a difference there may be only a
 * new limit, and the check does not alarm on a guess.
 */
export function bankBalanceCheck(account: ChainAccount): Divergence | null {
  const rows = account.rows.filter((r) => r.at <= account.balanceAt);
  const hasCredit = (account.creditLimit ?? 0) > 0 || rows.some((r) => (r.creditLimitAt ?? 0) > 0);
  let running: Minor | null = null;
  let runningLimit: Minor | null = null;
  let diff = 0;
  let since: string | null = null;
  const gap = (amount: Minor, date: string) => {
    if (amount === 0) return;
    const before = diff;
    diff += amount;
    if (diff === 0) since = null;
    else if (before === 0) since = date;
  };
  /** A link from a point with limit `from` to one with limit `to`; skipped when a limit change cannot be ruled out. */
  const link = (raw: Minor, from: Minor | null, to: Minor | null, date: string) => {
    if (from !== null && to !== null) gap(raw - (to - from), date);
    else if (!hasCredit) gap(raw, date);
  };
  for (const r of chainOrder(rows, null)) {
    if (running === null) {
      running = r.balanceAfter;
      runningLimit = r.creditLimitAt ?? null;
      continue;
    }
    if (r.balanceAfter === null) {
      running += r.amount;
      continue;
    }
    link(r.balanceAfter - (running + r.amount), runningLimit, r.creditLimitAt ?? null, r.localDate);
    running = r.balanceAfter;
    runningLimit = r.creditLimitAt ?? null;
  }
  if (running === null) return null;
  link(account.balance - running, runningLimit, account.creditLimit ?? 0, account.balanceDate);
  return { amount: diff, since };
}

/** A transfer between own accounts with no other leg here. */
export interface LoneLeg {
  localDate: string;
  /** Signed; positive is money in. */
  amount: Minor;
  description: string;
  /** The bank's counterparty field. */
  counterName?: string | null;
}

/**
 * Invariant 2: legs of transfers between own accounts with no other leg here, counted with the oldest Kyiv day.
 * Money coming in from the owner's account at another bank is left out, as classify reads it: «Від: …» in the
 * description, or (Б38) one of the owner's names in the bank's counterparty field. Its other leg is never in the
 * base. Everything else counts.
 */
export function loneLegsCheck(legs: readonly LoneLeg[], ownNames: readonly string[] = []): { count: number; since: string | null } {
  const fromOutside = (l: LoneLeg) =>
    l.amount > 0 && (FROM_PREFIX.test(l.description.trim()) || mentionsOwnName(l.counterName ?? "", ownNames));
  const counted = legs.filter((l) => !fromOutside(l));
  const since = counted.reduce<string | null>((min, l) => (min === null || l.localDate < min ? l.localDate : min), null);
  return { count: counted.length, since };
}

/**
 * Invariant 3: the spending of a period adds up by category to the whole. A counted row without a category is in
 * the whole and in no category. The amount is the whole minus the categories (kopecks of spending); `since` is
 * the first day they differ.
 */
export function categoriesCheck(rows: readonly LedgerRow[], ctx: LedgerContext): Divergence {
  const byDay = new Map<string, Minor>();
  for (const r of rows) {
    const e = ledgerEffect(r, ctx);
    if (e.limitSpend === 0 || e.category !== null) continue;
    byDay.set(r.localDate, (byDay.get(r.localDate) ?? 0) + e.limitSpend);
  }
  return firstDifference([...byDay].filter(([, d]) => d !== 0), (days) => days.reduce((s, [, d]) => s + d, 0));
}

/**
 * Invariant 4: spent per day is the same everywhere. `reference` is the ledger's (limitSpentByDay), each of
 * `screens` what one screen's query gives; a day missing from a map is zero. The amount is the difference
 * (screen minus ledger) on the first day that differs; `days` counts the days that differ anywhere.
 */
export function daySpentCheck(reference: ReadonlyMap<string, Minor>, screens: readonly ReadonlyMap<string, Minor>[]): Divergence & { days: number } {
  const dates = new Set<string>([...reference.keys(), ...screens.flatMap((s) => [...s.keys()])]);
  const diffs: [string, Minor][] = [];
  for (const date of dates) {
    const want = reference.get(date) ?? 0;
    const off = screens.map((s) => (s.get(date) ?? 0) - want).find((d) => d !== 0);
    if (off !== undefined) diffs.push([date, off]);
  }
  const result = firstDifference(diffs, (days) => days[0]![1]);
  return { ...result, days: diffs.length };
}

/** The earliest of the days that differ and an amount made of them; agreement when there are none. */
function firstDifference(diffs: [string, Minor][], amount: (sorted: [string, Minor][]) => Minor): Divergence {
  if (diffs.length === 0) return { amount: 0, since: null };
  const sorted = [...diffs].sort(([a], [b]) => (a < b ? -1 : 1));
  return { amount: amount(sorted), since: sorted[0]![0] };
}

/**
 * Invariant 7: the cash wallet does not hold less than nothing. `balance` is the wallet now (walletBalance),
 * `changes` what each Kyiv day added. Below zero, `since` is the first day of the stretch the wallet has been
 * below zero to this day. Null before the wallet starts.
 */
export function cashWalletCheck(start: string | null, balance: Minor, changes: ReadonlyMap<string, Minor>): Divergence | null {
  if (start === null) return null;
  if (balance >= 0) return { amount: balance, since: null };
  let running = 0;
  let since: string | null = null;
  for (const [date, change] of [...changes].sort(([a], [b]) => (a < b ? -1 : 1))) {
    running += change;
    if (running >= 0) since = null;
    else if (since === null) since = date;
  }
  return { amount: balance, since };
}
