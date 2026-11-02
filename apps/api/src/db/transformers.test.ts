import { describe, expect, it } from "vitest";
import { bigintTransformer as bt } from "./transformers";

describe("bigintTransformer", () => {
  it("converts pg strings to numbers and passes null through", () => {
    expect(bt.from("12345")).toBe(12345);
    expect(bt.from("-7")).toBe(-7);
    expect(bt.from(null)).toBeNull();
    expect(bt.to(99)).toBe(99);
  });
  it("rejects values beyond the safe integer range in both directions", () => {
    expect(() => bt.from("9007199254740993")).toThrow(RangeError);
    expect(() => bt.to(2 ** 53)).toThrow(RangeError);
    expect(() => bt.to(1.5)).toThrow(RangeError);
  });
});
