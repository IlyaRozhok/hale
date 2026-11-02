import { describe, expect, it } from "vitest";
import { addDays, daysBetween, kyivDate, ownMoney, toUah, type Rates } from "./money.js";

describe("ownMoney", () => {
  it("is zero when balance equals the credit limit (untouched credit)", () => {
    expect(ownMoney({ balance: 3_000_000, creditLimit: 3_000_000 })).toBe(0);
  });
  it("drops to the real own amount when the limit is lowered", () => {
    expect(ownMoney({ balance: 3_000_000, creditLimit: 2_000_000 })).toBe(1_000_000);
  });
  it("is negative when the card is in debt", () => {
    expect(ownMoney({ balance: 2_500_000, creditLimit: 3_000_000 })).toBe(-500_000);
  });
});

describe("toUah", () => {
  const now = "2026-11-02T10:00:00Z";
  const rates: Rates = {
    USD: { rate: 41.5, fetchedAt: "2026-11-02T06:00:00Z" },
    EUR: { rate: 48, fetchedAt: "2026-10-28T06:00:00Z" },
  };
  it("is the identity for UAH", () => {
    expect(toUah(12_345, 980, {}, now)).toEqual({ uah: 12_345, stale: false });
  });
  it("converts USD by rate and rounds to the nearest kopeck", () => {
    expect(toUah(10_001, 840, rates, now)).toEqual({ uah: 415_042, stale: false });
  });
  it("flags a rate older than 48 hours as stale", () => {
    expect(toUah(1000, 978, rates, now)).toEqual({ uah: 48_000, stale: true });
  });
  it("is not stale at exactly 48 hours", () => {
    const r: Rates = { USD: { rate: 40, fetchedAt: "2026-10-31T10:00:00Z" } };
    expect(toUah(100, 840, r, now).stale).toBe(false);
  });
  it("throws when no rate exists", () => {
    expect(() => toUah(100, 840, {}, now)).toThrow(/rate/i);
  });
  it("throws for an unknown currency code", () => {
    expect(() => toUah(100, 999, rates, now)).toThrow(/currency/i);
  });
});

describe("date helpers", () => {
  it("counts days between date strings", () => {
    expect(daysBetween("2026-11-02", "2026-11-20")).toBe(18);
    expect(daysBetween("2026-11-20", "2026-11-02")).toBe(-18);
  });
  it("daysBetween ignores the 2026-10-25 DST change in Kyiv", () => {
    expect(daysBetween("2026-10-24", "2026-10-27")).toBe(3);
    expect(daysBetween("2026-10-25", "2026-10-26")).toBe(1);
  });
  it("adds days across months and DST", () => {
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-11-02", 30)).toBe("2026-12-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("kyivDate puts 23:59 and 00:01 Kyiv time on different days", () => {
    // Kyiv is UTC+2 in January
    expect(kyivDate(new Date("2026-01-15T21:59:00Z"))).toBe("2026-01-15");
    expect(kyivDate(new Date("2026-01-15T22:01:00Z"))).toBe("2026-01-16");
  });
  it("kyivDate handles the night of the 2026-10-25 DST change", () => {
    // 00:30 local (UTC+3) on the 25th is 21:30Z on the 24th
    expect(kyivDate(new Date("2026-10-24T21:30:00Z"))).toBe("2026-10-25");
    // clocks go back at 04:00 local to 03:00; 23:59 local (UTC+2) is 21:59Z
    expect(kyivDate(new Date("2026-10-25T21:59:00Z"))).toBe("2026-10-25");
    expect(kyivDate(new Date("2026-10-25T22:01:00Z"))).toBe("2026-10-26");
  });
});
