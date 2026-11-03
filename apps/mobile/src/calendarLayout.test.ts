import { describe, expect, it } from "vitest";
import { dayEdges } from "./calendarLayout";
import { monthGrid } from "./format";

describe("dayEdges", () => {
  const nov = monthGrid(2026, 11); // the 1st is a Sunday: the last column of the first row
  const status = (over: Record<string, string>) => (date: string) => over[date];

  it("places an edge inside its cell, keeping the gap, by column and row", () => {
    const [first, second] = dayEdges(nov, status({ "2026-11-01": "within", "2026-11-02": "over" }), 350, 44, 2);
    expect(first).toEqual({ date: "2026-11-01", x: 302, y: 2, width: 46, height: 40, today: false });
    expect(second).toEqual({ date: "2026-11-02", x: 2, y: 46, width: 46, height: 40, today: false });
  });

  it("marks today, and leaves out days with nothing to edge", () => {
    const edges = dayEdges(nov, status({ "2026-11-03": "today", "2026-11-04": "no_limit", "2026-11-05": "far_over" }), 350, 44, 2);
    expect(edges.map((e) => [e.date, e.today])).toEqual([["2026-11-03", true], ["2026-11-05", false]]);
  });

  it("draws nothing before the grid is measured", () => {
    expect(dayEdges(nov, status({ "2026-11-01": "within" }), 0, 44, 2)).toEqual([]);
  });
});
