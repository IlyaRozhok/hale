import type { RunwayDto } from "@hale/contracts";

export interface RunwayChart {
  /** Where each day stands across the width. */
  xs: number[];
  /** The money at the start of each day, as a height. */
  ys: number[];
  /** The line through the days, with a straight step down where a payment leaves. */
  line: { x: number; y: number }[];
  zeroY: number;
  /** Where the line first goes below zero; null when it never does. */
  cross: number | null;
}

/**
 * The runway as points on a canvas: days spread evenly, zero always inside the picture. Nothing to
 * draw for a single day or before the width is known.
 */
export function runwayChart(points: RunwayDto["points"], events: RunwayDto["events"], width: number, height: number, pad: number): RunwayChart {
  const balances = points.map((p) => p.balance);
  const bottom = Math.min(0, ...balances);
  const top = Math.max(0, ...balances) > bottom ? Math.max(0, ...balances) : bottom + 1;
  const y = (balance: number) => pad + ((top - balance) / (top - bottom)) * (height - pad * 2);
  const zeroY = y(0);
  if (points.length < 2 || width <= 0) return { xs: [], ys: [], line: [], zeroY, cross: null };

  const xs = points.map((_, i) => (i / (points.length - 1)) * width);
  const money: { x: number; balance: number }[] = [];
  points.forEach((p, i) => {
    money.push({ x: xs[i]!, balance: p.balance });
    const paid = events.reduce((s, e) => s + (e.date === p.date ? e.amount : 0), 0);
    if (paid > 0 && i < points.length - 1) money.push({ x: xs[i]!, balance: p.balance - paid });
  });

  let cross: number | null = money[0]!.balance < 0 ? money[0]!.x : null;
  for (let i = 1; cross === null && i < money.length; i++) {
    const a = money[i - 1]!;
    const b = money[i]!;
    if (b.balance < 0) cross = a.x + (a.balance / (a.balance - b.balance)) * (b.x - a.x);
  }
  return { xs, ys: balances.map(y), line: money.map((m) => ({ x: m.x, y: y(m.balance) })), zeroY, cross };
}

/** The day whose point is closest to a touch at `x`. */
export function nearestDay(xs: readonly number[], x: number): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i]! - x) < Math.abs(xs[best]! - x)) best = i;
  return best;
}

/** A label's place on the chart, in the chart's own points: `left` 0 is the first day, `top` 0 the chart's top. */
export interface LabelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RunwayLabels {
  /**
   * The payments named on the chart, the largest first; no more than two. `side` is where the label stands from its
   * point: one on the left ends at the point, so it is drawn from its right edge.
   */
  payments: { id: string; side: "left" | "right"; box: LabelBox }[];
  /** What is left by the income, at the right edge by the end of the line; null when not asked for or no room. */
  end: LabelBox | null;
}

/** The highest and the lowest the line gets between `x0` and `x1` (y grows downwards); null where there is no line. */
export function lineSpan(line: readonly { x: number; y: number }[], x0: number, x1: number): { top: number; bottom: number } | null {
  if (line.length < 2) return null;
  const from = Math.max(x0, line[0]!.x);
  const to = Math.min(x1, line[line.length - 1]!.x);
  if (from > to) return null;
  let top = Infinity;
  let bottom = -Infinity;
  const see = (y: number) => {
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    if (b.x < from || a.x > to) continue;
    if (a.x === b.x) {
      see(a.y);
      see(b.y);
      continue;
    }
    const at = (x: number) => a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    see(at(Math.max(a.x, from)));
    see(at(Math.min(b.x, to)));
  }
  return top === Infinity ? null : { top, bottom };
}

/** Air between a label and the line or the point it names. */
const LABEL_GAP = 6;
/** How far past its own ends a label looks at the line, so a slope does not touch its corner. */
const LABEL_REACH = 2;

const boxesMeet = (a: LabelBox, b: LabelBox) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/**
 * Where the chart's labels stand (task ЧЛ5): the reserve at the end of the line and the two largest payments by
 * their points. A label is always inside the chart, off the line, off the other labels and off whatever `taken`
 * says is already written there (the «ноль» label). One that finds no such place is left out: the reserve is placed
 * first, then the larger payment, so it is the smaller payment that goes unnamed.
 *
 * Of equal amounts the earlier day is named, then the server's order. A payment's label tries, in turn: right of
 * its step above the line (where the line has just gone down), left of it under the line, right under the line,
 * left above it. The caller gives the sizes of the texts; a width is cut to the chart's.
 */
export function runwayLabels({
  chart,
  points,
  events,
  width,
  height,
  paymentWidth,
  paymentHeight,
  end,
  taken = [],
}: {
  chart: RunwayChart;
  points: RunwayDto["points"];
  events: RunwayDto["events"];
  width: number;
  height: number;
  paymentWidth: (event: RunwayDto["events"][number]) => number;
  paymentHeight: number;
  end: { width: number; height: number } | null;
  taken?: readonly LabelBox[];
}): RunwayLabels {
  const { xs, line, zeroY } = chart;
  if (line.length < 2 || width <= 0) return { payments: [], end: null };
  const placed: LabelBox[] = [...taken];
  const fits = (b: LabelBox) => b.left >= 0 && b.top >= 0 && b.left + b.width <= width && b.top + b.height <= height && !placed.some((p) => boxesMeet(p, b));
  /** A box over the line between its ends, or under it; null when the line leaves it no room there. */
  const beside = (left: number, w: number, h: number, where: "above" | "under", prefer?: number): LabelBox | null => {
    const span = lineSpan(line, left - LABEL_REACH, left + w + LABEL_REACH);
    if (!span) return null;
    if (where === "above") {
      const top = Math.min(prefer ?? Infinity, span.top - LABEL_GAP - h);
      const box = { left, top, width: w, height: h };
      return fits(box) ? box : null;
    }
    const top = Math.max(prefer ?? -Infinity, span.bottom + LABEL_GAP);
    // Under a line that is above zero the label stays above the zero line too.
    const floor = span.bottom < zeroY ? zeroY - LABEL_REACH : height;
    const box = { left, top, width: w, height: h };
    return top + h <= floor && fits(box) ? box : null;
  };

  let endBox: LabelBox | null = null;
  if (end) {
    const w = Math.min(end.width, width);
    endBox = beside(width - w, w, end.height, "above") ?? beside(width - w, w, end.height, "under");
    if (endBox) placed.push(endBox);
  }

  const largest = events
    .map((event, order) => ({ event, order, day: points.findIndex((p) => p.date === event.date) }))
    .filter((r) => r.day >= 0)
    .sort((a, b) => b.event.amount - a.event.amount || (a.event.date < b.event.date ? -1 : a.event.date > b.event.date ? 1 : 0) || a.order - b.order)
    .slice(0, 2);
  const payments: RunwayLabels["payments"] = [];
  for (const { event, day } of largest) {
    const x = xs[day]!;
    // A step is two points on one day; on the last day there is no step and both ends are the same point.
    const here = line.filter((p) => p.x === x);
    if (here.length === 0) continue;
    const middle = (here[0]!.y + here[here.length - 1]!.y) / 2;
    const w = Math.min(paymentWidth(event), width);
    const h = paymentHeight;
    // The gap is wider than the reach, so a label beside the step never looks at the step itself.
    const right = x + LABEL_GAP;
    const left = x - LABEL_GAP - w;
    const found: { side: "left" | "right"; box: LabelBox | null }[] = [
      { side: "right", box: beside(right, w, h, "above", middle - h / 2) },
      { side: "left", box: beside(left, w, h, "under", middle - h / 2) },
      { side: "right", box: beside(right, w, h, "under") },
      { side: "left", box: beside(left, w, h, "above") },
    ];
    const place = found.find((f) => f.box !== null);
    if (!place?.box) continue;
    placed.push(place.box);
    payments.push({ id: event.id, side: place.side, box: place.box });
  }
  return { payments, end: endBox };
}

/** A text's width by its length, for placing it before it is drawn: never more than `max`. */
export const textWidth = (text: string, perChar: number, max: number): number => Math.min(max, Math.ceil(text.length * perChar));
