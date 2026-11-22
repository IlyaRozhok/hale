import { describe, expect, it } from "vitest";
import { pace } from "./pace.js";
import { runOutDate } from "./run-out.js";

// Made-up figures: ₴53,000 free on 22 November, income on 15 December (23 days), limit ₴2,300.
const base = { today: "2026-11-22", free: 5_300_000, dailyLimit: 230_000, spentToday: 0, nextIncomeOn: "2026-12-15" };

describe("pace", () => {
  it("is there when the money runs out at the current pace before the income", () => {
    const p = pace({ ...base, avgDailySpend: 460_000 });
    // 53,000 / 4,600 = 11 whole days: the 12th day from today, 3 December, is short.
    expect(p).toMatchObject({ avgDaily: 460_000, runOutOn: "2026-12-03", incomeOn: "2026-12-15" });
  });

  it("names the same day as runOutDate, from the same free money", () => {
    const p = pace({ ...base, avgDailySpend: 460_000 });
    expect(p?.runOutOn).toBe(runOutDate({ free: base.free, avgDailySpend: 460_000, today: base.today }));
  });

  it("is absent when the money lasts until the income", () => {
    expect(pace({ ...base, avgDailySpend: 230_000 })).toBeNull();
    // 53,000 / 2,304 = 23 whole days: exactly up to the income day.
    expect(pace({ ...base, avgDailySpend: 230_400 })).toBeNull();
  });

  it("is there when the money is one day short", () => {
    // 53,000 / 2,305 = 22 whole days: 14 December is short.
    expect(pace({ ...base, avgDailySpend: 230_500 })?.runOutOn).toBe("2026-12-14");
  });

  it("is absent without a known income date", () => {
    expect(pace({ ...base, nextIncomeOn: null, avgDailySpend: 460_000 })).toBeNull();
    // An income date already past is not a known next income.
    expect(pace({ ...base, nextIncomeOn: "2026-11-20", avgDailySpend: 460_000 })).toBeNull();
  });

  it("is absent when nothing was spent", () => {
    expect(pace({ ...base, avgDailySpend: 0 })).toBeNull();
  });

  it("is absent without free money: the shortage mode has its own words", () => {
    expect(pace({ ...base, free: 0, avgDailySpend: 460_000 })).toBeNull();
    expect(pace({ ...base, free: -100_000, avgDailySpend: 460_000 })).toBeNull();
  });

  it("is absent when the usual day is within a limit the food floor lifted", () => {
    // ₴5,000 over 23 days is ₴217 a day; the limit is the ₴450 floor, and ₴400 a day runs out early but within it.
    expect(pace({ ...base, free: 500_000, dailyLimit: 45_000, avgDailySpend: 40_000 })).toBeNull();
    expect(pace({ ...base, free: 500_000, dailyLimit: 45_000, avgDailySpend: 45_000 })).toBeNull();
  });

  it("is absent on the income day itself", () => {
    expect(pace({ ...base, today: "2026-12-15", free: 100, avgDailySpend: 460_000 })).toBeNull();
  });

  describe("the hint", () => {
    it("is the middle of the limit and the pace, rounded down to ₴100, with the day it lasts until", () => {
      // (4,600 + 2,300) / 2 = 3,450 → ₴3,400; 53,000 / 3,400 = 15 whole days → 7 December.
      expect(pace({ ...base, avgDailySpend: 460_000 })?.hint).toEqual({ daily: 340_000, lastsUntil: "2026-12-07" });
    });

    it("lasts until a day from the same free money, and that day is between the pace's and the income", () => {
      const p = pace({ ...base, avgDailySpend: 460_000 })!;
      expect(p.hint!.lastsUntil).toBe(runOutDate({ free: base.free, avgDailySpend: p.hint!.daily, today: base.today }));
      expect(p.hint!.lastsUntil > p.runOutOn).toBe(true);
      expect(p.hint!.lastsUntil < p.incomeOn).toBe(true);
      expect(p.hint!.daily).toBeGreaterThan(base.dailyLimit);
      expect(p.hint!.daily).toBeLessThan(460_000);
    });

    it("is absent when the rounded middle is no step above the limit", () => {
      // (2,390 + 2,300) / 2 = 2,345 → ₴2,300, the limit itself.
      const p = pace({ ...base, avgDailySpend: 239_000 });
      expect(p).not.toBeNull();
      expect(p!.hint).toBeUndefined();
    });

    it("is absent when the middle step lasts no longer than the pace", () => {
      // ₴53,000 a day spends it all in one day; the middle, ₴27,650, also lasts one whole day.
      const p = pace({ ...base, avgDailySpend: 5_300_000 });
      expect(p).not.toBeNull();
      expect(p!.hint).toBeUndefined();
    });

    it("is absent when the limit itself does not last until the income (the food floor lifted it)", () => {
      // ₴5,000 over 23 days is ₴217 a day; the limit was lifted to the ₴450 floor and would run out before the income.
      const p = pace({ ...base, free: 500_000, dailyLimit: 45_000, avgDailySpend: 100_000 });
      expect(p).not.toBeNull();
      expect(p!.hint).toBeUndefined();
    });

    it("stays once something is spent today under the limit: the limit is set against what it still needs", () => {
      // ₴150 spent today, ₴52,850 left; from now the limit needs 2,150 today + 22 × 2,300 = ₴52,750.
      // (A whole 23 × 2,300 = ₴52,900 would no longer fit, though the sentence is still true.)
      expect(pace({ ...base, free: 5_285_000, spentToday: 15_000, avgDailySpend: 460_000 })?.hint).toEqual({
        daily: 340_000,
        lastsUntil: "2026-12-07",
      });
    });

    it("after today went over the limit, stays only while a limit a day still lasts from tomorrow", () => {
      // ₴3,000 spent today, ₴50,000 left; nothing is left of today's limit and 22 × 2,300 = ₴50,600 is needed: short.
      expect(pace({ ...base, free: 5_000_000, spentToday: 300_000, avgDailySpend: 460_000 })?.hint).toBeUndefined();
      // With a ₴2,200 limit 22 × 2,200 = ₴48,400 fits in ₴50,000.
      expect(pace({ ...base, free: 5_000_000, dailyLimit: 220_000, spentToday: 300_000, avgDailySpend: 460_000 })?.hint).toEqual({
        daily: 340_000,
        lastsUntil: "2026-12-06",
      });
    });

    it("keeps whole kopecks", () => {
      const p = pace({ ...base, avgDailySpend: 460_033 })!;
      expect(Number.isInteger(p.avgDaily)).toBe(true);
      expect(p.hint!.daily % 10_000).toBe(0);
    });
  });
});
