import { describe, expect, it } from "vitest";
import { leftForGoalsMonthly } from "./goals";

const base = { income: 20_500_000, fopIncome: 500_000, taxRateBp: 600, esvQuarter: 0, recurring: 2_000_000, installments: 0, lifestyleCap: 3_000_000, paysFopTax: true };

describe("leftForGoalsMonthly", () => {
  it("subtracts tax on FOP income, a third of the quarterly ESV, recurring payments, installments and the cap", () => {
    expect(leftForGoalsMonthly(base)).toBe(15_470_000);
    expect(leftForGoalsMonthly({ ...base, esvQuarter: 300_000 })).toBe(15_370_000);
    expect(leftForGoalsMonthly({ ...base, installments: 1_000_000 })).toBe(14_470_000);
  });

  it("taxes only the FOP part of income", () => {
    expect(leftForGoalsMonthly({ ...base, fopIncome: 0 })).toBe(15_500_000);
  });

  it("subtracts no ESV when no income pays the fop tax (Д4)", () => {
    expect(leftForGoalsMonthly({ ...base, fopIncome: 0, esvQuarter: 300_000, paysFopTax: false })).toBe(15_500_000);
  });

  it("is never negative", () => {
    expect(leftForGoalsMonthly({ ...base, lifestyleCap: 100_000_000 })).toBe(0);
  });
});
