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
  /** The app's own estimate of a quarter's tax, not the owner's figure. */
  is_estimate?: boolean;
  /** Minor units already paid by operations in `payment_links`; 0 or absent when none. */
  linked?: number;
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
    if (p.kind !== kind || p.paid_at !== null || p.transaction_id !== null || (p.linked ?? 0) > 0) continue;
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
    if (p.kind !== "tax" || p.transaction_id !== null || (p.linked ?? 0) > 0 || !exactFit(tx, p)) continue;
    if (tx.localDate <= quarterBounds(p.tax_quarter ?? precedingQuarter(p.due_on)).end) continue;
    const dist = Math.abs(dayNumber(p.due_on) - today);
    const closer = !best || dist < best.dist || (dist === best.dist && best.p.paid_at !== null && p.paid_at === null);
    if (closer) best = { p, dist };
  }
  return best ? best.p : null;
}

/** A payment still unpaid this many days after its due date may be asked about (task Б8, invariant 6). */
export const PAID_QUESTION_DAYS = 14;
/** No more «Это оплата?» questions than this at once. */
export const MAX_PAID_QUESTIONS = 2;

export interface PaidQuestion {
  payment: Payment;
  tx: PayableTx;
}

/** How far the row is from the payment's amount, in hryvnia minor units: 0 when exact, null when it does not fit. */
function amountGap(tx: PayableTx, p: Payment, rates: Readonly<Record<string, number>>): number | null {
  if (exactFit(tx, p)) return 0;
  if (!approxFit(tx, p, rates)) return null;
  const uah = Math.abs(tx.amountUah ?? tx.amount);
  return Math.abs(uah - p.amount * rates[p.currency]!);
}

/**
 * «Это оплата?» (task Б8): a payment still unpaid more than PAID_QUESTION_DAYS after its due date,
 * while an operation that could have paid it sits unlinked, keeps its money out of the limit for no
 * reason. `candidates` are the operations the «Оплачено» sheet offers for each payment; of those, only
 * an outgoing row that is not an own transfer, with the payment's amount (the same fit matchPayment
 * uses), and not dismissed by the owner for this payment (`dismissed` holds "payment:operation").
 * Taxes are left out: they close on their own (task Б24). One question per payment, with its closest
 * amount, then the closest date to the due date; an operation is offered for one payment only. Oldest
 * due date first, at most MAX_PAID_QUESTIONS.
 */
export function paidQuestions(
  payments: readonly Payment[],
  candidates: ReadonlyMap<number, readonly PayableTx[]>,
  dismissed: ReadonlySet<string>,
  today: string,
  rates: Readonly<Record<string, number>> = {},
): PaidQuestion[] {
  const now = dayNumber(today);
  const due = payments
    .filter((p) => p.kind !== "tax" && p.paid_at === null && p.transaction_id === null && (p.linked ?? 0) === 0)
    .filter((p) => now - dayNumber(p.due_on) > PAID_QUESTION_DAYS)
    .sort((a, b) => (a.due_on < b.due_on ? -1 : a.due_on > b.due_on ? 1 : a.id - b.id));
  const used = new Set<number>();
  const out: PaidQuestion[] = [];
  for (const p of due) {
    if (out.length >= MAX_PAID_QUESTIONS) break;
    const dueDay = dayNumber(p.due_on);
    let best: { tx: PayableTx; gap: number; dist: number } | null = null;
    for (const tx of candidates.get(p.id) ?? []) {
      if (tx.amount >= 0 || tx.type === "own_transfer" || used.has(tx.id) || dismissed.has(`${p.id}:${tx.id}`)) continue;
      const gap = amountGap(tx, p, rates);
      if (gap === null) continue;
      const dist = Math.abs(dayNumber(tx.localDate) - dueDay);
      if (!best || gap < best.gap || (gap === best.gap && (dist < best.dist || (dist === best.dist && tx.id < best.tx.id)))) {
        best = { tx, gap, dist };
      }
    }
    if (!best) continue;
    used.add(best.tx.id);
    out.push({ payment: p, tx: best.tx });
  }
  return out;
}

/** A real tax row (the owner's figure) closes on payments that differ from it by up to ₴20 in all. */
export const TAX_EXACT_TOLERANCE = 2_000;
/** The app's estimate closes on payments within 10% of it: the estimate is a guess at the owner's figure. */
export const TAX_ESTIMATE_TOLERANCE = 0.1;
/** A payment more than 30 days after the row's due date is not taken as paying it. */
export const TAX_WINDOW_DAYS = 30;

/**
 * A tax row the owner closed by hand («Оплачено») takes payments in its window up to its amount plus this
 * share (the owner's decisions on Б30, «Да, узкое»): only what is beyond goes to the next quarter. Open rows
 * keep their tolerance on both sides.
 */
export const TAX_OVERPAY_SHARE = 0.1;

/** How far the payments may be from a tax row, in minor units, and still settle it. */
export function taxTolerance(p: Pick<Payment, "amount" | "is_estimate">): number {
  return p.is_estimate ? Math.round(p.amount * TAX_ESTIMATE_TOLERANCE) : TAX_EXACT_TOLERANCE;
}

/** The most the payments linked to a hand-closed tax row may add up to: its amount plus 10%, or its tolerance if that is more. */
export function taxCap(p: Pick<Payment, "amount" | "is_estimate">): number {
  return Math.max(p.amount + taxTolerance(p), Math.round(p.amount * (1 + TAX_OVERPAY_SHARE)));
}

/** The payments linked to a tax row (`linked`, minor units) add up to it within its tolerance, or more: it takes nothing more. */
export function taxCovered(p: Pick<Payment, "amount" | "is_estimate">, linked: number): boolean {
  return linked > 0 && linked >= p.amount - taxTolerance(p);
}

export interface TaxShare {
  payment: Payment;
  /** Operations to link to the payment through payment_links: this one, and its pair if any. */
  ids: number[];
  /** The payment was open and is now paid. */
  closes: boolean;
  /** The operations linked before as a part are let go: this payment alone settles the row. */
  release: boolean;
}

/** Hryvnia paid by an outgoing row, positive; null when unknown. */
function paidUah(tx: PayableTx): number | null {
  const uah = tx.amountUah ?? (tx.currency === "UAH" ? tx.amount : null);
  return uah === null ? null : Math.abs(uah);
}

/** An outgoing tax row that may pay this tax row: after its quarter ended and not long after its due date. */
function inTaxWindow(tx: PayableTx, p: Payment): boolean {
  if (tx.type !== "tax" || tx.amount >= 0) return false;
  if (tx.localDate <= quarterBounds(p.tax_quarter ?? precedingQuarter(p.due_on)).end) return false;
  return dayNumber(tx.localDate) - dayNumber(p.due_on) <= TAX_WINDOW_DAYS;
}

/**
 * A tax paid in parts or with a sum off the row (tasks Б24, Б30), for rows the exact match left.
 * Candidates are hryvnia tax rows not settled through `transaction_id`, whose quarter ended before the
 * payment, at most TAX_WINDOW_DAYS after their due date. An open row is settled by a total within its
 * `taxTolerance` either way. A row the owner closed by hand («Оплачено») takes a total from its tolerance
 * below it up to `taxCap` above it (10% over): a tax paid in its window belongs to that quarter first.
 * The steps, oldest due date first within each:
 * 1. with the parts already linked to a row, this payment completes it;
 * 2. this payment alone settles a row (parts guessed before are let go);
 * 3. this payment and one unlinked tax payment from `others` together settle a row with nothing linked;
 * 4. a row it does not settle yet takes it as a part; an open row stays open and reserved;
 * 5. a hand-closed row its links already settle takes it while their total stays within `taxCap`.
 * They run as: 1-3 over open rows, 1-3 over hand-closed rows, 4 over open rows, 4 over hand-closed rows,
 * then 5. An open row is still reserved and a closed one is not, so a payment that can pay an open row
 * goes there; but a payment that pays a row by itself is not taken as a part of another one.
 * Links are whole operations: a payment that would take a row's total past its bound is not linked at
 * all, and counts against the current quarter as before. Only an open row is closed here (`closes`); one
 * the owner closed keeps his mark.
 */
export function matchTaxShare(tx: PayableTx, payments: readonly Payment[], others: readonly PayableTx[]): TaxShare | null {
  const x = paidUah(tx);
  if (tx.type !== "tax" || tx.amount >= 0 || x === null) return null;
  const tol = (p: Payment) => taxTolerance(p);
  const linked = (p: Payment) => p.linked ?? 0;
  const byHand = (p: Payment) => p.paid_at !== null;
  const cap = (p: Payment) => (byHand(p) ? taxCap(p) : p.amount + tol(p));
  const inWindow = payments
    .filter((p) => p.kind === "tax" && p.currency === "UAH" && p.transaction_id === null && inTaxWindow(tx, p))
    .sort((a, b) => (a.due_on < b.due_on ? -1 : a.due_on > b.due_on ? 1 : a.id - b.id));
  const uncovered = inWindow.filter((p) => !taxCovered(p, linked(p)));
  const fits = (p: Payment, sum: number) => sum >= p.amount - tol(p) && sum <= cap(p);
  const share = (p: Payment, ids: number[], release = false): TaxShare => ({ payment: p, ids, closes: p.paid_at === null, release });
  const today = dayNumber(tx.localDate);

  const settle = (rows: readonly Payment[]): TaxShare | null => {
    for (const p of rows) if (linked(p) > 0 && fits(p, linked(p) + x)) return share(p, [tx.id]);
    for (const p of rows) if (fits(p, x)) return share(p, [tx.id], linked(p) > 0);
    for (const p of rows) {
      if (linked(p) > 0) continue;
      const partner = others
        .filter((o) => o.id !== tx.id && inTaxWindow(o, p))
        .filter((o) => {
          const y = paidUah(o);
          return y !== null && fits(p, x + y);
        })
        .sort((a, b) => Math.abs(dayNumber(a.localDate) - today) - Math.abs(dayNumber(b.localDate) - today) || a.id - b.id)[0];
      if (partner) return share(p, [tx.id, partner.id]);
    }
    return null;
  };
  const part = (rows: readonly Payment[]): TaxShare | null => {
    for (const p of rows) {
      if (linked(p) + x < p.amount - tol(p)) return { payment: p, ids: [tx.id], closes: false, release: false };
    }
    return null;
  };
  const open = uncovered.filter((p) => !byHand(p));
  const closed = uncovered.filter(byHand);
  const found = settle(open) ?? settle(closed) ?? part(open) ?? part(closed);
  if (found) return found;
  for (const p of inWindow) {
    if (byHand(p) && taxCovered(p, linked(p)) && linked(p) + x <= taxCap(p)) return share(p, [tx.id]);
  }
  return null;
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

/**
 * The day an income of `period` (YYYY-MM) is expected: its window's last day, clamped to the month's length
 * (task Б28). The latest day, not the first or the middle: the limit divides by the days to the next income,
 * so more days give a lower, safe limit; an income that comes early is simply received early, and it is
 * late only once its whole window has passed. Only the end counts, so a window whose start is after its end
 * (the API refuses one) still gets a date.
 */
export function windowEndDate(period: string, windowEndDay: number): string {
  const last = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
  return `${period}-${String(Math.min(windowEndDay, last)).padStart(2, "0")}`;
}

/** Events for the month of `today` and the next one, one per expected income per month, on its window's end. */
export function monthlyEvents(expected: readonly ExpectedForEvents[], today: string): PlannedEvent[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const out: PlannedEvent[] = [];
  for (let i = 0; i < 2; i++) {
    const y = year + Math.floor((month - 1 + i) / 12);
    const m = ((month - 1 + i) % 12) + 1;
    const period = `${y}-${String(m).padStart(2, "0")}`;
    for (const e of expected) {
      out.push({ expected_income_id: e.id, period, expected_on: windowEndDate(period, e.window_end_day), status: "expected" });
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
