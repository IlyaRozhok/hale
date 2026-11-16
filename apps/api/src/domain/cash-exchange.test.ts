import { describe, expect, it } from "vitest";
import { binanceTake } from "./cash-exchange";

// The rate of an exchange is exchangeRate in @hale/contracts: the server and the app round it the same way.

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
