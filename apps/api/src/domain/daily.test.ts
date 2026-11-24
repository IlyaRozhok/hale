import { describe, expect, it } from "vitest";
import { computeDaily, dayMark, sumDue, type DailyInput } from "./daily.js";

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
  // Б47 (1), the owner's option А of 18 November: a payment due on the income day is reserved in advance, like one
  // the day before; it used to count as paid from the income itself.
  it("includes the 18th and the 20th and excludes the 21st when income is on the 20th", () => {
    const r = sumDue([pay("2026-11-18", 529_500), pay("2026-11-20", 1_700_000), pay("2026-11-21", 1)], "2026-11-02", "2026-11-20");
    expect(r).toBe(529_500 + 1_700_000);
  });
  it("on the income day itself, a payment due that day is still reserved", () => {
    expect(sumDue([pay("2026-11-20", 1_700_000), pay("2026-11-21", 1)], "2026-11-20", "2026-11-20")).toBe(1_700_000);
  });
  it("the 30-day horizon without an income date stays 30 days: its last day is not an income", () => {
    expect(sumDue([pay("2026-12-01", 10), pay("2026-12-02", 100)], "2026-11-02", null)).toBe(10);
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
  // These four look at the share of free money over the days, so the plan's recommended sum is set below it.
  const lowFloor = { foodFloor: 1_000 };
  it("divides free over the days when below the cap", () => {
    const s = computeDaily(input({ ...rich, ...lowFloor, cardsMoney: 900_000 }));
    expect(s.dailyLimit).toBe(30_000);
  });
  it("rounds the daily limit down", () => {
    const s = computeDaily(input({ ...rich, ...lowFloor, cardsMoney: 100_000 }));
    expect(s.dailyLimit).toBe(3_333);
  });
  it("allows negative leftToday and clamps level to 0", () => {
    const s = computeDaily(input({ ...rich, ...lowFloor, cardsMoney: 900_000, spentToday: 40_000 }));
    expect(s.leftToday).toBe(-10_000);
    expect(s.level).toBe(0);
  });
  it("clamps level to 1 when spentToday is negative (refund)", () => {
    const s = computeDaily(input({ ...rich, ...lowFloor, cardsMoney: 900_000, spentToday: -5_000 }));
    expect(s.level).toBe(1);
  });
  it("free exactly 0 is normal, on the plan's recommended sum (Б47 (3))", () => {
    const s = computeDaily(input({ ...rich, cardsMoney: 0 }));
    expect(s.mode).toBe("normal");
    expect(s.free).toBe(0);
    expect(s.bridge).toBeNull();
    expect(s.dailyLimit).toBe(45_000);
    expect(s.level).toBe(1);
  });
  it("sums fop and binance and subtracts goals and borrowed", () => {
    const s = computeDaily(
      input({ ...rich, cardsMoney: 100_000, fopMoney: 200_000, binanceMoney: 300_000, goalDue: 50_000, borrowed: 50_000 }),
    );
    expect(s.free).toBe(500_000);
  });
});

describe("computeDaily near zero free money (Б47 (3), option А)", () => {
  // Ten days to the income; obligations taken out so own money alone is the free money.
  const near = { obligationsDue: 0, nextIncomeOn: "2026-11-12" };
  it("free +₴100 over 10 days gives the recommended sum, not ₴10", () => {
    const s = computeDaily(input({ ...near, cardsMoney: 10_000 }));
    expect(s.mode).toBe("normal");
    expect(s.daysLeft).toBe(10);
    expect(s.dailyLimit).toBe(45_000);
    expect(s.bridge).toBeNull();
  });
  it("free −₴100 is still the shortage mode on the same recommended sum: no jump across zero", () => {
    const above = computeDaily(input({ ...near, cardsMoney: 10_000 }));
    const below = computeDaily(input({ ...near, cardsMoney: -10_000 }));
    expect(below.mode).toBe("bridge");
    expect(below.dailyLimit).toBe(45_000);
    expect(below.dailyLimit).toBe(above.dailyLimit);
  });
  it("the shortage mode keeps the plan's chosen sum; the normal mode does not use it", () => {
    expect(computeDaily(input({ ...near, cardsMoney: -10_000, bridgeDaily: 30_000 })).dailyLimit).toBe(30_000);
    expect(computeDaily(input({ ...near, cardsMoney: 10_000, bridgeDaily: 30_000 })).dailyLimit).toBe(45_000);
  });
  it("above the recommended sum the share of free money over the days stays the limit", () => {
    expect(computeDaily(input({ ...near, cardsMoney: 600_000 })).dailyLimit).toBe(60_000);
    expect(computeDaily(input({ ...near, cardsMoney: 450_000 })).dailyLimit).toBe(45_000);
    expect(computeDaily(input({ ...near, cardsMoney: 449_999 })).dailyLimit).toBe(45_000);
  });
  it("the owner's lifestyle cap still caps, even below the recommended sum", () => {
    // ₴9,000 a month is ₴300 a day: the cap is the ceiling the owner set.
    expect(computeDaily(input({ ...near, cardsMoney: 10_000, lifestyleCapMonthly: 900_000 })).dailyLimit).toBe(30_000);
    expect(computeDaily(input({ ...near, cardsMoney: 3_000_000, lifestyleCapMonthly: 900_000 })).dailyLimit).toBe(30_000);
  });
  it("never goes down as free money grows from below zero to well above it", () => {
    let prev = -Infinity;
    for (let cards = -50_000; cards <= 800_000; cards += 5_000) {
      const s = computeDaily(input({ ...near, cardsMoney: cards }));
      expect(s.dailyLimit).toBeGreaterThanOrEqual(prev);
      prev = s.dailyLimit;
    }
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

describe("dayMark", () => {
  it("is normal when the day is not in the shortage mode now, unless it began in it", () => {
    for (const stored of [null, "normal", "bridge_start"] as const) {
      expect(dayMark({ live: "normal", stored, previous: "bridge" })).toBe("normal");
    }
  });
  it("a day that began in shortage stays one while the money is briefly above zero, so coming back does not mark it", () => {
    const up = dayMark({ live: "normal", stored: "bridge", previous: "bridge" });
    expect(up).toBe("bridge");
    expect(dayMark({ live: "bridge", stored: up, previous: "bridge" })).toBe("bridge");
    expect(dayMark({ live: "normal", stored: "bridge", previous: "normal" })).toBe("bridge");
  });
  it("marks the day the shortage came on when a day fixed as ordinary is seen in shortage", () => {
    expect(dayMark({ live: "bridge", stored: "normal", previous: "normal" })).toBe("bridge_start");
    expect(dayMark({ live: "bridge", stored: "normal", previous: null })).toBe("bridge_start");
  });
  it("keeps the mark once it is there, and never adds it to a day already known as a shortage day", () => {
    expect(dayMark({ live: "bridge", stored: "bridge_start", previous: "normal" })).toBe("bridge_start");
    expect(dayMark({ live: "bridge", stored: "bridge", previous: "normal" })).toBe("bridge");
  });
  it("without limits to compare, a day first fixed in shortage is the start only right after an ordinary day", () => {
    expect(dayMark({ live: "bridge", stored: null, previous: "normal" })).toBe("bridge_start");
    expect(dayMark({ live: "bridge", stored: null, previous: "bridge" })).toBe("bridge");
    expect(dayMark({ live: "bridge", stored: null, previous: "bridge_start" })).toBe("bridge");
  });
  it("is not the start on the very first fixed day: there was no limit before it to replace", () => {
    expect(dayMark({ live: "bridge", stored: null, previous: null })).toBe("bridge");
  });
  // Б47 (3): near zero the ordinary limit is already the recommended sum, so crossing zero may change nothing.
  it("a day crossing into shortage on the limit it already has is not the start: nothing to spare it from", () => {
    expect(dayMark({ live: "bridge", stored: "normal", previous: "normal", storedLimit: 45_000, limit: 45_000 })).toBe("bridge");
    expect(dayMark({ live: "bridge", stored: "normal", previous: null, storedLimit: 45_000, limit: 45_000 })).toBe("bridge");
  });
  it("a day crossing into shortage onto another limit is the start, in either direction", () => {
    // Below the floor the owner's cap made the ordinary limit ₴300; the shortage one is ₴450.
    expect(dayMark({ live: "bridge", stored: "normal", previous: "normal", storedLimit: 30_000, limit: 45_000 })).toBe("bridge_start");
    expect(dayMark({ live: "bridge", stored: "normal", previous: "normal", storedLimit: 100_000, limit: 45_000 })).toBe("bridge_start");
  });
  it("a day that crossed on the same limit becomes the start once its limit changes the same day (a plan chosen)", () => {
    const crossed = dayMark({ live: "bridge", stored: "normal", previous: "normal", storedLimit: 45_000, limit: 45_000 });
    expect(dayMark({ live: "bridge", stored: crossed, previous: "normal", storedLimit: 45_000, limit: 45_000 })).toBe("bridge");
    expect(dayMark({ live: "bridge", stored: crossed, previous: "normal", storedLimit: 45_000, limit: 30_000 })).toBe("bridge_start");
    // A day already in shortage the day before is an ordinary shortage day, whatever its limit does.
    expect(dayMark({ live: "bridge", stored: "bridge", previous: "bridge", storedLimit: 45_000, limit: 30_000 })).toBe("bridge");
  });
  // Б47 (4): for a day with no row, `storedLimit` is the limit it is being fixed with (its morning one).
  it("a day that began in shortage right after an ordinary day is an ordinary shortage day, not the start", () => {
    expect(dayMark({ live: "bridge", stored: null, previous: "normal", storedLimit: 45_000, limit: 45_000 })).toBe("bridge");
    // Fixed so, it stays that through the day while its limit holds.
    expect(dayMark({ live: "bridge", stored: "bridge", previous: "normal", storedLimit: 45_000, limit: 45_000 })).toBe("bridge");
  });
  it("a day fixed for the first time after it crossed into shortage onto another limit is still the start", () => {
    // The morning was ordinary at ₴1,000; the spending before the first fix took it into shortage at ₴450.
    expect(dayMark({ live: "bridge", stored: null, previous: "normal", storedLimit: 100_000, limit: 45_000 })).toBe("bridge_start");
  });
  it("reads a value it does not know as an ordinary shortage day, so nothing is marked by mistake", () => {
    expect(dayMark({ live: "bridge", stored: "other", previous: "normal" })).toBe("bridge");
    expect(dayMark({ live: "bridge", stored: null, previous: "other" })).toBe("bridge");
  });
});

describe("computeDaily parts of the limit (ЧЛ2)", () => {
  // 10 days to the income; free money is what `cardsMoney` says; the cap is ₴1,000 a day.
  const plain = (o: Partial<DailyInput> = {}) =>
    input({ obligationsDue: 0, nextIncomeOn: "2026-11-12", foodFloor: 45_000, lifestyleCapMonthly: 3_000_000, ...o });
  /** The limit as it was computed before the parts existed: the figures must not move. */
  const before = (i: DailyInput, free: number, days: number) =>
    free < 0 ? (i.bridgeDaily ?? i.foodFloor) : Math.floor(Math.min(Math.max(free / days, i.foodFloor), i.lifestyleCapMonthly / 30));

  it("own money less each reserve is the free money, and the parts carry the engine's days and limit", () => {
    const cases: Partial<DailyInput>[] = [
      {},
      { cardsMoney: 4_000_000, fopMoney: 700_000, binanceMoney: 123_456, taxReserve: 310_000, obligationsDue: 529_500, goalDue: 40_000, borrowed: 200_000 },
      { cardsMoney: -500_000, obligationsDue: 300_000 },
      { cardsMoney: 100, obligationsDue: 0, nextIncomeOn: null },
      { cardsMoney: 30_000_000, obligationsDue: 0, bridgeDaily: 60_000 },
      { bridgeDaily: 60_000, spentToday: 5_000 },
    ];
    for (const c of cases) {
      const s = computeDaily(input(c));
      const p = s.parts;
      expect(p.own - p.taxReserve - p.obligationsDue - p.goalDue - p.borrowed).toBe(p.free);
      expect(p.free).toBe(s.free);
      expect(p.daysLeft).toBe(s.daysLeft);
      expect(p.dailyLimit).toBe(s.dailyLimit);
      expect(p.share).toBe(Math.floor(p.free / p.daysLeft));
    }
    expect(computeDaily(input(cases[1])).parts).toMatchObject({
      own: 4_823_456, taxReserve: 310_000, obligationsDue: 529_500, goalDue: 40_000, borrowed: 200_000, free: 3_743_956,
    });
  });

  it("the limit is the one computed before the parts existed, on a grid around every boundary", () => {
    for (const cardsMoney of [-1, 0, 1, 9, 449_990, 450_000, 450_005, 999_999, 1_000_000, 1_000_007, 5_000_000]) {
      for (const foodFloor of [0, 1, 45_000, 100_000, 100_001, 250_000]) {
        for (const lifestyleCapMonthly of [1, 29, 30, 1_349_999, 1_350_000, 3_000_000, 3_000_029, 10_000_000]) {
          for (const nextIncomeOn of ["2026-11-02", "2026-11-05", "2026-11-12", null]) {
            for (const bridgeDaily of [null, 60_000]) {
              const i = plain({ cardsMoney, foodFloor, lifestyleCapMonthly, nextIncomeOn, bridgeDaily });
              const s = computeDaily(i);
              expect(s.dailyLimit).toBe(before(i, s.free, s.daysLeft));
              expect(s.parts.dailyLimit).toBe(s.dailyLimit);
            }
          }
        }
      }
    }
  });

  it("share: free money over the days, between the recommended sum and the cap", () => {
    const p = computeDaily(plain({ cardsMoney: 700_000 })).parts;
    expect(p).toMatchObject({ rule: "share", share: 70_000, dailyLimit: 70_000, daysLeft: 10 });
  });
  it("share on a tie: a cap equal to the share lowers nothing, a recommended sum equal to it raises nothing", () => {
    expect(computeDaily(plain({ cardsMoney: 1_000_000 })).parts).toMatchObject({ rule: "share", share: 100_000, dailyLimit: 100_000 });
    expect(computeDaily(plain({ cardsMoney: 450_000 })).parts).toMatchObject({ rule: "share", share: 45_000, dailyLimit: 45_000 });
    // The cap's kopeck fraction is dropped as the share's is: ₴30,000.29 a month is the same ₴1,000 a day.
    expect(computeDaily(plain({ cardsMoney: 1_000_005, lifestyleCapMonthly: 3_000_029 })).parts).toMatchObject({ rule: "share", dailyLimit: 100_000 });
  });
  it("cap: the cap is below the share", () => {
    const p = computeDaily(plain({ cardsMoney: 2_000_000 })).parts;
    expect(p).toMatchObject({ rule: "cap", share: 200_000, dailyLimit: 100_000 });
  });
  it("floor: the share is below the recommended sum and the cap is not", () => {
    const p = computeDaily(plain({ cardsMoney: 100_000 })).parts;
    expect(p).toMatchObject({ rule: "floor", share: 10_000, dailyLimit: 45_000 });
    // A cap equal to the recommended sum lowers nothing: the recommended sum raised the share.
    expect(computeDaily(plain({ cardsMoney: 100_000, lifestyleCapMonthly: 1_350_000 })).parts).toMatchObject({ rule: "floor", dailyLimit: 45_000 });
  });
  it("cap wins whenever it is below the larger of the share and the recommended sum", () => {
    const cap = { lifestyleCapMonthly: 900_000 }; // ₴300 a day, below the recommended ₴450
    // Below both: the share ₴2,000, the recommended ₴450.
    expect(computeDaily(plain({ ...cap, cardsMoney: 2_000_000 })).parts).toMatchObject({ rule: "cap", share: 200_000, dailyLimit: 30_000 });
    // Below the recommended sum, above the share: still the cap, and the limit is then above the share (no reserve is left).
    expect(computeDaily(plain({ ...cap, cardsMoney: 100_000 })).parts).toMatchObject({ rule: "cap", share: 10_000, dailyLimit: 30_000 });
  });
  it("floor in the shortage without a confirmed plan; plan with one", () => {
    const none = computeDaily(input()).parts;
    expect(none).toMatchObject({ rule: "floor", dailyLimit: 45_000, free: -1_197_000, share: Math.floor(-1_197_000 / 18) });
    expect(computeDaily(input({ bridgeDaily: 30_000 })).parts).toMatchObject({ rule: "plan", dailyLimit: 30_000 });
    // A plan of exactly the recommended sum is still the plan: the person confirmed it.
    expect(computeDaily(input({ bridgeDaily: 45_000 })).parts).toMatchObject({ rule: "plan", dailyLimit: 45_000 });
    // The cap does not apply in the shortage, as before.
    expect(computeDaily(input({ lifestyleCapMonthly: 300_000 })).parts).toMatchObject({ rule: "floor", dailyLimit: 45_000 });
  });
  it("a plan left over while the money is above zero is not the rule", () => {
    expect(computeDaily(plain({ cardsMoney: 700_000, bridgeDaily: 30_000 })).parts).toMatchObject({ rule: "share", dailyLimit: 70_000 });
  });
  it("marks the cap nobody chose, whatever the rule", () => {
    expect(computeDaily(plain({ cardsMoney: 2_000_000 })).parts.capDefault).toBeUndefined();
    expect(computeDaily(plain({ cardsMoney: 2_000_000, lifestyleCapDefault: true })).parts).toMatchObject({ rule: "cap", capDefault: true });
    expect(computeDaily(plain({ cardsMoney: 700_000, lifestyleCapDefault: true })).parts).toMatchObject({ rule: "share", capDefault: true });
  });
  it("days are the engine's: 1 on the income day, 30 and a mark without an income date", () => {
    expect(computeDaily(plain({ nextIncomeOn: "2026-11-02" })).parts).toMatchObject({ daysLeft: 1 });
    expect(computeDaily(plain({ nextIncomeOn: "2026-11-02" })).parts.noIncomeDate).toBeUndefined();
    expect(computeDaily(plain({ nextIncomeOn: null })).parts).toMatchObject({ daysLeft: 30, noIncomeDate: true });
    expect(computeDaily(plain({ nextIncomeOn: "2026-11-01" })).parts).toMatchObject({ daysLeft: 30, noIncomeDate: true });
  });
  it("what is spent today is not a part: the same morning gives the same parts", () => {
    expect(computeDaily(plain({ cardsMoney: 700_000, spentToday: 12_300 })).parts).toEqual(computeDaily(plain({ cardsMoney: 700_000 })).parts);
  });
});
