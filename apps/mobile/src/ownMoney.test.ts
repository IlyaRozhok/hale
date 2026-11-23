import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";
import type { OwnMoneyItemDto } from "@hale/contracts";
import { accountPatchOf, goalDetail, goalMoney, goalPlaces, placeName, placeNote, placeOpens, setAsideDetail, setAsideTotal, wholeShares } from "./ownMoney";

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

  it("shows money set aside in its own currency: hryvnias and dollars whole, others with cents when there are any", () => {
    expect(setAsideDetail(deposit)).toBe("₴50,000");
    expect(setAsideDetail({ ...deposit, name: "SOL", currency: "USD", amount: 100_500, own: 4_100_000 })).toBe("$1,005");
    expect(setAsideDetail({ ...deposit, currency: "EUR", amount: 50_000, own: 2_400_000 })).toBe("€500");
    // A bank account is shown in hryvnias, as it counts.
    expect(setAsideDetail({ ...card, own: 210_000, countsAsOwn: false })).toBe("₴2,100");
  });
});

describe("the total of «Отложено» (variant А)", () => {
  it("adds up the set-aside places in hryvnias, and is nothing when there are none or an older server does not say", () => {
    const sol: OwnMoneyItemDto = { kind: "manual", name: "SOL", own: 4_145_625, currency: "USD", amount: 100_500, id: 9, source: "manual", countsAsOwn: false };
    const deposit: OwnMoneyItemDto = { kind: "manual", name: "Депозит", own: 5_000_000, currency: "UAH", amount: 5_000_000, id: 10, source: "manual", countsAsOwn: false };
    expect(setAsideTotal([sol, deposit])).toBe("₴91,456");
    expect(setAsideTotal([])).toBeUndefined();
    expect(setAsideTotal(undefined)).toBeUndefined();
  });
});

describe("the note under a place (variant А)", () => {
  it("says what a card in credit stands for, or a hand-kept balance in its own currency", () => {
    expect(placeNote({ kind: "black", name: "Чёрная карта", own: -3_000_000, creditLimit: 3_000_000 })).toBe("кредитный лимит потрачен весь");
    expect(placeNote({ kind: "black", name: "Чёрная карта", own: -2_000_000, creditLimit: 3_000_000 })).toBe("потрачено из кредитного лимита ₴30,000");
    expect(placeNote({ kind: "binance", name: "Binance", own: 579_900, currency: "USD", amount: 12_600 })).toBe("$126");
    expect(placeNote({ kind: "manual", name: "Конверт", own: 100_000, currency: "UAH", amount: 100_000 })).toBeNull();
    expect(placeNote({ kind: "white", name: "Белая карта", own: 100_000 })).toBeNull();
  });
});

describe("goals kept in a place (ЯМ5, variant А)", () => {
  const white: OwnMoneyItemDto = { kind: "white", name: "Белая карта", own: 1_431_300, id: 2, source: "account", countsAsOwn: true };
  const black: OwnMoneyItemDto = { kind: "black", name: "Чёрная карта", own: -3_000_000, creditLimit: 3_000_000, id: 1, source: "account", countsAsOwn: true };
  const wallet: OwnMoneyItemDto = { kind: "cash", name: "Наличные", own: 3_025_000, source: "cash", countsAsOwn: true };
  const binance: OwnMoneyItemDto = { kind: "binance", name: "Binance", own: 5_000_000, currency: "USD", amount: 120_000, id: 7, source: "manual", countsAsOwn: true };
  const usd: OwnMoneyItemDto = { kind: "other", name: "Валютный", own: 4_100_000, currency: "USD", amount: 100_050, id: 3, source: "account", countsAsOwn: false };
  const deposit: OwnMoneyItemDto = { kind: "manual", name: "Депозит", own: 6_000_000, currency: "UAH", amount: 6_000_000, id: 9, source: "manual", countsAsOwn: false };
  const older: OwnMoneyItemDto = { kind: "white", name: "Белая карта", own: 100_000 };

  it("offers the places «Отложено» shows, then Binance, each with its balance in its own currency", () => {
    const places = goalPlaces({ items: [white, black, wallet, binance], setAside: [usd, deposit] });
    expect(places.map((p) => [p.source, p.id, p.name, p.currency, p.balance])).toEqual([
      ["account", 3, "Валютный", "USD", "$1,001"],
      ["manual", 9, "Депозит", "UAH", "₴60,000"],
      ["manual", 7, "Binance", "USD", "$1,200"],
    ]);
    expect(places.map((p) => p.icon)).toEqual(["card", "lock", "coin"]);
  });

  it("leaves out own-money cards and accounts, the wallet, places an older server does not name, and repeats", () => {
    const fop: OwnMoneyItemDto = { kind: "fop", name: "ФОП", own: 426_000, id: 5, source: "account", countsAsOwn: true };
    expect(goalPlaces({ items: [white, black, fop, wallet, older], setAside: [] })).toEqual([]);
    expect(goalPlaces({ items: [binance], setAside: [{ ...binance, countsAsOwn: false }] })).toHaveLength(1);
    expect(goalPlaces({ items: [], setAside: [{ ...wallet, countsAsOwn: false }] })).toEqual([]);
    expect(goalPlaces(undefined)).toEqual([]);
  });

  it("shows a goal's money whole in its currency, dollars when the server does not say", () => {
    expect(goalMoney(120_000, "USD")).toBe("$1,200");
    expect(goalMoney(6_000_000, "UAH")).toBe("₴60,000");
    expect(goalMoney(50_040, "EUR")).toBe("€500");
    expect(goalMoney(50_000, undefined)).toBe("$500");
  });

  it("says saved of target, and where the goal is kept when it has a place", () => {
    const goal = { id: 1, name: "Отпуск", target_cents: 500_000, saved_cents: 120_000, sort: 0 };
    expect(goalDetail(goal)).toBe("$1,200 из $5,000");
    expect(goalDetail({ ...goal, currency: "USD", place: { source: "manual", id: 7, name: "Binance" } })).toBe("$1,200 из $5,000 · на Binance");
    expect(goalDetail({ ...goal, currency: "UAH", target_cents: 9_000_000, saved_cents: 6_000_000, place: null })).toBe("₴60,000 из ₴90,000");
  });
});
