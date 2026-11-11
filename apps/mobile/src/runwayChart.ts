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
