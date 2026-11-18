import { describe, expect, it } from "vitest";
import { type ChargeRow, findSubscriptions, subscriptionsFrom } from "./subscriptions";

const row = (key: string, date: string, amount: number, name = key): ChargeRow => ({ key, name, date, amount });

describe("subscriptionsFrom", () => {
  it("looks back over the month asked and the five before it", () => {
    expect(subscriptionsFrom("2026-11-16")).toBe("2026-06-01");
    expect(subscriptionsFrom("2026-03-31")).toBe("2025-10-01");
  });
});

describe("findSubscriptions", () => {
  it("finds a steady monthly charge and counts it in the monthly total", () => {
    const rows = [
      row("netflix", "2026-08-05", 24_900, "Netflix"),
      row("netflix", "2026-09-05", 24_900, "Netflix"),
      row("netflix", "2026-10-06", 24_900, "Netflix"),
      row("netflix", "2026-11-05", 24_900, "Netflix"),
    ];
    expect(findSubscriptions(rows, "2026-11-16")).toEqual({
      monthly: 24_900,
      items: [{ key: "netflix", name: "Netflix", amount: 24_900, lastDate: "2026-11-05", raisedBy: 0, missed: 0 }],
    });
  });

  it("keeps a charge in dollars whose hryvnia sum drifts a little, and does not call the drift a price rise", () => {
    const rows = [row("chatgpt", "2026-08-12", 82_400), row("chatgpt", "2026-09-12", 83_100), row("chatgpt", "2026-10-13", 81_900), row("chatgpt", "2026-11-12", 84_000)];
    expect(findSubscriptions(rows, "2026-11-16").items).toEqual([
      { key: "chatgpt", name: "chatgpt", amount: 84_000, lastDate: "2026-11-12", raisedBy: 0, missed: 0 },
    ]);
  });

  it("follows a price rise as the same subscription and names the rise", () => {
    const rows = [row("spotify", "2026-08-20", 9_900), row("spotify", "2026-09-20", 9_900), row("spotify", "2026-10-20", 9_900), row("spotify", "2026-11-14", 14_900)];
    const s = findSubscriptions(rows, "2026-11-16");
    expect(s.items).toEqual([{ key: "spotify", name: "spotify", amount: 14_900, lastDate: "2026-11-14", raisedBy: 5_000, missed: 0 }]);
    expect(s.monthly).toBe(14_900);
  });

  it("names a rise only at the last charge: an older one is the price by now", () => {
    const rows = [row("s", "2026-08-01", 9_900), row("s", "2026-09-01", 14_900), row("s", "2026-10-01", 14_900), row("s", "2026-11-01", 14_900)];
    expect(findSubscriptions(rows, "2026-11-16").items[0]).toMatchObject({ amount: 14_900, raisedBy: 0 });
  });

  it("does not take a jump of more than 60% for a price rise", () => {
    const rows = [row("s", "2026-09-01", 10_000), row("s", "2026-10-01", 10_000), row("s", "2026-11-01", 16_001)];
    expect(findSubscriptions(rows, "2026-11-16").items).toEqual([]);
    const rise = [row("s", "2026-09-01", 10_000), row("s", "2026-10-01", 10_000), row("s", "2026-11-01", 16_000)];
    expect(findSubscriptions(rise, "2026-11-16").items[0]).toMatchObject({ amount: 16_000, raisedBy: 6_000 });
  });

  it("does not take a price drop beyond the drift for the same subscription", () => {
    const rows = [row("s", "2026-09-01", 20_000), row("s", "2026-10-01", 20_000), row("s", "2026-11-01", 10_000)];
    expect(findSubscriptions(rows, "2026-11-16").items).toEqual([]);
  });

  it("marks one not charged for two months and leaves it out of the monthly total", () => {
    const rows = [
      row("gym", "2026-06-04", 90_000, "Sport Life"),
      row("gym", "2026-07-04", 90_000, "Sport Life"),
      row("gym", "2026-08-04", 90_000, "Sport Life"),
      row("netflix", "2026-09-05", 24_900),
      row("netflix", "2026-10-05", 24_900),
      row("netflix", "2026-11-05", 24_900),
    ];
    const s = findSubscriptions(rows, "2026-10-20");
    expect(s.items.find((i) => i.key === "gym")).toEqual({ key: "gym", name: "Sport Life", amount: 90_000, lastDate: "2026-08-04", raisedBy: 0, missed: 2 });
    expect(s.monthly).toBe(0); // netflix has only two charges by the 20th of October
    const later = findSubscriptions(rows, "2026-11-16");
    expect(later.monthly).toBe(24_900);
    // The active one first, then the ones not charged for a while.
    // Due on 4 September and 4 October; the 4 November one is only twelve days late.
    expect(later.items.map((i) => [i.key, i.missed])).toEqual([["netflix", 0], ["gym", 2]]);
  });

  it("counts a missed charge only once half a step has passed after it was due", () => {
    const rows = [row("s", "2026-08-10", 5_000), row("s", "2026-09-10", 5_000), row("s", "2026-10-10", 5_000)];
    expect(findSubscriptions(rows, "2026-11-12").items[0]!.missed).toBe(0); // two days late: banks are late too
    expect(findSubscriptions(rows, "2026-11-24").items[0]!.missed).toBe(0);
    expect(findSubscriptions(rows, "2026-11-25").items[0]!.missed).toBe(1);
  });

  it("does not take an irregular place for a subscription", () => {
    const rows = [row("shop", "2026-06-03", 45_000), row("shop", "2026-07-20", 20_000), row("shop", "2026-08-02", 80_000), row("shop", "2026-09-30", 45_000), row("shop", "2026-10-28", 60_000)];
    expect(findSubscriptions(rows, "2026-11-16")).toEqual({ monthly: 0, items: [] });
  });

  it("does not take a place charged a similar sum twice a month for a subscription", () => {
    const rows = ["06", "07", "08", "09", "10"].flatMap((m) => [row("barber", `2026-${m}-05`, 40_000), row("barber", `2026-${m}-19`, 40_000)]);
    expect(findSubscriptions(rows, "2026-11-16").items).toEqual([]);
  });

  it("does not take a shop bought at every week, though some purchases fall a month apart at the same sum", () => {
    const rows = Array.from({ length: 22 }, (_, i) => row("silpo", new Date(Date.UTC(2026, 5, 1 + i * 7)).toISOString().slice(0, 10), 50_000 + (i % 3) * 1_000));
    expect(findSubscriptions(rows, "2026-11-16").items).toEqual([]);
  });

  it("does not need a sum to be alone at its place: two subscriptions under one merchant, and a one-off purchase there", () => {
    const rows = [
      ...["08", "09", "10", "11"].map((m) => row("apple", `2026-${m}-03`, 4_900, "Apple")),
      ...["08", "09", "10", "11"].map((m) => row("apple", `2026-${m}-15`, 16_900, "Apple")),
      row("apple", "2026-10-22", 39_900, "Apple"), // an app bought once
    ];
    const s = findSubscriptions(rows, "2026-11-16");
    expect(s.items.map((i) => [i.name, i.amount, i.lastDate])).toEqual([
      ["Apple", 16_900, "2026-11-15"],
      ["Apple", 4_900, "2026-11-03"],
    ]);
    expect(s.monthly).toBe(21_800);
  });

  it("does not take a yearly charge for a monthly one", () => {
    const rows = [row("icloud-year", "2025-11-10", 120_000), row("icloud-year", "2026-11-10", 120_000)];
    expect(findSubscriptions(rows, "2026-11-16").items).toEqual([]);
  });

  it("needs three charges: two a month apart are not enough", () => {
    const rows = [row("s", "2026-10-01", 5_000), row("s", "2026-11-01", 5_000)];
    expect(findSubscriptions(rows, "2026-11-16").items).toEqual([]);
  });

  it("goes over a month shorter than 30 days and the end of a long one", () => {
    const rows = [row("s", "2026-01-31", 5_000), row("s", "2026-02-28", 5_000), row("s", "2026-03-31", 5_000)];
    expect(findSubscriptions(rows, "2026-04-05").items).toHaveLength(1);
  });

  it("leaves out a place with no name: the screen has nothing to call it", () => {
    const rows = [row("s", "2026-09-01", 5_000, " "), row("s", "2026-10-01", 5_000, " "), row("s", "2026-11-01", 5_000, " ")];
    expect(findSubscriptions(rows, "2026-11-16")).toEqual({ monthly: 0, items: [] });
  });

  it("does not see charges after the day asked, for a past month", () => {
    const rows = [row("s", "2026-08-01", 5_000), row("s", "2026-09-01", 5_000), row("s", "2026-10-01", 5_000), row("s", "2026-11-01", 7_000)];
    expect(findSubscriptions(rows, "2026-10-31").items).toEqual([{ key: "s", name: "s", amount: 5_000, lastDate: "2026-10-01", raisedBy: 0, missed: 0 }]);
  });
});
