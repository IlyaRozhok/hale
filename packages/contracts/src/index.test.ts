import { describe, expect, it } from "vitest";
import { expectedIncomeInput, isoDate, scheduledPaymentInput, settingsPatch } from "./index";

describe("contracts", () => {
  it("accepts only real dates", () => {
    expect(isoDate.safeParse("2026-11-20").success).toBe(true);
    expect(isoDate.safeParse("2026-02-30").success).toBe(false);
    expect(isoDate.safeParse("20-11-2026").success).toBe(false);
  });
  it("requires whole-unit money and a sane window", () => {
    const base = { kind: "tax", name: "x", currency: "UAH", due_on: "2026-11-20" };
    expect(scheduledPaymentInput.safeParse({ ...base, amount: 100 }).success).toBe(true);
    expect(scheduledPaymentInput.safeParse({ ...base, amount: 1.5 }).success).toBe(false);
    expect(
      expectedIncomeInput.safeParse({ source: "fop", amount: 1, currency: "USD", window_start_day: 25, window_end_day: 15 }).success,
    ).toBe(false);
  });
  it("rejects unknown settings keys", () => {
    expect(settingsPatch.safeParse({ nope: 1 }).success).toBe(false);
  });
});
