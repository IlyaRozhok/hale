import { describe, expect, it } from "vitest";
import { estimateDueOn, precedingQuarter, quarterBounds, quarterLabel, quarterOf } from "./quarter";

describe("quarterOf", () => {
  it("handles each quarter and the year end", () => {
    expect(quarterOf("2026-11-02")).toEqual({ start: "2026-10-01", end: "2026-12-31", daysIn: 92, dayOf: 33 });
    expect(quarterOf("2026-03-31")).toEqual({ start: "2026-01-01", end: "2026-03-31", daysIn: 90, dayOf: 90 });
    expect(quarterOf("2028-02-29")).toMatchObject({ daysIn: 91, dayOf: 60 });
    expect(quarterOf("2026-07-01")).toMatchObject({ start: "2026-07-01", end: "2026-09-30", dayOf: 1 });
  });
});

describe("quarter labels", () => {
  it("names the quarter of a date", () => {
    expect(quarterLabel("2026-01-01")).toBe("2026-Q1");
    expect(quarterLabel("2026-03-31")).toBe("2026-Q1");
    expect(quarterLabel("2026-12-31")).toBe("2026-Q4");
  });
  it("finds the quarter a due date pays for, across the year end", () => {
    expect(precedingQuarter("2026-11-20")).toBe("2026-Q3");
    expect(precedingQuarter("2026-10-01")).toBe("2026-Q3");
    expect(precedingQuarter("2027-02-20")).toBe("2026-Q4");
  });
  it("gives a quarter's first and last day", () => {
    expect(quarterBounds("2026-Q4")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(quarterBounds("2028-Q1")).toEqual({ start: "2028-01-01", end: "2028-03-31" });
  });
  it("puts an estimate on the 20th of the second month after the quarter", () => {
    expect(estimateDueOn("2026-Q1")).toBe("2026-05-20");
    expect(estimateDueOn("2026-Q3")).toBe("2026-11-20");
    expect(estimateDueOn("2026-Q4")).toBe("2027-02-20");
  });
});
