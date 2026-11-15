import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";
import { wholeShares } from "./ownMoney";

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
