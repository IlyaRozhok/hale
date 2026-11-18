import { describe, expect, it } from "vitest";
import { type ChargeRow, findSubscriptions, subscriptionsFrom } from "./subscriptions";

const row = (key: string, date: string, amount: number, name = key): ChargeRow => ({ key, name, date, amount });
/** The Kyiv day `n` days after 20 May 2026: six months before the 16 November most tests look from. */
const day = (n: number): string => new Date(Date.UTC(2026, 4, 20) + n * 86_400_000).toISOString().slice(0, 10);

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
    const steady = [row("s", "2026-08-01", 10_000), row("s", "2026-09-01", 10_000), row("s", "2026-10-01", 10_000)];
    const rise = findSubscriptions([...steady, row("s", "2026-11-01", 16_000)], "2026-11-16");
    expect(rise.items).toEqual([{ key: "s", name: "s", amount: 16_000, lastDate: "2026-11-01", raisedBy: 6_000, missed: 0 }]);
    // ₴160.01 is another purchase: the ₴100 one is not charged since October and the sum is not like it.
    const jump = findSubscriptions([...steady, row("s", "2026-11-01", 16_001)], "2026-11-16");
    expect(jump.items.map((i) => [i.amount, i.lastDate, i.raisedBy, i.missed])).toEqual([[10_000, "2026-10-01", 0, 1]]);
  });

  it("believes a price rise only after three charges at the old price: a café at ₴120, ₴125, ₴190 is not one", () => {
    const cafe = [row("cafe", "2026-09-02", 12_000), row("cafe", "2026-10-01", 12_500), row("cafe", "2026-11-01", 19_000)];
    expect(findSubscriptions(cafe, "2026-11-16").items).toEqual([]);
    const four = [row("cafe", "2026-08-01", 12_000), ...cafe];
    expect(findSubscriptions(four, "2026-11-16").items).toEqual([{ key: "cafe", name: "cafe", amount: 19_000, lastDate: "2026-11-01", raisedBy: 6_500, missed: 0 }]);
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

  it("keeps an active subscription that skipped one month, on the total and not «давно не списывалась»", () => {
    const skipped = ["06", "07", "08", "10", "11"].map((m) => row("s", `2026-${m}-05`, 10_000));
    expect(findSubscriptions(skipped, "2026-11-16")).toEqual({
      monthly: 10_000,
      items: [{ key: "s", name: "s", amount: 10_000, lastDate: "2026-11-05", raisedBy: 0, missed: 0 }],
    });
    const declined = ["07", "08", "09", "11"].map((m) => row("s", `2026-${m}-05`, 10_000));
    expect(findSubscriptions(declined, "2026-11-16")).toEqual({
      monthly: 10_000,
      items: [{ key: "s", name: "s", amount: 10_000, lastDate: "2026-11-05", raisedBy: 0, missed: 0 }],
    });
    // With the month skipped the step is still a month (about 31 days): due again on 5 December, missed from the 22nd.
    expect(findSubscriptions(declined, "2026-12-21").items[0]!.missed).toBe(0);
    expect(findSubscriptions(declined, "2026-12-22").items[0]!.missed).toBe(1);
  });

  it("does not call one charged again after a longer pause «давно не списывалась»", () => {
    const rows = [...["06", "07", "08"].map((m) => row("s", `2026-${m}-05`, 10_000)), row("s", "2026-11-05", 10_000)];
    expect(findSubscriptions(rows, "2026-11-16")).toEqual({ monthly: 0, items: [] });
    // Not charged since August, and nothing like it since: it is.
    expect(findSubscriptions(rows.slice(0, 3), "2026-11-16").items[0]).toMatchObject({ lastDate: "2026-08-05", missed: 2 });
  });

  it("does not take a place paid every two months for a monthly subscription: one skip in a history, not more", () => {
    const rows = ["2026-06-05", "2026-08-05", "2026-10-05"].map((d) => row("s", d, 10_000));
    expect(findSubscriptions(rows, "2026-11-16").items).toEqual([]);
  });

  it("takes two subscriptions at one place at the same price on different days for two", () => {
    const rows = ["06", "07", "08", "09", "10", "11"].flatMap((m) => [row("apple", `2026-${m}-03`, 4_900, "Apple"), row("apple", `2026-${m}-15`, 4_900, "Apple")]);
    const s = findSubscriptions(rows, "2026-11-16");
    expect(s.items.map((i) => [i.amount, i.lastDate, i.missed])).toEqual([
      [4_900, "2026-11-15", 0],
      [4_900, "2026-11-03", 0],
    ]);
    expect(s.monthly).toBe(9_800);
  });

  it("takes two subscriptions at one place at close prices for two", () => {
    const rows = ["06", "07", "08", "09", "10", "11"].flatMap((m) => [row("apple", `2026-${m}-03`, 4_900, "Apple"), row("apple", `2026-${m}-15`, 5_900, "Apple")]);
    const s = findSubscriptions(rows, "2026-11-16");
    expect(s.items.map((i) => [i.amount, i.lastDate])).toEqual([
      [5_900, "2026-11-15"],
      [4_900, "2026-11-03"],
    ]);
    expect(s.monthly).toBe(10_800);
  });

  it("keeps a subscription next to a one-off purchase near its price, or a second charge in one month", () => {
    const icloud = ["06", "07", "08", "09", "10", "11"].map((m) => row("apple", `2026-${m}-03`, 4_900, "Apple"));
    expect(findSubscriptions([...icloud, row("apple", "2026-09-20", 5_500, "Apple")], "2026-11-16").items).toEqual([
      { key: "apple", name: "Apple", amount: 4_900, lastDate: "2026-11-03", raisedBy: 0, missed: 0 },
    ]);
    // Charged twice in September: one subscription still, at its monthly sum.
    const twice = findSubscriptions([...icloud, row("apple", "2026-09-18", 4_900, "Apple")], "2026-11-16");
    expect(twice.items.map((i) => [i.amount, i.lastDate])).toEqual([[4_900, "2026-11-03"]]);
    expect(twice.monthly).toBe(4_900);
  });

  it("does not take a weekly purchase of one sum for monthly subscriptions", () => {
    const rows = Array.from({ length: 24 }, (_, i) => row("delivery", new Date(Date.UTC(2026, 5, 2 + i * 7)).toISOString().slice(0, 10), 35_000));
    expect(findSubscriptions(rows, "2026-11-16").items).toEqual([]);
  });

  it("does not take a café visited several times a week for a subscription", () => {
    const sums = [6_500, 12_000, 4_000, 9_000, 6_500, 15_000, 7_000];
    const rows = Array.from({ length: 60 }, (_, i) => row("cafe", new Date(Date.UTC(2026, 5, 1 + Math.floor(i * 2.7))).toISOString().slice(0, 10), sums[i % sums.length]!));
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

  it("does not take a shop bought at about weekly at sums within ±15% for a subscription «не списывалась»", () => {
    // Interleaved, these purchases make about-monthly chains at close sums, and the chains take almost every purchase
    // between them. Before the shop rule ran first, one came out as ₴255, last charged on 29 September, missed 1.
    const days = [5, 13, 21, 26, 34, 42, 48, 55, 62, 68, 75, 82, 91, 97, 103, 111, 118, 125, 132, 139, 146, 152, 160, 167, 173];
    const sums = [
      33_300, 26_300, 34_500, 31_700, 34_000, 32_300, 28_700, 27_000, 30_200, 26_600, 27_500, 30_700, 26_000, 25_600, 31_700, 26_500, 33_500, 26_700,
      25_500, 27_400, 29_100, 30_800, 26_300, 32_600, 28_900,
    ];
    const rows = days.map((d, i) => row("shop", day(d), sums[i]!));
    expect(findSubscriptions(rows, "2026-11-16")).toEqual({ monthly: 0, items: [] });
  });

  it("does not take a shop bought at every ten days at sums within ±10% for a subscription", () => {
    // Before the shop rule ran first: ₴324 a month, last on 15 October.
    const days = [9, 18, 27, 39, 48, 58, 69, 77, 88, 97, 109, 119, 128, 138, 148, 157, 167, 177];
    const sums = [32_500, 31_900, 27_600, 27_500, 31_900, 30_800, 32_100, 27_500, 28_300, 27_900, 31_100, 31_200, 29_300, 27_400, 32_400, 28_100, 28_900, 27_600];
    const rows = days.map((d, i) => row("shop", day(d), sums[i]!));
    expect(findSubscriptions(rows, "2026-11-16")).toEqual({ monthly: 0, items: [] });
  });

  describe("on generated places (a fixed seed)", () => {
    function random(seed: number): () => number {
      let s = seed >>> 0;
      return () => {
        s = (s * 1_664_525 + 1_013_904_223) >>> 0;
        return s / 2 ** 32;
      };
    }
    /** How many of 200 shops, bought at every `every` days (±1 day) at ₴300 ± `spread`, come out with a subscription. */
    function falseShops(every: number, spread: number): number {
      const r = random(every * 1_000 + spread * 100);
      let shops = 0;
      for (let k = 0; k < 200; k++) {
        const rows: ChargeRow[] = [];
        for (let d = Math.floor(r() * every); d < 180; d += every) {
          rows.push(row("shop", day(d + Math.round(r() * 2) - 1), Math.round(30_000 * (1 + (r() * 2 - 1) * spread))));
        }
        if (findSubscriptions(rows, "2026-11-16").items.length > 0) shops++;
      }
      return shops;
    }

    it("rarely takes a shop for a subscription", () => {
      expect(falseShops(7, 0.1)).toBe(0);
      expect(falseShops(7, 0.2)).toBe(0);
      expect(falseShops(5, 0.1)).toBe(0);
      expect(falseShops(3, 0.3)).toBe(0);
      expect(falseShops(10, 0.1)).toBeLessThanOrEqual(2);
      // Every 14 days at one price is two monthly charges, as two subscriptions at one store are: not told apart.
    });

    it("finds the subscriptions themselves, with a rate drift, a late bank and one-off purchases at the store", () => {
      const r = random(42);
      let all = 0;
      for (let k = 0; k < 200; k++) {
        const rows: ChargeRow[] = [];
        for (let s = 0; s < 2; s++) {
          const base = 4_900 + s * 10_000;
          const d0 = Math.floor(r() * 28);
          for (let m = 0; m < 6; m++) rows.push(row("apple", day(d0 + m * 30 + Math.round(r() * 4) - 2), Math.round(base * (1 + (r() * 2 - 1) * 0.03))));
        }
        for (let e = 0; e < 3; e++) rows.push(row("apple", day(Math.floor(r() * 175)), 2_000 + Math.floor(r() * 20_000)));
        if (findSubscriptions(rows, "2026-11-16").items.filter((i) => i.missed === 0).length === 2) all++;
      }
      expect(all).toBeGreaterThanOrEqual(190);
    });
  });
});
