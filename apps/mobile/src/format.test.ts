import { describe, expect, it } from "vitest";
import { dueLabel, formatMoney, formatOriginal, kyivDate, formatMoneyWithUsd, formatStamp, formatUsd, isIsoDate, parseHryvnias, shiftDate, shortDate, taxQuarterOfDue } from "./format";

describe("formatMoney", () => {
  it("groups thousands with commas and rounds to whole hryvnias", () => {
    expect(formatMoney(1032500)).toBe("₴10,325");
    expect(formatMoney(100)).toBe("₴1");
    expect(formatMoney(0)).toBe("₴0");
    expect(formatMoney(123456789)).toBe("₴1,234,568");
  });

  it("uses a real minus sign for negatives and never prints -₴0", () => {
    expect(formatMoney(-1197000)).toBe("−₴11,970");
    expect(formatMoney(-20)).toBe("₴0");
  });
});

describe("formatUsd / formatMoneyWithUsd", () => {
  it("converts kopecks to dollars at the UAH-per-USD rate", () => {
    expect(formatUsd(1032500, 41.25)).toBe("$250");
    expect(formatUsd(-1650000, 41.25)).toBe("−$400");
  });

  it("is null when no rate is known", () => {
    expect(formatUsd(1032500, 0)).toBeNull();
    expect(formatMoneyWithUsd(1032500, 0)).toEqual({ uah: "₴10,325", usd: null });
  });

  it("returns both parts", () => {
    expect(formatMoneyWithUsd(1032500, 41.25)).toEqual({ uah: "₴10,325", usd: "$250" });
  });
});

describe("kyivDate", () => {
  it("rolls over at Kyiv midnight, not UTC", () => {
    expect(kyivDate(new Date("2026-11-01T21:30:00Z"))).toBe("2026-11-01"); // UTC+2
    expect(kyivDate(new Date("2026-11-01T22:30:00Z"))).toBe("2026-11-02");
    expect(kyivDate(new Date("2026-07-01T20:30:00Z"))).toBe("2026-07-01"); // UTC+3
    expect(kyivDate(new Date("2026-07-01T21:30:00Z"))).toBe("2026-07-02");
  });
});

describe("dates", () => {
  it("shifts an ISO date by days across month ends", () => {
    expect(shiftDate("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDate("2026-11-02", 14)).toBe("2026-11-16");
  });

  it("labels how far a due date is", () => {
    expect(dueLabel("2026-11-02", "2026-11-02")).toBe("сегодня");
    expect(dueLabel("2026-11-03", "2026-11-02")).toBe("завтра");
    expect(dueLabel("2026-11-06", "2026-11-02")).toBe("через 4 дня");
    expect(dueLabel("2026-11-18", "2026-11-02")).toBe("через 16 дней");
    expect(dueLabel("2026-11-22", "2026-11-02")).toBe("через 20 дней");
    expect(dueLabel("2026-11-01", "2026-11-02")).toBe("01.11");
  });

  it("formats a stamp as local time today, or date and time otherwise", () => {
    const now = new Date(2026, 10, 2, 18, 0);
    expect(formatStamp(new Date(2026, 10, 2, 9, 5).toISOString(), now)).toBe("сегодня 09:05");
    expect(formatStamp(new Date(2026, 10, 1, 23, 40).toISOString(), now)).toBe("01.11 23:40");
  });
});

describe("parseHryvnias", () => {
  it("reads typed amounts as kopecks", () => {
    expect(parseHryvnias("1500")).toBe(150000);
    expect(parseHryvnias("1 500,50")).toBe(150050);
    expect(parseHryvnias(" 12.5 ")).toBe(1250);
    expect(parseHryvnias("0,07")).toBe(7);
  });

  it("rejects empty, zero, negative and malformed input", () => {
    for (const bad of ["", "0", "0,00", "-5", "abc", "1,234", "1.2.3", "12,5x"]) expect(parseHryvnias(bad)).toBeNull();
  });
});

describe("formatOriginal", () => {
  it("shows the account currency with cents, a real minus, and symbols for the usual ones", () => {
    expect(formatOriginal(-1000, "USD")).toBe("−$10.00");
    expect(formatOriginal(2550, "EUR")).toBe("€25.50");
    expect(formatOriginal(-100050, "PLN")).toBe("−1,000.50 PLN");
  });
});

describe("taxQuarterOfDue", () => {
  it("is the quarter before the due date's, across the year end", () => {
    expect(taxQuarterOfDue("2026-11-20")).toBe("2026-Q3");
    expect(taxQuarterOfDue("2026-05-20")).toBe("2026-Q1");
    expect(taxQuarterOfDue("2027-02-20")).toBe("2026-Q4");
  });
});

describe("shortDate", () => {
  it("prints DD.MM", () => {
    expect(shortDate("2026-11-02")).toBe("02.11");
  });
});

describe("isIsoDate", () => {
  it("accepts real dates only", () => {
    expect(isIsoDate("2026-11-02")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("02.11.2026")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
});
