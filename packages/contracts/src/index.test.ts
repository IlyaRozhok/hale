import { describe, expect, it } from "vitest";
import { exchangeRate, expectedIncomeInput, insightsMonthDto, insightsMonthQuery, isoDate, scheduledPaymentInput, settingsPatch } from "./index";

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
  it("takes an optional month for «Итоги» and nothing else", () => {
    expect(insightsMonthQuery.safeParse({}).success).toBe(true);
    expect(insightsMonthQuery.safeParse({ month: "2026-11" }).success).toBe(true);
    expect(insightsMonthQuery.safeParse({ month: "2026-13" }).success).toBe(false);
    expect(insightsMonthQuery.safeParse({ month: "2026-1" }).success).toBe(false);
    expect(insightsMonthQuery.safeParse({ month: "2026-11", x: "1" }).success).toBe(false);
  });
  it("describes the «Итоги» answer in whole kopecks", () => {
    const ok = {
      month: "2026-11",
      through: "2026-11-16",
      previous: { from: "2026-10-01", to: "2026-10-16" },
      spent: 18_000,
      previousSpent: 9_000,
      categories: [
        { category: "shopping", spent: 30_000, previousSpent: 9_000, count: 1 },
        { category: "refund", spent: -12_000, previousSpent: 0, count: 1 },
      ],
    };
    expect(insightsMonthDto.safeParse(ok).success).toBe(true);
    expect(insightsMonthDto.safeParse({ ...ok, spent: 1.5 }).success).toBe(false);
    expect(insightsMonthDto.safeParse({ ...ok, through: "2026-02-30" }).success).toBe(false);
    expect(insightsMonthDto.safeParse({ ...ok, categories: [{ category: "cafe", spent: 1, previousSpent: 0, count: -1 }] }).success).toBe(false);
  });

  it("takes the month's places as optional, so an older server's answer still reads (В3)", () => {
    const base = { month: "2026-11", through: "2026-11-16", previous: { from: "2026-10-01", to: "2026-10-16" }, spent: 0, previousSpent: 0, categories: [] };
    const place = { key: "0123456789abcdef", name: "Aroma Kava", spent: 224_000, visits: 14, isNew: false };
    expect(insightsMonthDto.safeParse(base).success).toBe(true);
    expect(insightsMonthDto.safeParse({ ...base, places: [] }).success).toBe(true);
    expect(insightsMonthDto.safeParse({ ...base, places: [place] }).success).toBe(true);
    expect(insightsMonthDto.safeParse({ ...base, places: [{ ...place, spent: 1.5 }] }).success).toBe(false);
    expect(insightsMonthDto.safeParse({ ...base, places: [{ ...place, spent: 0 }] }).success).toBe(false);
    expect(insightsMonthDto.safeParse({ ...base, places: [{ ...place, visits: 0 }] }).success).toBe(false);
    expect(insightsMonthDto.safeParse({ ...base, places: [{ ...place, key: "IBAN" }] }).success).toBe(false);
    expect(insightsMonthDto.safeParse({ ...base, places: Array(6).fill(place) }).success).toBe(false);
  });
});

describe("exchangeRate (Б22)", () => {
  it("is hryvnias per dollar, to two decimals", () => {
    // $1,400 for ₴65,430: 46.7357… a dollar.
    expect(exchangeRate(6_543_000, 140_000)).toBe(46.74);
    expect(exchangeRate(4_100_000, 100_000)).toBe(41);
    expect(exchangeRate(1, 3)).toBe(0.33);
  });
});
