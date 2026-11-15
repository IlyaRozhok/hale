/** Whether the operations linked to a planned payment pay it (task Б9, audit invariant 5). */

import { TAX_EXACT_TOLERANCE } from "./recurring-match";

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
