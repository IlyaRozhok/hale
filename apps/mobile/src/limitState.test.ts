import { describe, expect, it } from "vitest";
import { limitState } from "./limitState";

describe("limitState", () => {
  it("is ok while more than a quarter is left", () => {
    expect(limitState({ leftToday: 124000, level: 0.62 })).toBe("ok");
    expect(limitState({ leftToday: 52000, level: 0.26 })).toBe("ok");
  });
  it("is low at a quarter or less", () => {
    expect(limitState({ leftToday: 50000, level: 0.25 })).toBe("low");
    expect(limitState({ leftToday: 100, level: 0.01 })).toBe("low");
  });
  it("is over once nothing is left, used up exactly included", () => {
    expect(limitState({ leftToday: 0, level: 0 })).toBe("over");
    expect(limitState({ leftToday: -60100, level: 0.4 })).toBe("over");
  });
  it("is never over on the day the shortage came on: sand, whatever was spent before the new limit", () => {
    const shortageStart = { nextLimit: 45000 };
    expect(limitState({ leftToday: -60100, level: 0, shortageStart })).toBe("low");
    expect(limitState({ leftToday: 0, level: 0, shortageStart })).toBe("low");
    expect(limitState({ leftToday: 40000, level: 0.9, shortageStart })).toBe("low");
  });
});
