import { describe, expect, it } from "vitest";
import { binanceTake, exchangeRate } from "./cash-exchange";

describe("exchangeRate", () => {
  it("is hryvnias per dollar, to two decimals", () => {
    // $1,400 for ₴65,430: 46.7357… a dollar.
    expect(exchangeRate(6_543_000, 140_000)).toBe(46.74);
    expect(exchangeRate(4_100_000, 100_000)).toBe(41);
    expect(exchangeRate(1, 3)).toBe(0.33);
  });
});

describe("binanceTake", () => {
  it("takes the dollars given off the balance", () => {
    expect(binanceTake(500_000, 140_000)).toEqual({ next: 360_000, taken: 140_000 });
  });

  it("never below zero: only what was there is taken", () => {
    expect(binanceTake(100_000, 140_000)).toEqual({ next: 0, taken: 100_000 });
    expect(binanceTake(0, 140_000)).toEqual({ next: 0, taken: 0 });
    expect(binanceTake(-5, 140_000)).toEqual({ next: -5, taken: 0 });
  });

  it("with no Binance balance takes nothing", () => {
    expect(binanceTake(null, 140_000)).toEqual({ next: null, taken: 0 });
  });
});
