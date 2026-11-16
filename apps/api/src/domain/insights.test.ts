import { describe, expect, it } from "vitest";
import { buildInsights, insightsWindow, previousMonth } from "./insights";

describe("previousMonth", () => {
  it("steps back across the year", () => {
    expect(previousMonth("2026-03")).toBe("2026-02");
    expect(previousMonth("2027-01")).toBe("2026-12");
  });
});

describe("insightsWindow", () => {
  it("counts the current month up to today against the same days of the month before", () => {
    expect(insightsWindow("2026-11", "2026-11-16")).toEqual({
      month: "2026-11",
      from: "2026-11-01",
      to: "2026-11-16",
      previousFrom: "2026-10-01",
      previousTo: "2026-10-16",
    });
  });

  it("compares 31 March with the whole of a shorter February", () => {
    expect(insightsWindow("2026-03", "2026-03-31")).toMatchObject({ to: "2026-03-31", previousFrom: "2026-02-01", previousTo: "2026-02-28" });
    expect(insightsWindow("2026-03", "2026-03-29")).toMatchObject({ previousTo: "2026-02-28" });
    expect(insightsWindow("2026-03", "2026-03-28")).toMatchObject({ previousTo: "2026-02-28" });
  });

  it("takes 29 February in a leap year", () => {
    expect(insightsWindow("2028-03", "2028-03-31")).toMatchObject({ previousTo: "2028-02-29" });
    expect(insightsWindow("2028-02", "2028-03-05")).toMatchObject({ from: "2028-02-01", to: "2028-02-29", previousTo: "2028-01-29" });
  });

  it("on the 1st compares one day with one day", () => {
    expect(insightsWindow("2026-12", "2026-12-01")).toEqual({
      month: "2026-12",
      from: "2026-12-01",
      to: "2026-12-01",
      previousFrom: "2026-11-01",
      previousTo: "2026-11-01",
    });
  });

  it("counts a past month to its last day, against the whole month before it", () => {
    expect(insightsWindow("2026-10", "2026-11-16")).toEqual({
      month: "2026-10",
      from: "2026-10-01",
      to: "2026-10-31",
      previousFrom: "2026-09-01",
      previousTo: "2026-09-30",
    });
    expect(insightsWindow("2026-01", "2026-11-16")).toMatchObject({ previousFrom: "2025-12-01", previousTo: "2025-12-31" });
  });

  it("has no window for a month in the future", () => {
    expect(insightsWindow("2026-12", "2026-11-30")).toBeNull();
    expect(insightsWindow("2027-01", "2026-11-16")).toBeNull();
  });
});

describe("buildInsights", () => {
  const w = insightsWindow("2026-11", "2026-11-16")!;

  it("adds up the month and the same days before it, categories by the month's sum", () => {
    const dto = buildInsights(w, [
      { category: "cafe", period: "current", spent: 15_000, count: 3 },
      { category: "groceries", period: "current", spent: 52_000, count: 2 },
      { category: "groceries", period: "previous", spent: 40_000, count: 4 },
      { category: "transport", period: "previous", spent: 9_000, count: 1 },
    ]);
    expect(dto).toEqual({
      month: "2026-11",
      through: "2026-11-16",
      previous: { from: "2026-10-01", to: "2026-10-16" },
      spent: 67_000,
      previousSpent: 49_000,
      categories: [
        { category: "groceries", spent: 52_000, previousSpent: 40_000, count: 2 },
        { category: "cafe", spent: 15_000, previousSpent: 0, count: 3 },
        { category: "transport", spent: 0, previousSpent: 9_000, count: 0 },
      ],
    });
  });

  it("keeps refunds as the definition counts them: a negative sum that lowers the total", () => {
    const dto = buildInsights(w, [
      { category: "shopping", period: "current", spent: 30_000, count: 1 },
      { category: "refund", period: "current", spent: -12_000, count: 1 },
    ]);
    expect(dto.spent).toBe(18_000);
    expect(dto.categories.map((c) => c.category)).toEqual(["shopping", "refund"]);
    expect(dto.categories.reduce((s, c) => s + c.spent, 0)).toBe(dto.spent);
  });

  it("puts a row without a category under uncategorized", () => {
    const dto = buildInsights(w, [
      { category: null, period: "current", spent: 1_000, count: 1 },
      { category: "uncategorized", period: "current", spent: 2_000, count: 1 },
    ]);
    expect(dto.categories).toEqual([{ category: "uncategorized", spent: 3_000, previousSpent: 0, count: 2 }]);
  });

  it("is empty with no rows", () => {
    expect(buildInsights(w, [])).toMatchObject({ spent: 0, previousSpent: 0, categories: [] });
  });

  it("breaks ties by the month before, then by the key, so the order is stable", () => {
    const dto = buildInsights(w, [
      { category: "leisure", period: "current", spent: 5_000, count: 1 },
      { category: "health", period: "current", spent: 5_000, count: 1 },
      { category: "cafe", period: "current", spent: 5_000, count: 1 },
      { category: "cafe", period: "previous", spent: 1, count: 1 },
    ]);
    expect(dto.categories.map((c) => c.category)).toEqual(["cafe", "health", "leisure"]);
  });
});
