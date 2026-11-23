import { describe, expect, it } from "vitest";
import { cardDots, shortDate } from "./text-format.js";

describe("shortDate", () => {
  it("writes the day without a leading zero and the short month", () => {
    expect(shortDate("2026-11-09", "2026-11-23")).toBe("9 ноя");
    expect(shortDate("2026-12-06", "2026-11-23")).toBe("6 дек");
    expect(shortDate("2026-05-31", "2026-11-23")).toBe("31 мая");
  });

  it("names every month as the app does", () => {
    const months = Array.from({ length: 12 }, (_, i) => shortDate(`2026-${String(i + 1).padStart(2, "0")}-01`, "2026-01-01").slice(2));
    expect(months).toEqual(["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]);
  });

  it("adds the year only when it is not the current one, across the year boundary both ways", () => {
    expect(shortDate("2026-12-31", "2026-12-31")).toBe("31 дек");
    expect(shortDate("2027-01-01", "2026-12-31")).toBe("1 янв 2027");
    expect(shortDate("2026-12-31", "2027-01-01")).toBe("31 дек 2026");
    expect(shortDate("2027-01-01", "2027-01-01")).toBe("1 янв");
  });
});

describe("cardDots", () => {
  it("shortens a masked card number to its last four digits", () => {
    expect(cardDots("545708****4563")).toBe("··4563");
    expect(cardDots(" 5457 08** **** 4563 ")).toBe("··4563");
    expect(cardDots("**** 4563")).toBe("··4563");
  });

  it("is null for a name or a text with no card number", () => {
    expect(cardDots("Таечка")).toBeNull();
    expect(cardDots("Оплата ****4563")).toBeNull();
    expect(cardDots("****")).toBeNull();
    expect(cardDots("")).toBeNull();
  });
});
