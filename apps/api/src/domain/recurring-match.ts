/** Pure matching of bank rows to planned payments and generation of monthly income events. */

import { precedingQuarter, quarterBounds } from "./quarter";

export type PaymentKind = "obligation" | "installment" | "tax";

export interface Payment {
  id: number;
  kind: PaymentKind;
  name: string;
  /** Minor units of `currency`, positive. */
  amount: number;
  currency: string;
  /** YYYY-MM-DD. */
  due_on: string;
  paid_at: Date | string | null;
  transaction_id: number | null;
  match_hint: string | null;
  /** "2026-Q3" for a quarterly tax row; null for anything else. */
  tax_quarter?: string | null;
}

export interface PayableTx {
  id: number;
  type: string | null;
  /** Signed minor units of the account currency. */
  amount: number;
  currency: string;
  amountUah: number | null;
  /** YYYY-MM-DD. */
  localDate: string;
  /** Description, comment and counterparty joined. */
  text: string;
}

export const MATCH_TOLERANCE_DAYS = 3;
export const APPROX_TOLERANCE = 0.05;
export const MIN_HINT_LENGTH = 3;
const KIND_BY_TYPE: Record<string, PaymentKind> = {
  obligation: "obligation",
  debt_payment: "installment",
  tax: "tax",
  // A store installment can be typed spend by its MCC; it still settles an installment.
  spend: "installment",
};
const DAY_MS = 86_400_000;
const dayNumber = (ymd: string) => Math.round(Date.parse(`${ymd}T00:00:00Z`) / DAY_MS);

function exactFit(tx: PayableTx, p: Payment): boolean {
  const out = Math.abs(tx.amount);
  if (tx.currency === p.currency && out === p.amount) return true;
  return p.currency === "UAH" && tx.amountUah !== null && Math.abs(tx.amountUah) === p.amount;
}

/** A hryvnia debit within 5% of a foreign-currency payment at the current rate (UAH per unit). */
function approxFit(tx: PayableTx, p: Payment, rates: Readonly<Record<string, number>>): boolean {
  const rate = rates[p.currency];
  if (p.currency === "UAH" || !rate || rate <= 0) return false;
  const uah = tx.amountUah ?? (tx.currency === "UAH" ? tx.amount : null);
  if (uah === null) return false;
  const expected = p.amount * rate;
  return Math.abs(Math.abs(uah) - expected) <= expected * APPROX_TOLERANCE;
}

/**
 * The unpaid payment of the right kind that this outgoing row settles. Paid or already linked
 * payments are never returned; the nearest due date wins.
 *
 * Within three days of the due date: the exact amount, or a match_hint (3+ characters) in the
 * text, or (obligation rows) a hryvnia debit within 5% of a foreign-currency payment at the
 * given rates. A row typed `obligation` may also settle an obligation due in the same calendar
 * month, but only on the amount (exact, or within 5% for foreign currency), never on a hint.
 * Rows typed `spend` can settle installments only, within three days.
 */
export function matchPayment(
  tx: PayableTx,
  payments: readonly Payment[],
  rates: Readonly<Record<string, number>> = {},
): Payment | null {
  const kind = tx.type ? KIND_BY_TYPE[tx.type] : undefined;
  if (!kind || tx.amount >= 0) return null;
  const isObligationRow = tx.type === "obligation";
  const text = tx.text.toLowerCase();
  const today = dayNumber(tx.localDate);
  let best: { p: Payment; dist: number } | null = null;
  for (const p of payments) {
    if (p.kind !== kind || p.paid_at !== null || p.transaction_id !== null) continue;
    const dist = Math.abs(dayNumber(p.due_on) - today);
    const sameMonth = isObligationRow && p.due_on.slice(0, 7) === tx.localDate.slice(0, 7);
    if (dist > MATCH_TOLERANCE_DAYS && !sameMonth) continue;
    const amountOk = exactFit(tx, p) || (isObligationRow && approxFit(tx, p, rates));
    const hinted = !!p.match_hint && p.match_hint.length >= MIN_HINT_LENGTH && text.includes(p.match_hint.toLowerCase());
    const ok = dist <= MATCH_TOLERANCE_DAYS ? amountOk || hinted : amountOk;
    if (!ok) continue;
    if (!best || dist < best.dist) best = { p, dist };
  }
  return best ? best.p : null;
}

/**
 * The tax row this outgoing tax payment belongs to, by exact amount, whatever the date or the paid
 * mark: an owner's "already paid" row still claims its bank row, so that row does not count against
 * the next quarter. Only a row not yet linked can be returned; the nearest due date wins, an unpaid
 * row on a tie. A payment made before the row's quarter ended cannot be for it: the same ESV amount
 * comes around every quarter, and last quarter's payment must not close this quarter's row.
 */
export function matchTaxPayment(tx: PayableTx, payments: readonly Payment[]): Payment | null {
  if (tx.type !== "tax" || tx.amount >= 0) return null;
  const today = dayNumber(tx.localDate);
  let best: { p: Payment; dist: number } | null = null;
  for (const p of payments) {
    if (p.kind !== "tax" || p.transaction_id !== null || !exactFit(tx, p)) continue;
    if (tx.localDate <= quarterBounds(p.tax_quarter ?? precedingQuarter(p.due_on)).end) continue;
    const dist = Math.abs(dayNumber(p.due_on) - today);
    const closer = !best || dist < best.dist || (dist === best.dist && best.p.paid_at !== null && p.paid_at === null);
    if (closer) best = { p, dist };
  }
  return best ? best.p : null;
}

export interface ExpectedForEvents {
  id: number;
  source: "fop" | "usdc";
  window_start_day: number;
  window_end_day: number;
}

export interface PlannedEvent {
  expected_income_id: number;
  /** YYYY-MM. */
  period: string;
  expected_on: string;
  status: "expected";
}

export const DEFAULT_EVENT_DAY = 25;

/** Events for the month of `today` and the next one, one per expected income per month. */
export function monthlyEvents(
  expected: readonly ExpectedForEvents[],
  today: string,
  defaultDay = DEFAULT_EVENT_DAY,
): PlannedEvent[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const out: PlannedEvent[] = [];
  for (let i = 0; i < 2; i++) {
    const y = year + Math.floor((month - 1 + i) / 12);
    const m = ((month - 1 + i) % 12) + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const period = `${y}-${String(m).padStart(2, "0")}`;
    const on = `${period}-${String(Math.min(defaultDay, last)).padStart(2, "0")}`;
    for (const e of expected) {
      out.push({ expected_income_id: e.id, period, expected_on: on, status: "expected" });
    }
  }
  return out;
}

/** Due dates of a monthly series for the month of `today` and the next, day clamped to month length. */
export function monthlyDueDates(dayOfMonth: number, today: string): string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < 2; i++) {
    const y = year + Math.floor((month - 1 + i) / 12);
    const m = ((month - 1 + i) % 12) + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push(`${y}-${String(m).padStart(2, "0")}-${String(Math.min(dayOfMonth, last)).padStart(2, "0")}`);
  }
  return out;
}
