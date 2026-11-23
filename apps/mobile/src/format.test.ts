import { describe, expect, it } from "vitest";
import {
  amountTone,
  cardTransferTitle,
  dayHeader,
  dayMonth,
  formatDollars,
  formatSignedMoney,
  formatSignedOriginal,
  goalPercent,
  longDate,
  dayMonthLong,
  inMonth,
  dueLabel, formatMoney, formatOriginal, kyivDate, formatStamp, formatUsd, isIsoDate, parseBalance, parseHryvnias, shiftDate, shortDate, taxQuarterOfDue,
} from "./format";

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

describe("formatUsd", () => {
  it("converts kopecks to dollars at the UAH-per-USD rate", () => {
    expect(formatUsd(1032500, 41.25)).toBe("$250");
    expect(formatUsd(-1650000, 41.25)).toBe("−$400");
  });

  it("is null when no rate is known", () => {
    expect(formatUsd(1032500, 0)).toBeNull();
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
    expect(dueLabel("2026-11-01", "2026-11-02")).toBe("1 ноя");
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

describe("parseBalance", () => {
  it("takes zero and cents, refuses the rest", () => {
    expect(parseBalance("0")).toBe(0);
    expect(parseBalance("2 700,50")).toBe(270_050);
    expect(parseBalance("")).toBeNull();
    expect(parseBalance("-5")).toBeNull();
    expect(parseBalance("99999999999999999")).toBeNull();
  });
});

describe("formatOriginal", () => {
  it("shows the account currency with cents, a real minus, and symbols for the usual ones", () => {
    expect(formatOriginal(2550, "EUR")).toBe("€25.50");
    expect(formatOriginal(-100050, "PLN")).toBe("−1,000.50 PLN");
    expect(formatOriginal(-1005, "USD")).toBe("−$10.05");
  });

  it("drops the cents only when there are none (Я3)", () => {
    expect(formatOriginal(-1000, "USD")).toBe("−$10");
    expect(formatOriginal(270_000, "USD")).toBe("$2,700");
    expect(formatOriginal(-100000, "PLN")).toBe("−1,000 PLN");
    expect(formatOriginal(0, "EUR")).toBe("€0");
  });
});

describe("cardTransferTitle", () => {
  it("names a transfer out to a masked card number by its last four digits (Я3)", () => {
    expect(cardTransferTitle("545708****4563", -1_560_000)).toBe("Перевод на карту ··4563");
    expect(cardTransferTitle("5457 08** **** 4563", -100)).toBe("Перевод на карту ··4563");
  });

  it("leaves everything else alone: names, money coming in, numbers that are not a masked card", () => {
    expect(cardTransferTitle("Кофейня", -8500)).toBeNull();
    expect(cardTransferTitle("545708****4563", 1_560_000)).toBeNull();
    expect(cardTransferTitle("4563", -100)).toBeNull();
    expect(cardTransferTitle("Оплата ****4563", -100)).toBeNull();
    expect(cardTransferTitle("", -100)).toBeNull();
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
  it("prints the day and the short month", () => {
    expect(shortDate("2026-11-02")).toBe("2 ноя");
    expect(shortDate("2026-12-06")).toBe("6 дек");
    expect(shortDate("2026-05-31")).toBe("31 мая");
  });

  it("adds the year only for a date outside the current one", () => {
    expect(shortDate("2026-12-06", "2026-11-23")).toBe("6 дек");
    expect(shortDate("2027-01-06", "2026-11-23")).toBe("6 янв 2027");
    expect(shortDate("2025-12-06", "2026-11-23")).toBe("6 дек 2025");
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

describe("signed money", () => {
  it("adds a plus to incoming amounts and keeps a real minus on outgoing", () => {
    expect(formatSignedMoney(1032500)).toBe("+₴10,325");
    expect(formatSignedMoney(-8500)).toBe("−₴85");
    expect(formatSignedMoney(0)).toBe("₴0");
    expect(formatSignedMoney(40)).toBe("₴0");
    expect(formatSignedOriginal(1000, "USD")).toBe("+$10");
    expect(formatSignedOriginal(-1050, "USD")).toBe("−$10.50");
  });
});

describe("amountTone", () => {
  it("is neutral for transfers between own accounts, whatever the sign", () => {
    expect(amountTone("own_transfer", -100)).toBe("neutral");
    expect(amountTone("own_transfer", 100)).toBe("neutral");
  });
  it("follows the sign otherwise", () => {
    expect(amountTone("spend", -100)).toBe("expense");
    expect(amountTone("income", 100)).toBe("income");
    expect(amountTone(null, -100)).toBe("expense");
    expect(amountTone("spend", 0)).toBe("neutral");
  });
});

describe("calendar labels", () => {
  it("spells a date with its weekday", () => {
    expect(longDate("2026-11-03")).toBe("Вторник, 3 ноября");
    expect(longDate("2027-01-01")).toBe("Пятница, 1 января");
  });
  it("names today and yesterday in a day header, and only the date before that", () => {
    expect(dayHeader("2026-11-03", "2026-11-03")).toBe("Сегодня, 3 ноя");
    expect(dayHeader("2026-11-02", "2026-11-03")).toBe("Вчера, 2 ноя");
    expect(dayHeader("2026-10-31", "2026-11-03")).toBe("31 окт");
    expect(dayHeader("2026-12-31", "2027-01-01")).toBe("Вчера, 31 дек");
  });
  it("splits a date for a date tile", () => {
    expect(dayMonth("2026-11-06")).toEqual({ day: "6", month: "ноя" });
  });
});

describe("goal progress", () => {
  it("rounds down, caps at 100 and survives a bad target", () => {
    expect(goalPercent(50000, 500000)).toBe(10);
    expect(goalPercent(1, 3)).toBe(33);
    expect(goalPercent(0, 1000000)).toBe(0);
    expect(goalPercent(700000, 500000)).toBe(100);
    expect(goalPercent(100, 0)).toBe(0);
  });
  it("formats whole dollars from cents", () => {
    expect(formatDollars(50000)).toBe("$500");
    expect(formatDollars(1000000)).toBe("$10,000");
  });
});

describe("lastDays", () => {
  it("ends today and counts today in: a week is today and the six days before", async () => {
    const { lastDays } = await import("./format");
    expect(lastDays("2026-11-09", 7)).toEqual({ from: "2026-11-03", to: "2026-11-09" });
    expect(lastDays("2026-11-09", 1)).toEqual({ from: "2026-11-09", to: "2026-11-09" });
  });

  it("thirty days reach back into the month before, so the start of a month is not empty", async () => {
    const { lastDays } = await import("./format");
    expect(lastDays("2026-11-09", 30)).toEqual({ from: "2026-10-11", to: "2026-11-09" });
    expect(lastDays("2026-11-01", 30)).toEqual({ from: "2026-10-03", to: "2026-11-01" });
    // across a short February and a year end
    expect(lastDays("2027-03-01", 30)).toEqual({ from: "2027-01-31", to: "2027-03-01" });
    expect(lastDays("2027-01-10", 30)).toEqual({ from: "2026-12-12", to: "2027-01-10" });
  });
});

describe("periodLabel", () => {
  it("names a day, a span within a month, and a span across months", async () => {
    const { periodLabel } = await import("./format");
    expect(periodLabel("2026-11-09", "2026-11-09")).toBe("9 ноя");
    expect(periodLabel("2026-11-03", "2026-11-09")).toBe("3–9 ноя");
    expect(periodLabel("2026-10-28", "2026-11-03")).toBe("28 окт – 3 ноя");
  });
});

describe("dates in words (В4)", () => {
  it("a day and its month in the genitive, no year", () => {
    expect(dayMonthLong("2026-08-04")).toBe("4 августа");
    expect(dayMonthLong("2026-03-31")).toBe("31 марта");
  });

  it("a month in the prepositional case", () => {
    expect(inMonth(10)).toBe("октябре");
    expect(inMonth(5)).toBe("мае");
  });
});
