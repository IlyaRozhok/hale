import { kyivDate } from "../domain/money";
import type { MonoStatementItem } from "./mono.schemas";

/**
 * Task Б6, step 2: the one-off hold check (docs/superpowers/b6-hold-check.md, sections 4 and 6).
 * Pure: database hold rows and the bank's statement rows in, counters out. Nothing here
 * writes anywhere, and the result carries numbers only: no ids, amounts, texts or MCC codes.
 */

/** A `hold = true` row from the database, selected from the period start. */
export interface HoldRow {
  /** transactions.external_id — the bank's item id. */
  id: string;
  /** accounts.external_id — the bank's account id. */
  account: string;
  /** Unix seconds. */
  time: number;
  /** In the account's currency, as the bank gave it. */
  amount: number;
  mcc: number | null;
  description: string;
}

/** Everything fetched for one account: the period plus the Kyiv day before it. */
export interface AccountStatement {
  account: string;
  rows: MonoStatementItem[];
  /** True when at least one window of this account could not be read (section 5). */
  unread: boolean;
}

export interface HoldCheckInput {
  /** Period start, unix seconds (Kyiv midnight of `from`). */
  from: number;
  holds: HoldRow[];
  /** Ids of every hold row in the database, checked or not: their bank rows are never "similar" to another hold. */
  holdIds: Iterable<string>;
  statements: AccountStatement[];
}

export interface HoldCounters {
  holdRows: number;
  holdStillHold: number;
  holdSettled: number;
  holdUnchecked: number;
  holdSameAmountOtherId: number;
  holdCancelled: number;
  holdOtherAmountNearby: number;
  holdNothingSimilar: number;
  cancelRows: number;
  cancelWithOriginal: number;
  cancelOriginalStillHold: number;
  apiRows: number;
}

/** "Nearby": from the Kyiv day before the hold's day through three days after it, inclusive. */
export const NEARBY_DAYS_BEFORE = 1;
export const NEARBY_DAYS_AFTER = 3;
/** A cancellation's original: the same Kyiv day or up to this many days earlier. */
export const CANCEL_LOOKBACK_DAYS = 30;
const CANCEL_PREFIX = "скасування";

/** Days since the epoch of the Kyiv calendar day that holds this moment. */
export function kyivDayNumber(sec: number): number {
  const [y, m, d] = kyivDate(new Date(sec * 1000)).split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export const isCancellation = (row: MonoStatementItem): boolean =>
  row.amount > 0 && row.description.trim().toLowerCase().startsWith(CANCEL_PREFIX);

interface Candidate {
  row: MonoStatementItem;
  day: number;
  used: boolean;
}

/** The nearest unused candidate within the day range that passes `fits`; marks it used. */
function take(
  candidates: Candidate[],
  time: number,
  dayFrom: number,
  dayTo: number,
  fits: (row: MonoStatementItem) => boolean,
): Candidate | undefined {
  let best: Candidate | undefined;
  for (const c of candidates) {
    if (c.used || c.day < dayFrom || c.day > dayTo || !fits(c.row)) continue;
    if (!best || Math.abs(c.row.time - time) < Math.abs(best.row.time - time)) best = c;
  }
  if (best) best.used = true;
  return best;
}

export function checkHolds(input: HoldCheckInput): HoldCounters {
  const counters: HoldCounters = {
    holdRows: input.holds.length,
    holdStillHold: 0,
    holdSettled: 0,
    holdUnchecked: 0,
    holdSameAmountOtherId: 0,
    holdCancelled: 0,
    holdOtherAmountNearby: 0,
    holdNothingSimilar: 0,
    cancelRows: 0,
    cancelWithOriginal: 0,
    cancelOriginalStillHold: 0,
    apiRows: 0,
  };

  const byAccount = new Map<string, { byId: Map<string, MonoStatementItem>; candidates: Candidate[]; unread: boolean }>();
  for (const s of input.statements) {
    counters.apiRows += s.rows.length;
    byAccount.set(s.account, {
      byId: new Map(s.rows.map((r) => [r.id, r])),
      candidates: s.rows.map((row) => ({ row, day: kyivDayNumber(row.time), used: false })),
      unread: s.unread,
    });
  }

  // Pass 1: every hold by id, over the whole fetched statement of its account.
  const missing: HoldRow[] = [];
  for (const h of input.holds) {
    const row = byAccount.get(h.account)?.byId.get(h.id);
    if (!row) {
      missing.push(h);
      continue;
    }
    if (row.hold) counters.holdStillHold += 1;
    else counters.holdSettled += 1;
  }

  // A bank row that is a hold row of the database (checked or not) is never "similar" to another hold.
  const holdIds = new Set(input.holdIds);
  for (const h of input.holds) holdIds.add(h.id);
  for (const { candidates } of byAccount.values()) {
    for (const c of candidates) if (holdIds.has(c.row.id)) c.used = true;
  }

  // Pass 2: the missing holds, earliest first; one bank row goes to at most one hold.
  missing.sort((a, b) => a.time - b.time);
  for (const h of missing) {
    const acc = byAccount.get(h.account);
    if (!acc || acc.unread) {
      counters.holdUnchecked += 1;
      continue;
    }
    const day = kyivDayNumber(h.time);
    const dayFrom = day - NEARBY_DAYS_BEFORE;
    const dayTo = day + NEARBY_DAYS_AFTER;
    if (take(acc.candidates, h.time, dayFrom, dayTo, (r) => r.amount === h.amount && r.mcc === h.mcc)) {
      counters.holdSameAmountOtherId += 1;
    } else if (take(acc.candidates, h.time, dayFrom, dayTo, (r) => isCancellation(r) && r.amount === -h.amount)) {
      counters.holdCancelled += 1;
    } else if (
      take(
        acc.candidates,
        h.time,
        dayFrom,
        dayTo,
        (r) => r.amount < 0 && !r.hold && r.amount !== h.amount && (r.mcc === h.mcc || r.description === h.description),
      )
    ) {
      counters.holdOtherAmountNearby += 1;
    } else {
      counters.holdNothingSimilar += 1;
    }
  }

  // Cancellations, independent of the hold flag: from the period start, the original may be in the day before.
  for (const s of input.statements) {
    const originals = s.rows.map((row) => ({ row, day: kyivDayNumber(row.time), used: false }));
    const cancels = s.rows.filter((r) => isCancellation(r) && r.time >= input.from).sort((a, b) => a.time - b.time);
    for (const c of cancels) {
      counters.cancelRows += 1;
      const day = kyivDayNumber(c.time);
      const original = take(
        originals,
        c.time,
        day - CANCEL_LOOKBACK_DAYS,
        day,
        (r) => r.mcc === c.mcc && r.amount === -c.amount,
      );
      if (!original) continue;
      counters.cancelWithOriginal += 1;
      if (original.row.hold) counters.cancelOriginalStillHold += 1;
    }
  }

  return counters;
}
