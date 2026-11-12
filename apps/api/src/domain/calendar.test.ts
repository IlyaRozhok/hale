import { describe, expect, it } from "vitest";
import { currentStreak, dayStatus } from "./calendar";

describe("dayStatus", () => {
  it("is within the limit up to and including it", () => {
    expect(dayStatus(100_000, 0)).toBe("within");
    expect(dayStatus(100_000, 100_000)).toBe("within");
    expect(dayStatus(100_000, -5_000)).toBe("within");
  });
  it("is over above the limit, up to and including 150%", () => {
    expect(dayStatus(100_000, 100_001)).toBe("over");
    expect(dayStatus(100_000, 150_000)).toBe("over");
  });
  it("is far over above 150%", () => {
    expect(dayStatus(100_000, 150_001)).toBe("far_over");
  });
  it("has no status without a limit", () => {
    expect(dayStatus(null, 50_000)).toBe("no_limit");
    expect(dayStatus(0, 50_000)).toBe("no_limit");
  });
  it("does not judge the day the shortage came on, over its limit or within it", () => {
    expect(dayStatus(45_000, 1_100_000, true)).toBe("no_limit");
    expect(dayStatus(45_000, 10_000, true)).toBe("no_limit");
    expect(dayStatus(45_000, 10_000, false)).toBe("within");
  });
});

describe("currentStreak", () => {
  const day = (date: string, limit: number | null, spent: number) => ({ date, limit, spent });

  it("counts days within the limit back from yesterday", () => {
    expect(currentStreak([day("2026-11-02", 100, 50), day("2026-11-01", 100, 100), day("2026-10-31", 100, 500), day("2026-10-30", 100, 1)], "2026-11-03")).toBe(2);
  });
  it("is not broken by a day with no limit, which does not count either", () => {
    expect(currentStreak([day("2026-11-02", 100, 50), day("2026-11-01", null, 900), day("2026-10-31", 0, 900), day("2026-10-30", 100, 1)], "2026-11-03")).toBe(2);
  });
  it("leaves today out, whatever was spent", () => {
    expect(currentStreak([day("2026-11-03", 100, 900), day("2026-11-02", 100, 50)], "2026-11-03")).toBe(1);
    expect(currentStreak([day("2026-11-03", 100, 1)], "2026-11-03")).toBe(0);
  });
  it("is zero right after a day over the limit", () => {
    expect(currentStreak([day("2026-11-02", 100, 101), day("2026-11-01", 100, 1)], "2026-11-03")).toBe(0);
  });
  it("does not depend on the order it is given", () => {
    expect(currentStreak([day("2026-10-31", 100, 500), day("2026-11-02", 100, 50), day("2026-11-01", 100, 1)], "2026-11-03")).toBe(2);
  });
  describe("the day the shortage came on", () => {
    const start = (date: string, limit: number, spent: number) => ({ date, limit, spent, shortageStart: true });

    it("over its limit, between two good days, does not break the streak and does not add to it", () => {
      expect(currentStreak([day("2026-11-02", 100, 50), start("2026-11-01", 100, 900), day("2026-10-31", 100, 1)], "2026-11-03")).toBe(2);
    });
    it("within its limit does not add to the streak either", () => {
      expect(currentStreak([day("2026-11-02", 100, 50), start("2026-11-01", 100, 10), day("2026-10-31", 100, 1)], "2026-11-03")).toBe(2);
    });
    it("as yesterday, the first day looked at, leaves the streak behind it standing", () => {
      expect(currentStreak([start("2026-11-02", 100, 900), day("2026-11-01", 100, 1), day("2026-10-31", 100, 1)], "2026-11-03")).toBe(2);
      expect(currentStreak([start("2026-11-02", 100, 900)], "2026-11-03")).toBe(0);
    });
    it("does not hide a day over the limit behind it", () => {
      expect(currentStreak([day("2026-11-02", 100, 50), start("2026-11-01", 100, 900), day("2026-10-31", 100, 500), day("2026-10-30", 100, 1)], "2026-11-03")).toBe(1);
    });
  });

  it("is zero with no days", () => {
    expect(currentStreak([], "2026-11-03")).toBe(0);
  });
});
