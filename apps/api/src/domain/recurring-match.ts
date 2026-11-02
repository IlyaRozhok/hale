/** Pure matching of bank rows to planned payments and generation of monthly income events. */

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
const KIND_BY_TYPE: Record<string, PaymentKind> = {
  obligation: "obligation",
  debt_payment: "installment",
  tax: "tax",
};
const DAY_MS = 86_400_000;
const dayNumber = (ymd: string) => Math.round(Date.parse(`${ymd}T00:00:00Z`) / DAY_MS);

function amountFits(tx: PayableTx, p: Payment): boolean {
  const out = Math.abs(tx.amount);
  if (tx.currency === p.currency && out === p.amount) return true;
  return p.currency === "UAH" && tx.amountUah !== null && Math.abs(tx.amountUah) === p.amount;
}

/**
 * The unpaid payment of the right kind that this outgoing row settles: within three days of the
 * due date, with the exact amount or the payment's match_hint in the row's text. A row the owner
 * typed `obligation` may also settle an obligation due in the same calendar month, since monthly
 * transfers float. The nearest due date wins. Paid or already linked payments are never returned.
 */
export function matchPayment(tx: PayableTx, payments: readonly Payment[]): Payment | null {
  const kind = tx.type ? KIND_BY_TYPE[tx.type] : undefined;
  if (!kind || tx.amount >= 0) return null;
  const text = tx.text.toLowerCase();
  const today = dayNumber(tx.localDate);
  let best: { p: Payment; dist: number } | null = null;
  for (const p of payments) {
    if (p.kind !== kind || p.paid_at !== null || p.transaction_id !== null) continue;
    const dist = Math.abs(dayNumber(p.due_on) - today);
    const sameMonth = kind === "obligation" && p.due_on.slice(0, 7) === tx.localDate.slice(0, 7);
    if (dist > MATCH_TOLERANCE_DAYS && !sameMonth) continue;
    const hinted = !!p.match_hint && text.includes(p.match_hint.toLowerCase());
    if (!amountFits(tx, p) && !hinted) continue;
    if (!best || dist < best.dist) best = { p, dist };
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
