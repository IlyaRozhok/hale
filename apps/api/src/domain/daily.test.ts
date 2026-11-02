import { describe, expect, it } from "vitest";
import { computeDaily, sumDue, type DailyInput } from "./daily.js";

const input = (o: Partial<DailyInput> = {}): DailyInput => ({
  today: "2026-11-02",
  cardsMoney: 1_032_500,
  fopMoney: 0,
  binanceMoney: 0,
  creditLimit: 3_000_000,
  taxReserve: 0,
  taxAccruedNotDue: 0,
  obligationsDue: 2_229_500,
  goalDue: 0,
  borrowed: 0,
  nextIncomeOn: "2026-11-20",
  spentToday: 0,
  lifestyleCapMonthly: 10_000_000,
  foodFloor: 45_000,
  bridgeDaily: null,
  creditPlan: null,
  ...o,
});

describe("sumDue", () => {
  const pay = (dueOn: string, amount = 100, paid = false) => ({ dueOn, amount, paid });
  it("includes the 18th and excludes the 20th when income is on the 20th", () => {
    const r = sumDue([pay("2026-11-18", 529_500), pay("2026-11-20", 1_700_000)], "2026-11-02", "2026-11-20");
    expect(r).toBe(529_500);
  });
  it("includes today and counts unpaid overdue payments", () => {
    const r = sumDue(
      [pay("2026-11-02", 1), pay("2026-10-30", 10), pay("2026-10-01", 100, true)],
      "2026-11-02",
      "2026-11-20",
    );
    expect(r).toBe(11);
  });
  it("past nextIncomeOn counts upcoming (30 days) and overdue payments", () => {
    const r = sumDue([pay("2026-10-20", 1), pay("2026-11-15", 10), pay("2026-12-02", 100)], "2026-11-02", "2026-10-30");
    expect(r).toBe(11);
  });
  it("skips paid payments", () => {
    expect(sumDue([pay("2026-11-10", 500, true)], "2026-11-02", "2026-11-20")).toBe(0);
  });
  it("uses a 30-day window plus overdue when income date is unknown", () => {
    const r = sumDue(
      [pay("2026-10-20", 1), pay("2026-12-01", 10), pay("2026-12-02", 100)],
      "2026-11-02",
      null,
    );
    expect(r).toBe(11);
  });
});

describe("computeDaily bridge mode", () => {
  it("enters bridge when free is negative, no tax", () => {
    const s = computeDaily(input({ bridgeDaily: 45_000 }));
    expect(s.mode).toBe("bridge");
    expect(s.daysLeft).toBe(18);
    expect(s.free).toBe(-1_197_000);
    expect(s.bridge?.creditNeeded).toBe(2_007_000);
    expect(s.bridge?.shortfall).toBe(0);
  });
  it("computes creditNeeded at 100,000 a day, no tax", () => {
    const s = computeDaily(input({ bridgeDaily: 100_000 }));
    expect(s.bridge?.creditNeeded).toBe(2_997_000);
  });
  it("includes the tax reserve", () => {
    const s = computeDaily(input({ taxReserve: 794_634, bridgeDaily: 45_000 }));
    expect(s.free).toBe(-1_991_634);
    expect(s.bridge?.creditNeeded).toBe(2_801_634);
    expect(s.bridge?.shortfall).toBe(0);
    expect(s.bridge?.recommendedDaily).toBe(45_000);
    expect(s.bridge?.maxDailyWithinCredit).toBe(56_020);
    expect(s.bridge?.overPlan).toBe(false);
  });
  it("reports shortfall when the plan exceeds available credit", () => {
    const s = computeDaily(input({ taxReserve: 794_634, bridgeDaily: 100_000 }));
    expect(s.bridge?.creditNeeded).toBe(3_791_634);
    expect(s.bridge?.shortfall).toBe(791_634);
  });
  it("recommends foodFloor and uses it as dailyLimit when bridgeDaily is null", () => {
    const s = computeDaily(input({ spentToday: 10_000 }));
    expect(s.bridge?.recommendedDaily).toBe(45_000);
    expect(s.dailyLimit).toBe(45_000);
    expect(s.leftToday).toBe(35_000);
    expect(s.level).toBeCloseTo(35_000 / 45_000);
  });
  it("uses the chosen bridgeDaily as dailyLimit", () => {
    const s = computeDaily(input({ bridgeDaily: 30_000 }));
    expect(s.dailyLimit).toBe(30_000);
  });
  it("keeps foodFloor as recommendation with a positive shortfall when even it does not fit", () => {
    const s = computeDaily(input({ taxReserve: 794_634, creditLimit: 1_000_000 }));
    expect(s.bridge?.recommendedDaily).toBe(45_000);
    expect(s.bridge?.shortfall).toBe(1_801_634);
    expect(s.bridge?.shortfall).toBeGreaterThan(0);
  });
  it("handles negative own money: shortfall measured against the full limit", () => {
    // own -500,000 (card debt), obligations 300,000: free -800,000; 18 days at 45,000 = 810,000
    const s = computeDaily(input({ cardsMoney: -500_000, obligationsDue: 300_000, creditLimit: 1_500_000 }));
    expect(s.free).toBe(-800_000);
    expect(s.bridge?.creditNeeded).toBe(1_610_000);
    expect(s.bridge?.shortfall).toBe(110_000);
  });
  it("clamps maxDailyWithinCredit at 0", () => {
    const s = computeDaily(input({ creditLimit: 0 }));
    expect(s.bridge?.maxDailyWithinCredit).toBe(0);
  });
  it("overPlan only when own money is below -creditPlan", () => {
    expect(computeDaily(input({ cardsMoney: -2_000_000, creditPlan: 2_000_000 })).bridge?.overPlan).toBe(false);
    expect(computeDaily(input({ cardsMoney: -2_000_001, creditPlan: 2_000_000 })).bridge?.overPlan).toBe(true);
    expect(computeDaily(input({ cardsMoney: 0, fopMoney: -2_000_001, creditPlan: 2_000_000 })).bridge?.overPlan).toBe(true);
    expect(computeDaily(input({ cardsMoney: -1_000_000, binanceMoney: -1_000_001, creditPlan: 2_000_000 })).bridge?.overPlan).toBe(true);
    expect(computeDaily(input({ cardsMoney: -1_000_000, binanceMoney: 500_000, creditPlan: 2_000_000 })).bridge?.overPlan).toBe(false);
    expect(computeDaily(input({ cardsMoney: -9_000_000, creditPlan: null })).bridge?.overPlan).toBe(false);
  });
});

describe("computeDaily normal mode", () => {
  const rich = { cardsMoney: 30_000_000, obligationsDue: 0, nextIncomeOn: "2026-12-02" };
  it("caps the limit at lifestyleCap / 30", () => {
    const s = computeDaily(input({ ...rich }));
    expect(s.mode).toBe("normal");
    expect(s.bridge).toBeNull();
    expect(s.daysLeft).toBe(30);
    expect(s.dailyLimit).toBe(333_333);
  });
  it("divides free over the days when below the cap", () => {
    const s = computeDaily(input({ ...rich, cardsMoney: 900_000 }));
    expect(s.dailyLimit).toBe(30_000);
  });
  it("rounds the daily limit down", () => {
    const s = computeDaily(input({ ...rich, cardsMoney: 100_000 }));
    expect(s.dailyLimit).toBe(3_333);
  });
  it("allows negative leftToday and clamps level to 0", () => {
    const s = computeDaily(input({ ...rich, cardsMoney: 900_000, spentToday: 40_000 }));
    expect(s.leftToday).toBe(-10_000);
    expect(s.level).toBe(0);
  });
  it("clamps level to 1 when spentToday is negative (refund)", () => {
    const s = computeDaily(input({ ...rich, cardsMoney: 900_000, spentToday: -5_000 }));
    expect(s.level).toBe(1);
  });
  it("free exactly 0 is normal with level 0", () => {
    const s = computeDaily(input({ ...rich, cardsMoney: 0 }));
    expect(s.mode).toBe("normal");
    expect(s.free).toBe(0);
    expect(s.dailyLimit).toBe(0);
    expect(s.level).toBe(0);
  });
  it("sums fop and binance and subtracts goals and borrowed", () => {
    const s = computeDaily(
      input({ ...rich, cardsMoney: 100_000, fopMoney: 200_000, binanceMoney: 300_000, goalDue: 50_000, borrowed: 50_000 }),
    );
    expect(s.free).toBe(500_000);
  });
});

describe("computeDaily income date", () => {
  it("null nextIncomeOn means needsIncomeDate and 30 days", () => {
    const s = computeDaily(input({ nextIncomeOn: null, cardsMoney: 3_000_000, obligationsDue: 0 }));
    expect(s.needsIncomeDate).toBe(true);
    expect(s.daysLeft).toBe(30);
  });
  it("past nextIncomeOn is treated like null", () => {
    const s = computeDaily(input({ nextIncomeOn: "2026-10-30" }));
    expect(s.needsIncomeDate).toBe(true);
    expect(s.daysLeft).toBe(30);
  });
  it("income today leaves at least one day", () => {
    const s = computeDaily(input({ nextIncomeOn: "2026-11-02", cardsMoney: 100_000, obligationsDue: 0 }));
    expect(s.needsIncomeDate).toBe(false);
    expect(s.daysLeft).toBe(1);
  });
  it("counts days across the 2026-10-25 DST change", () => {
    const s = computeDaily(input({ today: "2026-10-24", nextIncomeOn: "2026-10-27" }));
    expect(s.daysLeft).toBe(3);
  });
});

describe("computeDaily bridge with accrued tax not yet due", () => {
  it("keeps accrued tax in free but leaves it out of the credit needed", () => {
    // free = 1,032,500 - 2,229,500 - 794,634 - 204,708 = -2,196,342; the 204,708 accrual is not cash due before the income
    const r = computeDaily(input({ taxReserve: 794_634 + 204_708, taxAccruedNotDue: 204_708, bridgeDaily: 45_000 }));
    expect(r.mode).toBe("bridge");
    expect(r.free).toBe(-2_196_342);
    expect(r.bridge!.creditNeeded).toBe(1_991_634 + 45_000 * 18);
    expect(r.bridge!.shortfall).toBe(0);
    expect(r.bridge!.maxDailyWithinCredit).toBe(Math.floor((3_000_000 - 1_991_634) / 18));
  });

  it("never lets the credit needed go below zero", () => {
    const r = computeDaily(input({ obligationsDue: 1_000_000, taxReserve: 100_000, taxAccruedNotDue: 100_000, foodFloor: 0 }));
    expect(r.free).toBe(-67_500);
    expect(r.bridge!.creditNeeded).toBe(0);
  });
});
