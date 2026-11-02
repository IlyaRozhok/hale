import { describe, expect, it } from "vitest";
import { taxReserve } from "./tax.js";

const base = {
  fopIncomeQuarter: 0,
  rateBp: 600,
  esvQuarter: 0,
  dayOfQuarter: 1,
  daysInQuarter: 92,
  paidThisQuarter: 0,
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
      taxReserve({ ...base, fopIncomeQuarter: 22_393_160, paidThisQuarter: 1_000_000 }),
    ).toBe(343_590);
  });
  it("never goes below zero", () => {
    expect(taxReserve({ ...base, paidThisQuarter: 5_000 })).toBe(0);
  });
  it("accrues full ESV on the last day", () => {
    expect(taxReserve({ ...base, esvQuarter: 570_702, dayOfQuarter: 92 })).toBe(570_702);
  });
});
