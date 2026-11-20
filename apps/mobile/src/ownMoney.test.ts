import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";
import type { OwnMoneyItemDto } from "@hale/contracts";
import { accountPatchOf, placeName, placeOpens, setAsideDetail, wholeShares } from "./ownMoney";

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
/** The total as the screen shows it, in whole hryvnias. */
const shown = (kopecks: number) => Number(formatMoney(kopecks).replace("−", "-").replace(/[₴,]/g, ""));

describe("wholeShares", () => {
  it("keeps whole amounts as they are", () => {
    expect(wholeShares(2_036_200, [-3_000_000, 1_431_300, 3_025_000, 579_900])).toEqual([-30_000, 14_313, 30_250, 5_799]);
  });

  it("makes the reviewer's case add up to the shown −₴12,686", () => {
    const rows = [1_431_350, 300_050, -3_000_000];
    const total = sum(rows);
    expect(formatMoney(total)).toBe("−₴12,686");
    const out = wholeShares(total, rows);
    expect(sum(out)).toBe(-12_686);
    // Each row stays within a hryvnia of its own amount.
    out.forEach((w, i) => expect(Math.abs(w * 100 - rows[i]!)).toBeLessThan(100));
    expect(out).toEqual([14_314, 3_000, -30_000]);
  });

  it("adds up for positive amounts that each round up", () => {
    const rows = [10_060, 10_060, 10_060];
    const out = wholeShares(sum(rows), rows);
    expect(sum(out)).toBe(shown(sum(rows)));
    expect(out).toEqual([101, 101, 100]);
  });

  it("adds up for a mix of negative and positive amounts with remainders", () => {
    const cases = [
      [-1_000_070, 500_040, 250_045, 99],
      [-50, -50, 120],
      [-12_345, 6_789, 99_999, -1],
      [33_333, 33_333, 33_334],
      [-33_350, -33_350],
    ];
    for (const rows of cases) {
      const out = wholeShares(sum(rows), rows);
      expect(sum(out)).toBe(shown(sum(rows)));
      out.forEach((w, i) => expect(Math.abs(w * 100 - rows[i]!)).toBeLessThan(100));
    }
  });

  it("rounds each place on its own when the places do not add up to the total", () => {
    expect(wholeShares(1_000_000, [10_060, 20_040])).toEqual([101, 200]);
  });
});

describe("places of money as rows (task Д2б)", () => {
  const card: OwnMoneyItemDto = { kind: "other", name: "Детская карта", own: 210_000, id: 5, source: "account", countsAsOwn: true };
  const deposit: OwnMoneyItemDto = { kind: "manual", name: "Депозит Приват", own: 5_000_000, currency: "UAH", amount: 5_000_000, id: 9, source: "manual", countsAsOwn: false };

  it("opens the wallet and Binance in their own windows, any other place in the account window", () => {
    expect(placeOpens({ kind: "cash", name: "Наличные", own: 1, source: "cash", countsAsOwn: true })).toBe("cash");
    expect(placeOpens({ kind: "binance", name: "Binance", own: 1, id: 7, source: "manual", countsAsOwn: true })).toBe("binance");
    expect(placeOpens(card)).toBe("account");
    expect(placeOpens(deposit)).toBe("manual");
  });

  it("opens nothing for a card from an older server, which says neither where it is kept nor its id", () => {
    expect(placeOpens({ kind: "white", name: "Белая карта", own: 1 })).toBeNull();
    expect(placeOpens({ kind: "white", name: "Белая карта", own: 1, source: "account" })).toBeNull();
    // An older server's wallet and Binance open as they always did.
    expect(placeOpens({ kind: "cash", name: "Наличные", own: 1 })).toBe("cash");
    expect(placeOpens({ kind: "binance", name: "Binance", own: 1 })).toBe("binance");
  });

  it("names a bank account by the person's name, and an older server's card by its kind", () => {
    expect(placeName(card)).toBe("Детская карта");
    expect(placeName({ kind: "black", name: "Кредитка", own: 1, id: 1, source: "account", countsAsOwn: true })).toBe("Кредитка");
    expect(placeName({ kind: "black", name: "что-то", own: 1 })).toBe("Чёрная карта");
    expect(placeName(deposit)).toBe("Депозит Приват");
  });

  it("sends only what was changed in the account window", () => {
    expect(accountPatchOf(card, "Детская карта", true)).toBeNull();
    expect(accountPatchOf(card, "  Карта сына ", true)).toEqual({ name: "Карта сына" });
    expect(accountPatchOf(card, "Детская карта", false)).toEqual({ countsAsOwn: false });
    expect(accountPatchOf(card, "Карта сына", false)).toEqual({ name: "Карта сына", countsAsOwn: false });
  });

  it("gives the default name back when the name is cleared", () => {
    expect(accountPatchOf(card, "   ", true)).toEqual({ name: null });
  });

  it("shows money set aside in its own currency: hryvnias and dollars whole, others with cents", () => {
    expect(setAsideDetail(deposit)).toBe("₴50,000");
    expect(setAsideDetail({ ...deposit, name: "SOL", currency: "USD", amount: 100_500, own: 4_100_000 })).toBe("$1,005");
    expect(setAsideDetail({ ...deposit, currency: "EUR", amount: 50_000, own: 2_400_000 })).toBe("€500.00");
    // A bank account is shown in hryvnias, as it counts.
    expect(setAsideDetail({ ...card, own: 210_000, countsAsOwn: false })).toBe("₴2,100");
  });
});
