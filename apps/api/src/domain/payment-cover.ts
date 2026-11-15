/** Whether the operations linked to a planned payment pay it (task Б9, audit invariant 5). */

import { type PaymentKind, TAX_EXACT_TOLERANCE, taxCovered } from "./recurring-match";

/**
 * How far, in minor units, the linked operations may fall short of the payment and still close it:
 * the ₴20 the owner accepted for a tax paid off its row (task Б24).
 */
export const PAYMENT_COVER_TOLERANCE = TAX_EXACT_TOLERANCE;

export interface PaymentCover {
  /** The linked operations pay the payment: it closes. */
  closed: boolean;
  /** Minor units still to pay; 0 once closed. */
  remaining: number;
}

/**
 * A payment closes only when the operations linked to it add up to its amount, less at most
 * PAYMENT_COVER_TOLERANCE; more than the amount closes too. `linked` is their sum, positive, in the
 * payment's minor units. With nothing linked nothing closes: a manual close is «Оплачено» on its own.
 */
export function paymentCover(amount: number, linked: number): PaymentCover {
  const short = amount - linked;
  const closed = linked > 0 && short <= PAYMENT_COVER_TOLERANCE;
  return { closed, remaining: closed ? 0 : Math.max(0, short) };
}

export interface LinkedPayment {
  kind: PaymentKind;
  /** Minor units, positive. */
  amount: number;
  /** The app's estimate of a quarter's tax. */
  isEstimate?: boolean;
  paid: boolean;
  /** It was closed because its linked operations covered it, not by hand nor through its own operation. */
  closedByLinks: boolean;
}

/**
 * A planned payment has lost a linked operation (retyped away, or deleted): does it open again (task Б26)?
 * Only a payment its links closed, and only once what is still linked (`linked`, positive minor units) no
 * longer covers it by the rule that closed it: taxCovered for a tax row (task Б24), paymentCover for the
 * rest (task Б9). A payment the owner closed by hand stays closed whatever is left.
 */
export function reopensOnUnlink(p: LinkedPayment, linked: number): boolean {
  if (!p.paid || !p.closedByLinks) return false;
  const covered = p.kind === "tax" ? taxCovered({ amount: p.amount, is_estimate: p.isEstimate }, linked) : paymentCover(p.amount, linked).closed;
  return !covered;
}
