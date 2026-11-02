import { describe, expect, it } from "vitest";
import { computeDaily } from "./daily";
import { taxReserve } from "./tax.js";

const base = {
  fopIncomeQuarter: 0,
  rateBp: 600,
  esvQuarter: 0,
  dayOfQuarter: 1,
  daysInQuarter: 92,
  paidAgainstCurrentQuarter: 0,
  unpaidScheduled: 0,
};

describe("taxReserve", () => {
  it("applies the rate to quarter income, rounded to the nearest kopeck", () => {
    expect(taxReserve({ ...base, fopIncomeQuarter: 22_393_160 })).toBe(1_343_590);
  });
  it("accrues ESV by elapsed days of the quarter", () => {
    expect(taxReserve({ ...base, esvQuarter: 570_702, dayOfQuarter: 33 })).toBe(204_708);
  });
  it("adds unpaid scheduled payments and subtracts paid ones", () => {
    expect(taxReserve({ ...base, unpaidScheduled: 794_634 })).toBe(794_634);
    expect(
      taxReserve({ ...base, fopIncomeQuarter: 22_393_160, paidAgainstCurrentQuarter: 1_000_000 }),
    ).toBe(343_590);
  });
  it("never goes below zero", () => {
    expect(taxReserve({ ...base, paidAgainstCurrentQuarter: 5_000 })).toBe(0);
  });
  it("accrues full ESV on the last day", () => {
    expect(taxReserve({ ...base, esvQuarter: 570_702, dayOfQuarter: 92 })).toBe(570_702);
  });
  it("paying a scheduled prior-quarter tax leaves free unchanged", () => {
    const run = (cash: number, unpaidScheduled: number) => {
      const reserve = taxReserve({ ...base, fopIncomeQuarter: 1_000_000, unpaidScheduled });
      return computeDaily({
        today: "2026-11-21", cardsMoney: cash, fopMoney: 0, binanceMoney: 0, creditLimit: 0,
        taxReserve: reserve, taxAccruedNotDue: 0, obligationsDue: 0, goalDue: 0, borrowed: 0, nextIncomeOn: "2026-12-05",
        spentToday: 0, lifestyleCapMonthly: 10_000_000, foodFloor: 45_000, bridgeDaily: null, creditPlan: null,
      }).free;
    };
    expect(run(5_000_000, 794_634)).toBe(run(5_000_000 - 794_634, 0));
  });
});
