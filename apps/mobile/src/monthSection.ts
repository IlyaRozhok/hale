import type { InsightsMonthDto } from "@hale/contracts";
import { formatMoney, inMonth, monthTitle, pluralIndex, toMonth } from "./format";
import { categoryName, type CategoryList } from "./labels";

// Pure: what the month section of «Сегодня» shows and says (task ЧЛ7). No native imports.

/** How many categories are shares of their own; with more than `NAMED + 1` the rest are one share, «Остальное». */
const NAMED = 4;
/** The mark «above the month before» (the spec's author; both can be changed): more than a quarter above… */
const ABOVE_NUM = 5;
const ABOVE_DEN = 4;
/** …and by at least ₴500, in kopecks. */
const ABOVE_MIN = 50_000;

/** Whole phrases, so they can be translated as they are. The second of a pair is for a month before counted whole. */
const AVERAGE = "в среднем {sum} в день";
const PILL = "{pct}% к {month}";
const PILL_SAME = "как в {month}";
const TOTAL_MORE = ["На {pct}% больше, чем в {month} за те же дни", "На {pct}% больше, чем в {month}"] as const;
const TOTAL_LESS = ["На {pct}% меньше, чем в {month} за те же дни", "На {pct}% меньше, чем в {month}"] as const;
const TOTAL_SAME = ["Как в {month} за те же дни", "Как в {month}"] as const;
const MORE = ["{name} — {sum}, на {diff} больше, чем в {month} за те же дни", "{name} — {sum}, на {diff} больше, чем в {month}"] as const;
const LESS = ["{name} — {sum}, на {diff} меньше, чем в {month} за те же дни", "{name} — {sum}, на {diff} меньше, чем в {month}"] as const;
const SAME = ["{name} — {sum}, как в {month} за те же дни", "{name} — {sum}, как в {month}"] as const;
const NEW = ["{name} — {sum}, в {month} за те же дни таких трат не было", "{name} — {sum}, в {month} таких трат не было"] as const;
const REST_NAME = "Остальное";
/** One per plural form. */
const REST = ["Остальное — {sum} в {n} категории", "Остальное — {sum} в {n} категориях", "Остальное — {sum} в {n} категориях"] as const;
const LABEL = "{name}, {sum}, {pct}% трат";
const LABEL_ABOVE = "{name}, {sum}, {pct}% трат, заметно больше, чем в {month}";

const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

const monthNumber = (iso: string): number => Number(iso.slice(5, 7));
const dayNumber = (iso: string): number => Number(iso.slice(8, 10));
const lastDayOf = (iso: string): number => new Date(Date.UTC(Number(iso.slice(0, 4)), monthNumber(iso), 0)).getUTCDate();

export interface MonthShare {
  /** The category's key, or "rest" for «Остальное». */
  key: string;
  name: string;
  /** Kopecks, above zero. */
  amount: number;
  /** Whole percent of the bar, that is of the sum of the shares. */
  percent: number;
  /** Noticeably above the same days of the month before: the sand arrow. */
  above: boolean;
  /** The one phrase shown under the bar when the share is chosen. */
  phrase: string;
  /** What the share is called aloud. */
  label: string;
}

export interface MonthSection {
  /** «Ноябрь». */
  title: string;
  /** The month's spending as the server counts it (refunds taken off): the same figure «Итоги» show. Kopecks. */
  total: number;
  /** «в среднем ₴1,139 в день». */
  average: string;
  /** The month against the month before; null when nothing was spent then. */
  comparison: { direction: "up" | "down" | "same"; text: string; label: string } | null;
  /** Largest first; never empty. */
  shares: MonthShare[];
}

/**
 * The month section of «Сегодня» (task ЧЛ7), from `GET /insights/month` as it is.
 *
 * Null, and so no section: no answer yet or a failed one (`undefined`), an older server (`null`), a month with
 * nothing spent, and a month whose refunds took back all that was spent.
 *
 * The rule for the bar: a category whose sum is zero or below («Возвраты», or one where refunds outweighed the
 * purchases) is not a share and is not inside «Остальное». The shares, and each share's percent, are of the sum of
 * the categories above zero. The total over the bar stays the server's `spent`, refunds taken off, so the shares add
 * up to more than the total by exactly what was refunded. Nothing here changes how money is counted.
 *
 * With five categories or fewer every one is named; with more, the four largest and «Остальное».
 * The average is the total over the days counted so far (`through`), today included.
 */
export function monthSection(data: InsightsMonthDto | null | undefined, list: CategoryList): MonthSection | null {
  if (!data || data.spent <= 0) return null;
  // The sort is stable: equal sums keep the server's order.
  const spentOn = data.categories.filter((c) => c.spent > 0).sort((a, b) => b.spent - a.spent);
  if (spentOn.length === 0) return null;

  const before = monthNumber(data.previous.from);
  const whole = dayNumber(data.previous.to) === lastDayOf(data.previous.to) ? 1 : 0;
  const month = inMonth(before);
  const base = spentOn.reduce((sum, c) => sum + c.spent, 0);
  const percent = (amount: number) => Math.round((amount / base) * 100);

  const named = spentOn.length > NAMED + 1 ? spentOn.slice(0, NAMED) : spentOn;
  const rest = spentOn.slice(named.length);
  const shares: MonthShare[] = named.map((c) => {
    const name = categoryName(c.category, list);
    const sum = formatMoney(c.spent);
    // Refunds that outweighed the purchases the month before: nothing was spent then.
    const previous = Math.max(0, c.previousSpent);
    const above = c.spent * ABOVE_DEN > previous * ABOVE_NUM && c.spent - previous >= ABOVE_MIN;
    const pct = String(percent(c.spent));
    return {
      key: c.category,
      name,
      amount: c.spent,
      percent: percent(c.spent),
      above,
      phrase: fill(phraseOf(c.spent, previous)[whole], { name, sum, diff: formatMoney(Math.abs(c.spent - previous)), month }),
      label: fill(above ? LABEL_ABOVE : LABEL, { name, sum, pct, month }),
    };
  });
  if (rest.length > 0) {
    const amount = rest.reduce((sum, c) => sum + c.spent, 0);
    const sum = formatMoney(amount);
    shares.push({
      key: "rest",
      name: REST_NAME,
      amount,
      percent: percent(amount),
      above: false,
      phrase: fill(REST[pluralIndex(rest.length)], { sum, n: String(rest.length) }),
      label: fill(LABEL, { name: REST_NAME, sum, pct: String(percent(amount)) }),
    });
  }

  return {
    title: monthTitle(Number(data.month.slice(0, 4)), monthNumber(data.month)).replace(/ \d{4}$/, ""),
    total: data.spent,
    average: fill(AVERAGE, { sum: formatMoney(data.spent / dayNumber(data.through)) }),
    comparison: comparisonOf(data.spent, data.previousSpent, before, whole),
    shares,
  };
}

/** Which phrase a category gets; a difference that rounds to no hryvnia is «как в октябре». */
function phraseOf(spent: number, previous: number): readonly [string, string] {
  if (previous === 0) return NEW;
  const hryvnias = Math.round(Math.abs(spent - previous) / 100);
  if (hryvnias === 0) return SAME;
  return spent > previous ? MORE : LESS;
}

function comparisonOf(spent: number, previous: number, before: number, whole: 0 | 1): MonthSection["comparison"] {
  if (previous <= 0) return null;
  const pct = Math.round((Math.abs(spent - previous) / previous) * 100);
  const month = inMonth(before);
  if (pct === 0) return { direction: "same", text: fill(PILL_SAME, { month }), label: fill(TOTAL_SAME[whole], { month }) };
  const up = spent > previous;
  return {
    direction: up ? "up" : "down",
    text: fill(PILL, { pct: String(pct), month: toMonth(before) }),
    label: fill((up ? TOTAL_MORE : TOTAL_LESS)[whole], { pct: String(pct), month }),
  };
}
