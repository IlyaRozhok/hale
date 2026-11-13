import { describe, expect, it } from "vitest";
import { creditPart } from "./credit";

// A black card with a ₴20,000 limit: own money is the balance minus the limit.
const LIMIT = 2_000_000;
const spend = (amount: number, balanceAfter: number, over: Partial<Parameters<typeof creditPart>[0]> = {}) =>
  creditPart({ amount, balanceAfter, creditLimit: LIMIT, currency: "UAH", ...over });

describe("creditPart: how much of a spend came out of the credit limit", () => {
  it("paid wholly from own money: nothing", () => {
    expect(spend(-42_000, 2_500_000)).toBeNull();
  });

  it("own money ends exactly at zero: nothing, the limit is untouched", () => {
    expect(spend(-42_000, LIMIT)).toBeNull();
  });

  it("crosses the boundary: only the part below the limit", () => {
    // ₴700 of own money before, ₴1,800 spent: ₴1,100 from the limit.
    expect(spend(-180_000, LIMIT - 110_000)).toBe(110_000);
  });

  it("own money was already below zero: the whole spend", () => {
    expect(spend(-16_000, LIMIT - 300_000)).toBe(16_000);
  });

  it("own money was exactly zero before: the whole spend", () => {
    expect(spend(-16_000, LIMIT - 16_000)).toBe(16_000);
  });

  it("an account without a limit: nothing, even when the balance is below zero", () => {
    expect(spend(-16_000, -5_000, { creditLimit: 0 })).toBeNull();
  });

  it("an old row without the stored limit or balance: nothing", () => {
    expect(spend(-16_000, LIMIT - 300_000, { creditLimit: null })).toBeNull();
    expect(creditPart({ amount: -16_000, balanceAfter: null, creditLimit: LIMIT, currency: "UAH" })).toBeNull();
  });

  it("money coming in, or a zero amount: nothing", () => {
    expect(spend(50_000, LIMIT - 300_000)).toBeNull();
    expect(spend(0, LIMIT - 300_000)).toBeNull();
  });

  it("an account in another currency: nothing (the card shows hryvnias)", () => {
    expect(spend(-1_000, LIMIT - 300_000, { currency: "USD" })).toBeNull();
  });
});
