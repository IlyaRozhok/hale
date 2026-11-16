// «Итоги» (task В1): a month's spending by category against the same days of the month before.
// Pure: the stretches of dates and the answer built from rows the service has already summed in the database.
// What counts as spending is not decided here: the rows come from the limit's one definition (domain/ledger.ts),
// so the categories of a stretch add up to exactly what «Сегодня» calls spent over the same days.
import type { Minor } from "./money";

/** A month ('YYYY-MM') counted from its 1st to `to`, and the stretch of the month before it is compared with. */
export interface InsightsWindow {
  month: string;
  from: string;
  /** Today for the current month, the last day for a past one. */
  to: string;
  previousFrom: string;
  /** The same day number in the month before, or its last day when that month is shorter. */
  previousTo: string;
}

/** What the limit took in one category over one of the two stretches. */
export interface InsightsRow {
  /** Null is filed under 'uncategorized', as the «Траты» filter files it. */
  category: string | null;
  period: "current" | "previous";
  /** Kopecks, signed like limitSpend: refunds are negative. */
  spent: Minor;
  count: number;
}

export interface InsightsCategory {
  category: string;
  spent: Minor;
  previousSpent: Minor;
  /** Operations in the month's stretch. */
  count: number;
}

export interface Insights {
  month: string;
  through: string;
  previous: { from: string; to: string };
  spent: Minor;
  previousSpent: Minor;
  categories: InsightsCategory[];
}

const UNCATEGORIZED = "uncategorized";

const pad = (n: number): string => String(n).padStart(2, "0");

function daysIn(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

/** The stretches for `month` as of the Kyiv day `today`; null for a month that has not started. */
export function insightsWindow(month: string, today: string): InsightsWindow | null {
  const current = today.slice(0, 7);
  if (month > current) return null;
  const lastDay = month === current ? Number(today.slice(8, 10)) : daysIn(month);
  const prev = previousMonth(month);
  return {
    month,
    from: `${month}-01`,
    to: `${month}-${pad(lastDay)}`,
    previousFrom: `${prev}-01`,
    previousTo: `${prev}-${pad(Math.min(lastDay, daysIn(prev)))}`,
  };
}

/** The answer: totals are the sums of the categories, categories go by the month's sum, largest first. */
export function buildInsights(w: InsightsWindow, rows: readonly InsightsRow[]): Insights {
  const byCategory = new Map<string, InsightsCategory>();
  for (const r of rows) {
    const key = r.category ?? UNCATEGORIZED;
    const c = byCategory.get(key) ?? { category: key, spent: 0, previousSpent: 0, count: 0 };
    if (r.period === "current") {
      c.spent += r.spent;
      c.count += r.count;
    } else {
      c.previousSpent += r.spent;
    }
    byCategory.set(key, c);
  }
  const categories = [...byCategory.values()].sort(
    (a, b) => b.spent - a.spent || b.previousSpent - a.previousSpent || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0),
  );
  return {
    month: w.month,
    through: w.to,
    previous: { from: w.previousFrom, to: w.previousTo },
    spent: categories.reduce((s, c) => s + c.spent, 0),
    previousSpent: categories.reduce((s, c) => s + c.previousSpent, 0),
    categories,
  };
}
