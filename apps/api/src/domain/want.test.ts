import { describe, expect, it } from "vitest";
import { DEFAULT_WANT, buildWanted, canOverrideWant, effectiveWant } from "./want";

describe("effectiveWant (В6)", () => {
  it("follows the category when the operation has no choice of its own", () => {
    expect(effectiveWant("spend", true, null)).toBe(true);
    expect(effectiveWant("spend", false, null)).toBe(false);
  });

  it("takes the operation's own choice over the category's", () => {
    expect(effectiveWant("spend", true, false)).toBe(false);
    expect(effectiveWant("spend", false, true)).toBe(true);
  });

  it("is on neither side in a system category or one with no flag, whatever the operation says", () => {
    expect(effectiveWant("spend", null, null)).toBeNull();
    expect(effectiveWant("spend", null, true)).toBeNull();
    expect(effectiveWant("spend", null, false)).toBeNull();
  });

  it("is on neither side for anything but a purchase", () => {
    for (const type of ["person_transfer", "cash_out", "obligation", "income", null]) {
      expect(effectiveWant(type, true, null)).toBeNull();
      expect(effectiveWant(type, false, true)).toBeNull();
    }
  });
});

describe("canOverrideWant (В6)", () => {
  it("only a purchase in a category with a side", () => {
    expect(canOverrideWant("spend", true)).toBe(true);
    expect(canOverrideWant("spend", false)).toBe(true);
    expect(canOverrideWant("spend", null)).toBe(false);
    expect(canOverrideWant("person_transfer", true)).toBe(false);
    expect(canOverrideWant(null, false)).toBe(false);
  });
});

describe("DEFAULT_WANT (В6)", () => {
  it("puts cafes, leisure, shopping and subscriptions on «желаемое», the rest of the defaults on «нужное»", () => {
    expect(DEFAULT_WANT).toEqual({
      groceries: false,
      cafe: true,
      transport: false,
      subscriptions: true,
      leisure: true,
      health: false,
      utilities: false,
      telecom: false,
      shopping: true,
    });
  });
});

describe("buildWanted (В6)", () => {
  it("adds up each stretch", () => {
    expect(
      buildWanted([
        { period: "current", spent: 30_000 },
        { period: "previous", spent: 4_000 },
        { period: "current", spent: 7_000 },
      ]),
    ).toEqual({ wanted: 37_000, previousWanted: 4_000 });
  });

  it("is zero for a stretch with none, and never below zero when a refund outweighs the purchases", () => {
    expect(buildWanted([])).toEqual({ wanted: 0, previousWanted: 0 });
    expect(buildWanted([{ period: "current", spent: -5_000 }, { period: "previous", spent: 3_000 }])).toEqual({ wanted: 0, previousWanted: 3_000 });
  });
});
