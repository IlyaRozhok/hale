import { describe, expect, it } from "vitest";
import {
  exchangeRate,
  expectedIncomeInput,
  expectedIncomePatch,
  insightsMonthDto,
  insightsMonthQuery,
  isoDate,
  observationRef,
  observationTodayDto,
  scheduledPaymentInput,
  settingsPatch,
  transactionsQuery,
} from "./index";

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
  it("takes an income by its old kind alone, as an older app sends it, or by its name with a schedule, an account and flags (Д3а)", () => {
    expect(expectedIncomeInput.safeParse({ source: "usdc", amount: 1, currency: "USD", window_start_day: 8, window_end_day: 12 }).success).toBe(true);
    const job = { name: "Основная работа", amount: 3_800_000, currency: "UAH", window_start_day: 5, window_end_day: 5 };
    expect(expectedIncomeInput.safeParse(job).success).toBe(true);
    expect(
      expectedIncomeInput.safeParse({
        ...job, schedule: "twice", second_day: 20, pays_fop_tax: false, crypto: false, account: { source: "account", id: 3 },
      }).success,
    ).toBe(true);
    expect(expectedIncomeInput.safeParse({ ...job, account: { source: "manual", id: 1 } }).success).toBe(true);
    expect(expectedIncomeInput.safeParse({ ...job, account: { source: "cash" } }).success).toBe(true);
    expect(expectedIncomeInput.safeParse({ ...job, account: null }).success).toBe(true);
    // No schedule, no days.
    expect(expectedIncomeInput.safeParse({ name: "Заказчик А", amount: 1, currency: "USD", schedule: "none" }).success).toBe(true);
    // Neither a name nor an old kind; a schedule that needs its days without them; a name of spaces; an unknown account.
    expect(expectedIncomeInput.safeParse({ amount: 1, currency: "UAH", window_start_day: 5, window_end_day: 5 }).success).toBe(false);
    expect(expectedIncomeInput.safeParse({ name: "x", amount: 1, currency: "UAH" }).success).toBe(false);
    expect(expectedIncomeInput.safeParse({ ...job, name: "  " }).success).toBe(false);
    expect(expectedIncomeInput.safeParse({ ...job, account: { source: "bank", id: 1 } }).success).toBe(false);
    expect(expectedIncomeInput.safeParse({ ...job, account: { source: "cash", id: 1 } }).success).toBe(false);
    expect(expectedIncomeInput.safeParse({ ...job, schedule: "weekly" }).success).toBe(false);
    expect(expectedIncomePatch.safeParse({ name: "Заказчик Б", schedule: "none", account: null, pays_fop_tax: true }).success).toBe(true);
    expect(expectedIncomePatch.safeParse({ slot: 2 }).success).toBe(false);
  });
  it("rejects unknown settings keys", () => {
    expect(settingsPatch.safeParse({ nope: 1 }).success).toBe(false);
  });
  it("narrows «Операции» to one of the person's accounts by its kind, and to nothing else (Д1)", () => {
    for (const account of ["black", "white", "fop", "cash"]) {
      expect(transactionsQuery.safeParse({ account }).success).toBe(true);
    }
    expect(transactionsQuery.safeParse({ account: "jar" }).success).toBe(false);
    expect(transactionsQuery.safeParse({ account: "other" }).success).toBe(false);
    expect(transactionsQuery.safeParse({ account: "" }).success).toBe(false);
    expect(transactionsQuery.safeParse({}).success).toBe(true);
  });
  it("narrows «Операции» to the payments outside the limit and to one place, and takes nothing else for them (Я8)", () => {
    expect(transactionsQuery.parse({ other: "true" }).other).toBe(true);
    expect(transactionsQuery.safeParse({ other: "false" }).success).toBe(false);
    expect(transactionsQuery.safeParse({ other: "1" }).success).toBe(false);
    expect(transactionsQuery.parse({ place: "0123456789abcdef" }).place).toBe("0123456789abcdef");
    for (const place of ["", "0123456789ABCDEF", "0123456789abcde", "0123456789abcdef0", "Apple"]) {
      expect(transactionsQuery.safeParse({ place }).success).toBe(false);
    }
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

  it("takes the payments outside the limit as optional whole kopecks, never below zero (В2а)", () => {
    const base = { month: "2026-11", through: "2026-11-16", previous: { from: "2026-10-01", to: "2026-10-16" }, spent: 0, previousSpent: 0, categories: [] };
    expect(insightsMonthDto.safeParse({ ...base, otherPayments: 1_870_500, previousOtherPayments: 0 }).success).toBe(true);
    expect(insightsMonthDto.safeParse({ ...base, otherPayments: 0 }).success).toBe(true);
    expect(insightsMonthDto.safeParse({ ...base, otherPayments: -1 }).success).toBe(false);
    expect(insightsMonthDto.safeParse({ ...base, otherPayments: 1.5 }).success).toBe(false);
    expect(insightsMonthDto.safeParse({ ...base, previousOtherPayments: -1 }).success).toBe(false);
  });

  it("takes the «Не подписка» capability as an optional flag, so an older server's answer still reads (ЯМ6)", () => {
    const base = { month: "2026-11", through: "2026-11-16", previous: { from: "2026-10-01", to: "2026-10-16" }, spent: 0, previousSpent: 0, categories: [] };
    expect(insightsMonthDto.safeParse(base).success).toBe(true);
    expect(insightsMonthDto.safeParse({ ...base, canMarkNotSubscription: true }).success).toBe(true);
    expect(insightsMonthDto.safeParse({ ...base, canMarkNotSubscription: "yes" }).success).toBe(false);
  });

  it("takes the month's subscriptions as optional, so an older server's answer still reads (В4)", () => {
    const base = { month: "2026-11", through: "2026-11-16", previous: { from: "2026-10-01", to: "2026-10-16" }, spent: 0, previousSpent: 0, categories: [] };
    const item = { key: "0123456789abcdef", name: "Netflix", amount: 29_900, lastDate: "2026-11-05", raisedBy: 5_000, missed: 0 };
    expect(insightsMonthDto.safeParse(base).success).toBe(true);
    expect(insightsMonthDto.safeParse({ ...base, subscriptions: { monthly: 0, items: [] } }).success).toBe(true);
    expect(insightsMonthDto.safeParse({ ...base, subscriptions: { monthly: 29_900, items: [item, { ...item, raisedBy: 0, missed: 2 }] } }).success).toBe(true);
    expect(insightsMonthDto.safeParse({ ...base, subscriptions: { monthly: -1, items: [] } }).success).toBe(false);
    expect(insightsMonthDto.safeParse({ ...base, subscriptions: { monthly: 0, items: [{ ...item, amount: 0 }] } }).success).toBe(false);
    expect(insightsMonthDto.safeParse({ ...base, subscriptions: { monthly: 0, items: [{ ...item, amount: 1.5 }] } }).success).toBe(false);
    expect(insightsMonthDto.safeParse({ ...base, subscriptions: { monthly: 0, items: [{ ...item, raisedBy: -1 }] } }).success).toBe(false);
    expect(insightsMonthDto.safeParse({ ...base, subscriptions: { monthly: 0, items: [{ ...item, missed: 0.5 }] } }).success).toBe(false);
    expect(insightsMonthDto.safeParse({ ...base, subscriptions: { monthly: 0, items: [{ ...item, lastDate: "2026-02-30" }] } }).success).toBe(false);
    expect(insightsMonthDto.safeParse({ ...base, subscriptions: { monthly: 0, items: [{ ...item, key: "IBAN" }] } }).success).toBe(false);
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

describe("observations (В7)", () => {
  const spike = { kind: "spike", period: "month", category: "cafe", spent: 482_000, usual: 310_000, amount: null, from: "2026-11-01", to: "2026-11-19" };
  it("describes today's observation in whole kopecks, or none", () => {
    expect(observationTodayDto.safeParse({ observation: spike }).success).toBe(true);
    expect(observationTodayDto.safeParse({ observation: null }).success).toBe(true);
    expect(observationTodayDto.safeParse({ observation: { ...spike, spent: 1.5 } }).success).toBe(false);
    expect(observationTodayDto.safeParse({ observation: { ...spike, period: "day" } }).success).toBe(false);
    expect(observationTodayDto.safeParse({ observation: { ...spike, text: "x" } }).success).toBe(false);
  });
  it("names a spike by its category and the subscriptions without one", () => {
    expect(observationRef.safeParse({ kind: "spike", category: "cafe" }).success).toBe(true);
    expect(observationRef.safeParse({ kind: "subscriptions", category: null }).success).toBe(true);
    expect(observationRef.safeParse({ kind: "spike", category: null }).success).toBe(false);
    expect(observationRef.safeParse({ kind: "spike", category: " " }).success).toBe(false);
    expect(observationRef.safeParse({ kind: "subscriptions", category: "cafe" }).success).toBe(false);
    expect(observationRef.safeParse({ kind: "other", category: null }).success).toBe(false);
  });
});
