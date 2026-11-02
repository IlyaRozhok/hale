import { describe, expect, it } from "vitest";
import { quarterOf } from "./quarter";

describe("quarterOf", () => {
  it("handles each quarter and the year end", () => {
    expect(quarterOf("2026-11-02")).toEqual({ start: "2026-10-01", end: "2026-12-31", daysIn: 92, dayOf: 33 });
    expect(quarterOf("2026-03-31")).toEqual({ start: "2026-01-01", end: "2026-03-31", daysIn: 90, dayOf: 90 });
    expect(quarterOf("2028-02-29")).toMatchObject({ daysIn: 91, dayOf: 60 });
    expect(quarterOf("2026-07-01")).toMatchObject({ start: "2026-07-01", end: "2026-09-30", dayOf: 1 });
  });
});
