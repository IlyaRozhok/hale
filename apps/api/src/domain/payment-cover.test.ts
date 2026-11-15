import { describe, expect, it } from "vitest";
import { PAYMENT_COVER_TOLERANCE, paymentCover } from "./payment-cover";
import { TAX_EXACT_TOLERANCE } from "./recurring-match";

describe("paymentCover", () => {
  it("allows the same ₴20 short as a tax row (task Б24)", () => {
    expect(PAYMENT_COVER_TOLERANCE).toBe(2_000);
    expect(PAYMENT_COVER_TOLERANCE).toBe(TAX_EXACT_TOLERANCE);
  });

  it("closes on the exact amount, and on more than it", () => {
    expect(paymentCover(1_700_000, 1_700_000)).toEqual({ closed: true, remaining: 0 });
    expect(paymentCover(1_700_000, 1_870_500)).toEqual({ closed: true, remaining: 0 });
  });

  it("closes exactly ₴20 short, not a kopeck more", () => {
    expect(paymentCover(1_700_000, 1_698_000)).toEqual({ closed: true, remaining: 0 });
    expect(paymentCover(1_700_000, 1_697_999)).toEqual({ closed: false, remaining: 2_001 });
  });

  it("stays open far below the amount and says what is left", () => {
    expect(paymentCover(1_700_000, 310_500)).toEqual({ closed: false, remaining: 1_389_500 });
  });

  it("nothing linked closes nothing, even a payment of under ₴20", () => {
    expect(paymentCover(1_700_000, 0)).toEqual({ closed: false, remaining: 1_700_000 });
    expect(paymentCover(1_500, 0)).toEqual({ closed: false, remaining: 1_500 });
  });
});
