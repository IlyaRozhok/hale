import { describe, expect, it } from "vitest";
import { lineSpan, nearestDay, runwayChart, runwayLabels, type LabelBox } from "./runwayChart";

const days = (balances: number[]) => balances.map((balance, i) => ({ date: `2026-11-${String(11 + i).padStart(2, "0")}`, balance }));

describe("runwayChart", () => {
  it("spreads the days across the width and the money between the top and the zero line", () => {
    const c = runwayChart(days([400, 300, 200, 100, 0]), [], 200, 120, 10);
    expect(c.xs).toEqual([0, 50, 100, 150, 200]);
    expect(c.zeroY).toBe(110);
    expect(c.line).toEqual([{ x: 0, y: 10 }, { x: 50, y: 35 }, { x: 100, y: 60 }, { x: 150, y: 85 }, { x: 200, y: 110 }]);
    expect(c.cross).toBeNull();
  });

  it("a payment is a step down on its day, then the slope goes on", () => {
    const c = runwayChart(days([400, 300, 100, 0]), [{ id: "1", date: "2026-11-12", name: "Аренда", amount: 100 }], 300, 100, 0);
    expect(c.line).toEqual([{ x: 0, y: 0 }, { x: 100, y: 25 }, { x: 100, y: 50 }, { x: 200, y: 75 }, { x: 300, y: 100 }]);
  });

  it("keeps the zero line inside when the money goes below it, and finds where it is crossed", () => {
    const c = runwayChart(days([100, 0, -100]), [], 200, 100, 0);
    expect(c.zeroY).toBe(50);
    expect(c.cross).toBe(100);
    // Between two days the crossing is where the line meets zero.
    expect(runwayChart(days([100, -100]), [], 200, 100, 0).cross).toBe(100);
    // A step can cross it too: straight down on the payment's day.
    expect(runwayChart(days([100, 50, -200]), [{ id: "1", date: "2026-11-12", name: "x", amount: 200 }], 200, 100, 0).cross).toBe(100);
    expect(runwayChart(days([-5, -10]), [], 200, 100, 0).cross).toBe(0);
  });

  it("draws a flat line when nothing changes, and nothing for a single day or no width", () => {
    expect(runwayChart(days([0, 0]), [], 100, 100, 10).line.map((p) => p.y)).toEqual([90, 90]);
    expect(runwayChart(days([500]), [], 100, 100, 10).line).toEqual([]);
    expect(runwayChart(days([500, 400]), [], 0, 100, 10).line).toEqual([]);
  });
});

describe("nearestDay", () => {
  it("is the day whose point is closest to the finger", () => {
    const xs = [0, 50, 100];
    expect(nearestDay(xs, -20)).toBe(0);
    expect(nearestDay(xs, 24)).toBe(0);
    expect(nearestDay(xs, 26)).toBe(1);
    expect(nearestDay(xs, 400)).toBe(2);
  });
});

describe("lineSpan", () => {
  const line = [{ x: 0, y: 0 }, { x: 100, y: 20 }, { x: 100, y: 60 }, { x: 200, y: 80 }];
  it("is the highest and the lowest the line gets between two places, steps included", () => {
    expect(lineSpan(line, 0, 50)).toEqual({ top: 0, bottom: 10 });
    expect(lineSpan(line, 50, 150)).toEqual({ top: 10, bottom: 70 });
    expect(lineSpan(line, 110, 150)).toEqual({ top: 62, bottom: 70 });
    // Past the ends it is cut to the line.
    expect(lineSpan(line, 150, 400)).toEqual({ top: 70, bottom: 80 });
  });
  it("is nothing where the line is not", () => {
    expect(lineSpan(line, 210, 300)).toBeNull();
    expect(lineSpan(line, -30, -1)).toBeNull();
    expect(lineSpan([], 0, 10)).toBeNull();
  });
});

describe("runwayLabels", () => {
  const W = 300;
  const H = 112;
  type Events = Parameters<typeof runwayChart>[1];
  const ev = (id: string, day: number, amount: number, name = "x"): Events[number] => ({ id, date: `2026-11-${String(day).padStart(2, "0")}`, name, amount });
  const place = (balances: number[], events: Events, over: { width?: number; labelWidth?: number; end?: boolean; taken?: LabelBox[] } = {}) => {
    const width = over.width ?? W;
    const points = days(balances);
    const chart = runwayChart(points, events, width, H, 10);
    const labels = runwayLabels({
      chart,
      points,
      events,
      width,
      height: H,
      paymentWidth: () => over.labelWidth ?? 90,
      paymentHeight: 14,
      end: over.end === false ? null : { width: 44, height: 16 },
      taken: over.taken,
    });
    return { chart, labels, width };
  };
  const overlap = (a: LabelBox, b: LabelBox) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
  /** Walks the line a fifth of a point at a time: is any of it inside the box? */
  const onLine = (box: LabelBox, line: { x: number; y: number }[]) => {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!;
      const b = line[i]!;
      const steps = Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 5);
      for (let s = 0; s <= steps; s++) {
        const x = a.x + ((b.x - a.x) * s) / Math.max(1, steps);
        const y = a.y + ((b.y - a.y) * s) / Math.max(1, steps);
        if (x > box.left && x < box.left + box.width && y > box.top && y < box.top + box.height) return true;
      }
    }
    return false;
  };
  /** What every placement has to keep: inside the chart, off the line, off each other and off what was there. */
  const sound = ({ chart, labels, width }: ReturnType<typeof place>, taken: LabelBox[] = []) => {
    const boxes = [...labels.payments.map((p) => p.box), ...(labels.end ? [labels.end] : [])];
    for (const b of boxes) {
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.left + b.width).toBeLessThanOrEqual(width);
      expect(b.top + b.height).toBeLessThanOrEqual(H);
      expect(onLine(b, chart.line)).toBe(false);
      for (const t of taken) expect(overlap(b, t)).toBe(false);
    }
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false)));
  };
  // Ten days from 30,000 down, a big payment on the 13th and a smaller one on the 18th.
  const usual = [30_000, 29_000, 28_000, 10_000, 9_000, 8_000, 7_000, 6_000, 2_000, 1_000];
  const usualEvents = [ev("net", 15, 300), ev("rent", 13, 17_000), ev("loan", 18, 3_000)];

  it("names no more than the two largest payments, the largest first", () => {
    const r = place(usual, usualEvents);
    expect(r.labels.payments.map((p) => p.id)).toEqual(["rent", "loan"]);
    sound(r);
  });

  it("of equal amounts the earlier day wins, then the server's order", () => {
    const flat = [9_000, 8_000, 7_000, 6_000, 5_000, 4_000, 3_000, 2_000, 1_000, 500];
    const r = place(flat, [ev("c", 16, 500), ev("b", 14, 500), ev("a", 14, 500)], { labelWidth: 40 });
    expect(r.labels.payments[0]!.id).toBe("b");
    expect(r.labels.payments.map((p) => p.id)).not.toContain("c");
    sound(r);
    const later = place(flat, [ev("c", 16, 500), ev("a", 14, 500)], { labelWidth: 40 });
    expect(later.labels.payments[0]!.id).toBe("a");
  });

  it("a label stands to the right of its step, where the line has already gone down", () => {
    const r = place(usual, usualEvents);
    const rent = r.labels.payments[0]!;
    expect(rent.side).toBe("right");
    expect(rent.box.left).toBeGreaterThan(r.chart.xs[2]!);
    expect(rent.box.width).toBe(90);
    expect(rent.box.height).toBe(14);
  });

  it("the reserve stands at the right edge, above the end of the line", () => {
    const r = place(usual, usualEvents);
    const end = r.labels.end!;
    expect(end.left + end.width).toBe(W);
    expect(end.top + end.height).toBeLessThan(r.chart.line.at(-1)!.y);
    sound(r);
  });

  it("no reserve label unless asked for", () => {
    expect(place(usual, usualEvents, { end: false }).labels.end).toBeNull();
  });

  it("a payment today keeps its label inside the left edge", () => {
    const r = place([30_000, 12_000, 11_000, 10_000, 9_000], [ev("rent", 11, 17_000)]);
    expect(r.labels.payments.map((p) => p.id)).toEqual(["rent"]);
    expect(r.labels.payments[0]!.side).toBe("right");
    sound(r);
  });

  it("a payment near the right edge turns its label to the left, clear of the reserve", () => {
    const r = place([30_000, 29_000, 28_000, 27_000, 26_000, 25_000, 24_000, 23_000, 22_000, 10_000], [ev("rent", 19, 11_000)]);
    expect(r.labels.end).not.toBeNull();
    expect(r.labels.payments.map((p) => [p.id, p.side])).toEqual([["rent", "left"]]);
    const box = r.labels.payments[0]!.box;
    expect(box.left + box.width).toBeLessThan(r.chart.xs[8]!);
    sound(r);
  });

  it("a payment on the last day does not sit on the reserve", () => {
    const r = place([30_000, 29_000, 28_000, 27_000, 20_000], [ev("rent", 15, 5_000)]);
    expect(r.labels.end).not.toBeNull();
    sound(r);
  });

  it("two payments on one day or on neighbouring days never cover each other", () => {
    for (const second of [13, 14]) {
      const r = place(usual, [ev("rent", 13, 17_000), ev("loan", second, 900)]);
      expect(r.labels.payments[0]!.id).toBe("rent");
      sound(r);
    }
  });

  it("when two labels cannot both fit, the smaller payment goes unnamed", () => {
    const r = place([30_000, 12_000, 11_000, 500], [ev("rent", 11, 17_000), ev("loan", 12, 900)], { width: 150, labelWidth: 120 });
    expect(r.labels.payments.map((p) => p.id)).toEqual(["rent"]);
    sound(r);
  });

  it("keeps clear of what is already written on the chart", () => {
    const first = place(usual, usualEvents);
    const taken = [first.labels.payments[0]!.box];
    const r = place(usual, usualEvents, { taken });
    expect(r.labels.payments.length).toBeGreaterThan(0);
    sound(r, taken);
  });

  it("a label wider than the chart is cut to it or left out, never outside", () => {
    sound(place(usual, usualEvents, { width: 80, labelWidth: 200 }));
  });

  it("a payment outside the days drawn has no label, and nothing is placed before the width is known", () => {
    expect(place(usual, [ev("late", 28, 900)]).labels.payments).toEqual([]);
    expect(place(usual, usualEvents, { width: 0 }).labels).toEqual({ payments: [], end: null });
  });
});
