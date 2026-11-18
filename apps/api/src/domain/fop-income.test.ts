import { describe, expect, it } from "vitest";
import { type FopIncome, fopIncomeByPeriod, fopIncomePeriod, waitsForLateIncome } from "./fop-income";

const inc = (id: number, localDate: string, amountUah: number): FopIncome => ({
  id,
  localDate,
  occurredAt: new Date(`${localDate}T10:00:00Z`),
  amountUah,
});

describe("fopIncomePeriod (Б46)", () => {
  it("an income before the month's window goes to last month while last month still waits", () => {
    expect(fopIncomePeriod("2026-11-02", 25, true)).toBe("2026-10");
    expect(fopIncomePeriod("2026-11-24", 25, true)).toBe("2026-10");
  });

  it("from the window's first day on, the income is the month's own", () => {
    expect(fopIncomePeriod("2026-11-25", 25, true)).toBe("2026-11");
    expect(fopIncomePeriod("2026-11-28", 25, true)).toBe("2026-11");
  });

  it("goes to its own month when last month does not wait", () => {
    expect(fopIncomePeriod("2026-11-02", 25, false)).toBe("2026-11");
  });

  it("a window that starts on the 1st changes nothing", () => {
    expect(fopIncomePeriod("2026-11-01", 1, true)).toBe("2026-11");
    expect(fopIncomePeriod("2026-11-02", 1, true)).toBe("2026-11");
  });

  it("January's early income goes to December of the year before", () => {
    expect(fopIncomePeriod("2027-01-03", 10, true)).toBe("2026-12");
  });
});

describe("waitsForLateIncome (Б46)", () => {
  it("an event still expected waits", () => {
    expect(waitsForLateIncome({ period: "2026-10", received: false, matchedOn: null })).toBe(true);
  });

  it("an event received by its own month's income does not", () => {
    expect(waitsForLateIncome({ period: "2026-10", received: true, matchedOn: "2026-10-26" })).toBe(false);
  });

  it("an event confirmed by hand does not", () => {
    expect(waitsForLateIncome({ period: "2026-10", received: true, matchedOn: null })).toBe(false);
  });

  it("an event received by a late income from next month still takes the rest of that late money", () => {
    expect(waitsForLateIncome({ period: "2026-10", received: true, matchedOn: "2026-11-02" })).toBe(true);
  });
});

describe("fopIncomeByPeriod (Б46)", () => {
  it("October's late money goes to October, November's own to November, each with its own sum and first row", () => {
    const r = fopIncomeByPeriod(
      [inc(1, "2026-11-02", 100_000), inc(2, "2026-11-05", 50_000), inc(3, "2026-11-26", 400_000), inc(4, "2026-11-27", 20_000)],
      25,
      new Set(["2026-10"]),
    );
    expect(r.periodOf).toEqual(new Map([[1, "2026-10"], [2, "2026-10"], [3, "2026-11"], [4, "2026-11"]]));
    expect(r.months.get("2026-10")).toEqual({ sum: 150_000, firstId: 1, firstAt: new Date("2026-11-02T10:00:00Z") });
    expect(r.months.get("2026-11")).toEqual({ sum: 420_000, firstId: 3, firstAt: new Date("2026-11-26T10:00:00Z") });
  });

  it("with no month waiting, every income is its calendar month's, as before", () => {
    const r = fopIncomeByPeriod([inc(1, "2026-11-02", 100_000), inc(2, "2026-11-26", 400_000)], 25, new Set());
    expect([...r.months.entries()]).toEqual([["2026-11", { sum: 500_000, firstId: 1, firstAt: new Date("2026-11-02T10:00:00Z") }]]);
  });

  it("October's own income ends its wait: early November money after it is November's", () => {
    const r = fopIncomeByPeriod([inc(1, "2026-10-27", 500_000), inc(2, "2026-11-02", 100_000)], 25, new Set(["2026-10", "2026-11"]));
    expect(r.periodOf).toEqual(new Map([[1, "2026-10"], [2, "2026-11"]]));
  });

  it("October's early money given to September does not end October's wait", () => {
    const r = fopIncomeByPeriod([inc(1, "2026-10-03", 500_000), inc(2, "2026-11-02", 100_000)], 25, new Set(["2026-09", "2026-10"]));
    expect(r.periodOf).toEqual(new Map([[1, "2026-09"], [2, "2026-10"]]));
  });

  it("an early income in a month whose previous month does not wait stays in its month even when an older month waits", () => {
    const r = fopIncomeByPeriod([inc(1, "2026-11-02", 100_000)], 25, new Set(["2026-09"]));
    expect(r.periodOf.get(1)).toBe("2026-11");
  });
});
