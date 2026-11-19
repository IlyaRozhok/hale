import { describe, expect, it } from "vitest";
import {
  type ShownRow,
  type SpanSpendRow,
  findSpike,
  gateObservations,
  nextChargeDate,
  observationKey,
  shiftMonths,
  spikeSpans,
  upcomingSubscriptions,
} from "./observations";
import type { Subscription } from "./subscriptions";

const TODAY = "2026-11-19";
/** History that reaches back over every span looked at. */
const LONG = "2026-01-01";

/** One category's spend in a period: the current span first, then the three months before it. */
function rows(period: "month" | "week", category: string | null, [current, ...previous]: number[]): SpanSpendRow[] {
  return [current!, ...previous].map((spent, back) => ({ period, back, category, spent }));
}

describe("shiftMonths", () => {
  it("keeps the day number and clamps it to a shorter month", () => {
    expect(shiftMonths("2026-11-19", -1)).toBe("2026-10-19");
    expect(shiftMonths("2026-01-15", -2)).toBe("2025-11-15");
    expect(shiftMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(shiftMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftMonths("2026-12-05", 1)).toBe("2027-01-05");
  });
});

describe("spikeSpans", () => {
  it("counts the month from its 1st to today, the week as the 7 days to today, each against the same days of the 3 months before", () => {
    expect(spikeSpans(TODAY)).toEqual([
      {
        period: "month",
        current: { from: "2026-11-01", to: "2026-11-19" },
        previous: [
          { from: "2026-10-01", to: "2026-10-19" },
          { from: "2026-09-01", to: "2026-09-19" },
          { from: "2026-08-01", to: "2026-08-19" },
        ],
      },
      {
        period: "week",
        current: { from: "2026-11-13", to: "2026-11-19" },
        previous: [
          { from: "2026-10-13", to: "2026-10-19" },
          { from: "2026-09-13", to: "2026-09-19" },
          { from: "2026-08-13", to: "2026-08-19" },
        ],
      },
    ]);
  });

  it("clamps the days of a shorter month", () => {
    const [month, week] = spikeSpans("2026-05-31");
    expect(month!.previous).toEqual([
      { from: "2026-04-01", to: "2026-04-30" },
      { from: "2026-03-01", to: "2026-03-31" },
      { from: "2026-02-01", to: "2026-02-28" },
    ]);
    expect(week!.previous[2]).toEqual({ from: "2026-02-25", to: "2026-02-28" });
  });
});

describe("findSpike", () => {
  it("finds a category above the median of the same days of the three months before by 35% and ₴500", () => {
    const r = rows("month", "cafe", [482_000, 310_000, 290_000, 330_000]);
    expect(findSpike(TODAY, r, LONG, new Set())).toEqual({
      kind: "spike",
      period: "month",
      category: "cafe",
      spent: 482_000,
      usual: 310_000,
      amount: null,
      from: "2026-11-01",
      to: "2026-11-19",
    });
  });

  it("needs both thresholds: 35% above the median and ₴500 above it", () => {
    // 35% exactly is not above it.
    expect(findSpike(TODAY, rows("month", "cafe", [270_000, 200_000, 200_000, 200_000]), LONG, new Set())).toBeNull();
    expect(findSpike(TODAY, rows("month", "cafe", [270_001, 200_000, 200_000, 200_000]), LONG, new Set())).not.toBeNull();
    // Twice the usual, but only ₴499.99 more.
    expect(findSpike(TODAY, rows("week", "cafe", [99_999, 50_000, 50_000, 50_000]), LONG, new Set())).toBeNull();
    expect(findSpike(TODAY, rows("week", "cafe", [100_000, 50_000, 50_000, 50_000]), LONG, new Set())?.period).toBe("week");
  });

  it("uses the median, not the mean: one large month does not lift the usual", () => {
    const r = rows("month", "shopping", [300_000, 100_000, 1_000_000, 120_000]);
    expect(findSpike(TODAY, r, LONG, new Set())).toMatchObject({ category: "shopping", usual: 120_000 });
  });

  it("counts a month with no rows in the span as 0, and finds nothing when the median is 0", () => {
    // Two of three months had nothing: no usual to compare with.
    expect(findSpike(TODAY, [{ period: "month", back: 0, category: "leisure", spent: 400_000 }, { period: "month", back: 2, category: "leisure", spent: 10_000 }], LONG, new Set())).toBeNull();
    // One month had nothing: the median is the smaller of the other two.
    const r = [
      { period: "month" as const, back: 0, category: "leisure", spent: 400_000 },
      { period: "month" as const, back: 1, category: "leisure", spent: 200_000 },
      { period: "month" as const, back: 3, category: "leisure", spent: 300_000 },
    ];
    expect(findSpike(TODAY, r, LONG, new Set())).toMatchObject({ usual: 200_000, spent: 400_000 });
  });

  it("rounds the usual to whole hryvnias", () => {
    expect(findSpike(TODAY, rows("month", "cafe", [482_000, 310_049, 290_000, 330_000]), LONG, new Set())?.usual).toBe(310_000);
    expect(findSpike(TODAY, rows("month", "cafe", [482_000, 310_050, 290_000, 330_000]), LONG, new Set())?.usual).toBe(310_100);
  });

  it("sums several rows of one category and span (refunds lower the sum)", () => {
    const r = [...rows("month", "cafe", [482_000, 310_000, 290_000, 330_000]), { period: "month" as const, back: 0, category: "cafe", spent: -100_000 }];
    expect(findSpike(TODAY, r, LONG, new Set())).toBeNull();
  });

  it("never finds a spike in «Без категории» or «Возвраты»", () => {
    const big = [900_000, 100_000, 100_000, 100_000];
    expect(findSpike(TODAY, [...rows("month", null, big), ...rows("month", "uncategorized", big), ...rows("month", "refund", big)], LONG, new Set())).toBeNull();
  });

  it("finds nothing until the history reaches back over all three months of the span", () => {
    const r = rows("month", "cafe", [482_000, 310_000, 290_000, 330_000]);
    expect(findSpike(TODAY, r, "2026-08-02", new Set())).toBeNull();
    expect(findSpike(TODAY, r, null, new Set())).toBeNull();
    expect(findSpike(TODAY, r, "2026-08-01", new Set())).not.toBeNull();
    // The week's oldest span starts on 13 August: a history from the 10th is enough for it.
    expect(findSpike(TODAY, rows("week", "cafe", [200_000, 50_000, 50_000, 50_000]), "2026-08-10", new Set())?.period).toBe("week");
  });

  it("picks the largest excess over the usual; on a tie the month before the week", () => {
    const r = [
      ...rows("month", "cafe", [482_000, 310_000, 290_000, 330_000]), // +172,000
      ...rows("week", "groceries", [214_000, 40_000, 40_000, 40_000]), // +174,000
    ];
    expect(findSpike(TODAY, r, LONG, new Set())).toMatchObject({ period: "week", category: "groceries", spent: 214_000, usual: 40_000, from: "2026-11-13", to: "2026-11-19" });
    const tie = [...rows("month", "cafe", [210_000, 40_000, 40_000, 40_000]), ...rows("week", "groceries", [210_000, 40_000, 40_000, 40_000])];
    expect(findSpike(TODAY, tie, LONG, new Set())).toMatchObject({ period: "month", category: "cafe" });
  });

  it("leaves out the categories it is told to (dismissed or shown lately), in both periods", () => {
    const r = [...rows("month", "cafe", [482_000, 310_000, 290_000, 330_000]), ...rows("week", "cafe", [300_000, 50_000, 50_000, 50_000]), ...rows("week", "groceries", [214_000, 140_000, 140_000, 140_000])];
    expect(findSpike(TODAY, r, LONG, new Set([observationKey("spike", "cafe")]))).toMatchObject({ period: "week", category: "groceries" });
    expect(findSpike(TODAY, r, LONG, new Set([observationKey("spike", "cafe"), observationKey("spike", "groceries")]))).toBeNull();
    expect(findSpike(TODAY, r, LONG, new Set([observationKey("subscriptions", null)]))?.category).toBe("cafe");
  });
});

describe("nextChargeDate", () => {
  it("is the same day a month after the last charge, clamped to a shorter month", () => {
    expect(nextChargeDate("2026-10-25")).toBe("2026-11-25");
    expect(nextChargeDate("2026-01-31")).toBe("2026-02-28");
  });
});

describe("upcomingSubscriptions", () => {
  const sub = (key: string, amount: number, lastDate: string, missed = 0): Subscription => ({ key, name: key, amount, lastDate, raisedBy: 0, missed });

  it("sums the active subscriptions due in the next 7 days and before the income", () => {
    const subs = [
      sub("netflix", 24_900, "2026-10-20"), // the 20th: in
      sub("spotify", 14_900, "2026-10-25"), // the 25th: in, the last day of the week
      sub("icloud", 12_100, "2026-10-26"), // the 26th: after the week
      sub("chatgpt", 84_000, "2026-11-05"), // charged this month already
      sub("old", 30_000, "2026-08-21", 2), // not charged for a while
    ];
    expect(upcomingSubscriptions(subs, TODAY, null)).toEqual({
      kind: "subscriptions",
      period: null,
      category: null,
      spent: null,
      usual: null,
      amount: 24_900 + 14_900,
      from: "2026-11-19",
      to: "2026-11-25",
    });
  });

  it("counts only what is due before the income day", () => {
    const subs = [sub("netflix", 24_900, "2026-10-20"), sub("spotify", 14_900, "2026-10-23")];
    expect(upcomingSubscriptions(subs, TODAY, "2026-11-23")).toMatchObject({ amount: 24_900, from: "2026-11-19", to: "2026-11-22" });
    expect(upcomingSubscriptions(subs, TODAY, "2026-11-20")).toBeNull();
    expect(upcomingSubscriptions(subs, TODAY, TODAY)).toBeNull();
  });

  it("counts one that is a little late (due before today, still active) as due today", () => {
    expect(upcomingSubscriptions([sub("netflix", 24_900, "2026-10-15")], TODAY, null)).toMatchObject({ amount: 24_900 });
  });

  it("is null when nothing is due", () => {
    expect(upcomingSubscriptions([], TODAY, null)).toBeNull();
    expect(upcomingSubscriptions([sub("chatgpt", 84_000, "2026-11-05")], TODAY, null)).toBeNull();
  });
});

describe("gateObservations", () => {
  const cafe = { kind: "spike" as const, period: "month" as const, category: "cafe", spent: 482_000, usual: 310_000, amount: null, from: "2026-11-01", to: TODAY };
  const shown = (date: string, kind: "spike" | "subscriptions" = "spike", category: string | null = "x"): ShownRow => ({
    date,
    kind,
    category,
    observation: { ...cafe, category },
  });

  it("keeps today's shown observation for the rest of the day", () => {
    expect(gateObservations(TODAY, [shown("2026-11-17"), { date: TODAY, kind: "spike", category: "cafe", observation: cafe }], [])).toEqual({ fixed: cafe });
  });

  it("drops today's shown observation once its kind is dismissed", () => {
    expect(gateObservations(TODAY, [{ date: TODAY, kind: "spike", category: "cafe", observation: cafe }], [{ kind: "spike", category: "cafe" }])).toEqual({ fixed: null });
  });

  it("offers nothing after three in the last seven days before today", () => {
    const three = [shown("2026-11-13", "spike", "a"), shown("2026-11-15", "spike", "b"), shown("2026-11-18", "subscriptions", null)];
    expect(gateObservations(TODAY, three, [])).toEqual({ fixed: null });
    // The one of the 12th has left the window.
    const old = [shown("2026-11-12", "spike", "a"), shown("2026-11-15", "spike", "b"), shown("2026-11-18", "subscriptions", null)];
    expect(gateObservations(TODAY, old, [])).toEqual({ excluded: new Set([observationKey("spike", "b"), observationKey("subscriptions", null)]) });
  });

  it("leaves out what was shown in the last seven days and what was dismissed", () => {
    expect(gateObservations(TODAY, [shown("2026-11-13", "spike", "cafe")], [{ kind: "spike", category: "groceries" }, { kind: "subscriptions", category: null }])).toEqual({
      excluded: new Set([observationKey("spike", "cafe"), observationKey("spike", "groceries"), observationKey("subscriptions", null)]),
    });
  });
});
