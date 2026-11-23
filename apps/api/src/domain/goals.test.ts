import { describe, expect, it } from "vitest";
import { goalSaved, leftForGoalsMonthly } from "./goals";

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

describe("goalSaved (ЯМ5)", () => {
  const goal = { savedByHand: 30_000, currency: "USD" };

  it("is the balance of the place the goal is linked to, in its currency, not what was entered by hand", () => {
    expect(goalSaved(goal, { balance: 120_000, creditLimit: 0, currency: "USD" })).toEqual({ saved: 120_000, linked: true });
  });

  it("takes a credit limit off the balance, as the place's row does, and never shows less than nothing", () => {
    expect(goalSaved(goal, { balance: 150_000, creditLimit: 100_000, currency: "USD" })).toEqual({ saved: 50_000, linked: true });
    expect(goalSaved(goal, { balance: 20_000, creditLimit: 100_000, currency: "USD" })).toEqual({ saved: 0, linked: true });
    expect(goalSaved(goal, { balance: -5_000, creditLimit: 0, currency: "USD" })).toEqual({ saved: 0, linked: true });
  });

  it("keeps what was entered by hand for a goal without a place, or whose place is gone", () => {
    expect(goalSaved(goal, null)).toEqual({ saved: 30_000, linked: false });
  });

  it("does not count a place in another currency than the goal's target: the goal is as if without a place", () => {
    expect(goalSaved(goal, { balance: 4_000_000, creditLimit: 0, currency: "UAH" })).toEqual({ saved: 30_000, linked: false });
  });
});
