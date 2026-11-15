import { describe, expect, it } from "vitest";
import { isOwnPair, OWN_PAIR_WINDOW_MS, type PairLeg } from "./own-pair";

const leg = (over: Partial<PairLeg> = {}): PairLeg => ({
  accountId: 1,
  accountKind: "black",
  currency: "UAH",
  at: 0,
  amount: -410_000,
  amountUah: -410_000,
  ...over,
});
/** $100 bought for ₴4,100 at a rate of 41: the dollar leg's hryvnia amount is at the rate of the day. */
const usd = (over: Partial<PairLeg> = {}): PairLeg =>
  leg({ accountId: 2, currency: "USD", amount: 10_000, amountUah: 410_000, at: 60_000, ...over });

describe("isOwnPair (Б10)", () => {
  it("same currency: an exact opposite amount on another account within the window, as before", () => {
    const out = leg();
    const inn = leg({ accountId: 2, amount: 410_000, amountUah: 410_000, at: 60_000 });
    expect(isOwnPair(out, inn)).toBe(true);
    expect(isOwnPair(inn, out)).toBe(true);
    expect(isOwnPair(out, { ...inn, amount: 409_999, amountUah: 409_999 })).toBe(false);
    expect(isOwnPair(out, { ...inn, amount: -410_000, amountUah: -410_000 })).toBe(false);
  });

  it("same currency keeps pairing a jar, as before", () => {
    expect(isOwnPair(leg(), leg({ accountId: 2, accountKind: "jar", amount: 410_000, amountUah: 410_000 }))).toBe(true);
  });

  it("different currencies pair when the hryvnia amounts differ by at most 3%", () => {
    expect(isOwnPair(leg(), usd())).toBe(true);
    expect(isOwnPair(usd(), leg())).toBe(true);
    // ₴4,100 left, the dollars were worth ₴3,977 (3% less) or ₴4,223 (3% more) at the day's rate.
    expect(isOwnPair(leg(), usd({ amountUah: 397_700 }))).toBe(true);
    expect(isOwnPair(leg({ amount: -397_700, amountUah: -397_700 }), usd())).toBe(true);
    // Dollars sold for hryvnia: the dollar leg goes out.
    expect(isOwnPair(usd({ amount: -10_000, amountUah: -410_000 }), leg({ amount: 405_000, amountUah: 405_000 }))).toBe(true);
  });

  it("different currencies do not pair at a 4% difference", () => {
    expect(isOwnPair(leg(), usd({ amountUah: 393_600 }))).toBe(false);
    expect(isOwnPair(leg({ amount: -393_600, amountUah: -393_600 }), usd())).toBe(false);
  });

  it("different currencies need opposite signs and a known hryvnia amount", () => {
    expect(isOwnPair(leg(), usd({ amount: -10_000, amountUah: -410_000 }))).toBe(false);
    expect(isOwnPair(leg(), usd({ amountUah: null }))).toBe(false);
  });

  it("different currencies pair only between the owner's accounts, never a jar or the cash wallet", () => {
    expect(isOwnPair(leg(), usd({ accountKind: "jar" }))).toBe(false);
    expect(isOwnPair(leg({ accountKind: "jar" }), usd())).toBe(false);
    expect(isOwnPair(leg({ accountKind: "cash" }), usd())).toBe(false);
    expect(isOwnPair(leg({ accountKind: "white" }), usd({ accountKind: "fop" }))).toBe(true);
  });

  it("never on the same account", () => {
    expect(isOwnPair(leg(), leg({ amount: 410_000, amountUah: 410_000 }))).toBe(false);
    expect(isOwnPair(leg(), usd({ accountId: 1 }))).toBe(false);
  });

  it("never outside the window", () => {
    expect(isOwnPair(leg(), usd({ at: OWN_PAIR_WINDOW_MS }))).toBe(true);
    expect(isOwnPair(leg(), usd({ at: OWN_PAIR_WINDOW_MS + 1 }))).toBe(false);
    expect(isOwnPair(leg({ at: OWN_PAIR_WINDOW_MS + 1 }), leg({ accountId: 2, amount: 410_000, amountUah: 410_000 }))).toBe(false);
  });
});
