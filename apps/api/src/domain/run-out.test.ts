import { describe, expect, it } from "vitest";
import { runOutDate } from "./run-out.js";

describe("runOutDate", () => {
  it("returns null when nothing is spent", () => {
    expect(runOutDate({ free: 100_000, avgDailySpend: 0, today: "2026-11-02" })).toBeNull();
  });
  it("returns the day the money runs out", () => {
    // 16 full days of 50,000 fit in 800,000+; day 17 from today is short
    expect(runOutDate({ free: 800_000, avgDailySpend: 50_000, today: "2026-11-02" })).toBe(
      "2026-11-18",
    );
  });
  it("returns today when there is no free money", () => {
    expect(runOutDate({ free: 0, avgDailySpend: 50_000, today: "2026-11-02" })).toBe("2026-11-02");
    expect(runOutDate({ free: -5, avgDailySpend: 50_000, today: "2026-11-02" })).toBe("2026-11-02");
  });
  it("rounds down to whole affordable days", () => {
    expect(runOutDate({ free: 99_999, avgDailySpend: 50_000, today: "2026-11-02" })).toBe(
      "2026-11-03",
    );
  });
});
