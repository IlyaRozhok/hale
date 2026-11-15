import { describe, expect, it } from "vitest";
import { PAYMENT_COVER_TOLERANCE, paymentCover, reopensOnUnlink } from "./payment-cover";
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

describe("reopensOnUnlink (task Б26)", () => {
  const byLinks = { kind: "obligation" as const, amount: 1_700_000, paid: true, closedByLinks: true };

  it("a payment closed by its links reopens once what is left no longer covers it", () => {
    expect(reopensOnUnlink(byLinks, 700_000)).toBe(true);
    expect(reopensOnUnlink(byLinks, 0)).toBe(true);
  });

  it("stays closed while what is left still covers it, within the same ₴20", () => {
    expect(reopensOnUnlink(byLinks, 1_800_000)).toBe(false);
    expect(reopensOnUnlink(byLinks, 1_698_000)).toBe(false);
    expect(reopensOnUnlink(byLinks, 1_697_999)).toBe(true);
  });

  it("a payment closed by hand never reopens this way, whatever is left", () => {
    expect(reopensOnUnlink({ ...byLinks, closedByLinks: false }, 0)).toBe(false);
    expect(reopensOnUnlink({ ...byLinks, closedByLinks: false }, 700_000)).toBe(false);
  });

  it("an open payment has nothing to reopen", () => {
    expect(reopensOnUnlink({ ...byLinks, paid: false }, 0)).toBe(false);
  });

  it("a tax row follows the tax tolerance: ₴20 for the owner's figure, 10% of the app's estimate", () => {
    const tax = { kind: "tax" as const, amount: 795_000, paid: true, closedByLinks: true };
    expect(reopensOnUnlink(tax, 571_000)).toBe(true);
    expect(reopensOnUnlink(tax, 793_000)).toBe(false);
    expect(reopensOnUnlink(tax, 792_999)).toBe(true);
    const estimate = { ...tax, amount: 760_000, isEstimate: true };
    expect(reopensOnUnlink(estimate, 684_000)).toBe(false);
    expect(reopensOnUnlink(estimate, 683_999)).toBe(true);
    expect(reopensOnUnlink({ ...tax, closedByLinks: false }, 0)).toBe(false);
  });
});
