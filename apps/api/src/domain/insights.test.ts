import { describe, expect, it } from "vitest";
import { PLACES_TOP, type PlaceRow, buildInsights, buildOtherPayments, buildPlaces, insightsWindow, placesLookbackFrom, previousMonth } from "./insights";

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

describe("placesLookbackFrom (В3)", () => {
  it("starts three whole months before the month, across the year", () => {
    expect(placesLookbackFrom("2026-11")).toBe("2026-08-01");
    expect(placesLookbackFrom("2027-02")).toBe("2026-11-01");
  });
});

describe("buildPlaces (В3)", () => {
  const row = (key: string, spent: number, visits: number, seenBefore = true, name = key): PlaceRow => ({ key, name, spent, visits, seenBefore });

  it("takes the five largest places by the month's sum, with their visits", () => {
    const rows = [row("a", 1_000, 1), row("b", 9_000, 3), row("c", 5_000, 14), row("d", 3_000, 2), row("e", 7_000, 1), row("f", 2_000, 5)];
    expect(buildPlaces(rows, "2026-01-01", "2026-11").map((p) => [p.key, p.spent, p.visits])).toEqual([
      ["b", 9_000, 3],
      ["e", 7_000, 1],
      ["c", 5_000, 14],
      ["d", 3_000, 2],
      ["f", 2_000, 5],
    ]);
    expect(PLACES_TOP).toBe(5);
  });

  it("breaks a tie by visits, then by name", () => {
    const rows = [row("z", 1_000, 1, true, "Б"), row("y", 1_000, 1, true, "А"), row("x", 1_000, 4, true, "В")];
    expect(buildPlaces(rows, "2026-01-01", "2026-11").map((p) => p.name)).toEqual(["В", "А", "Б"]);
  });

  it("leaves out a place a refund took back in full, a refund with no purchase at that place, and a nameless one", () => {
    const rows = [row("a", 0, 1), row("b", -2_000, 0), row("c", 500, 1), row("d", 9_000, 1, true, " ")];
    expect(buildPlaces(rows, "2026-01-01", "2026-11").map((p) => p.key)).toEqual(["c"]);
  });

  it("marks a place new when it was not visited in the three months before and the history reaches back that far", () => {
    const rows = [row("old", 2_000, 1, true), row("new", 1_000, 1, false)];
    const marks = (historyFrom: string | null) => buildPlaces(rows, historyFrom, "2026-11").map((p) => [p.key, p.isNew]);
    expect(marks("2026-08-01")).toEqual([["old", false], ["new", true]]);
    expect(marks("2025-01-01")).toEqual([["old", false], ["new", true]]);
    // A shorter history cannot say what is new: nothing is.
    expect(marks("2026-08-02")).toEqual([["old", false], ["new", false]]);
    expect(marks(null)).toEqual([["old", false], ["new", false]]);
  });

  it("answers the place as it is named, its key and the sum in kopecks", () => {
    expect(buildPlaces([row("k1", 224_000, 14, false, "Aroma Kava")], "2026-01-01", "2026-11")).toEqual([
      { key: "k1", name: "Aroma Kava", spent: 224_000, visits: 14, isNew: true },
    ]);
    expect(buildPlaces([], "2026-01-01", "2026-11")).toEqual([]);
  });
});

describe("buildOtherPayments (В2а)", () => {
  it("adds up the payments outside the limit for each stretch", () => {
    expect(
      buildOtherPayments([
        { period: "current", spent: 1_870_500 },
        { period: "previous", spent: 795_000 },
        { period: "current", spent: 730_100 },
      ]),
    ).toEqual({ otherPayments: 2_600_600, previousOtherPayments: 795_000 });
  });

  it("is zero for a stretch with none, and never below zero when money came back on such a row", () => {
    expect(buildOtherPayments([])).toEqual({ otherPayments: 0, previousOtherPayments: 0 });
    expect(buildOtherPayments([{ period: "current", spent: -5_000 }, { period: "previous", spent: 3_000 }])).toEqual({
      otherPayments: 0,
      previousOtherPayments: 3_000,
    });
  });
});
