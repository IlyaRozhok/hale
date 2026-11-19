// Observations in the phrase of the day (task В7, audit §8; the owner chose variant А on 19 November 2026): numbers
// the server notices without a model. Pure: the service sums the spending in the database with the limit's one
// definition (IN_LIMIT, as «Итоги» do) and finds the subscriptions as «Итоги» do (domain/subscriptions.ts); this
// decides which observation, if any, today has. Nothing here changes money: observations only read what is recorded.
//
// - A spike: one category's spending over a span is above the median of the same days of the three months before
//   by more than SPIKE_PERCENT and by SPIKE_MIN or more. Two spans: the month from its 1st to today (the text says
//   «с начала ноября … к этому дню»; today counts, as in «Итоги») and the 7 days up to today.
// - In the shortage mode no spike: only the subscriptions due within the week and before the income, if any.
// - At most one a day and three in seven days; the same one not again within seven days; a dismissed one never.
import { type Minor, addDays } from "./money";
import { UNCATEGORIZED } from "./insights";
import type { Subscription } from "./subscriptions";

/** Above the usual by more than 35% (audit: 30–40%) … */
export const SPIKE_PERCENT = 135;
/** … and by ₴500 or more, so small sums make no noise. */
export const SPIKE_MIN: Minor = 50_000;
/** The usual is the median of the same span in this many months before. */
export const SPIKE_MONTHS = 3;
/** The week's span: today and the six days before it. */
export const WEEK_DAYS = 7;
/** At most this many observations shown in WINDOW_DAYS (today included). */
export const MAX_SHOWN = 3;
/** The rolling window for MAX_SHOWN, and how long the same observation is not offered again after it was shown. */
export const WINDOW_DAYS = 7;
/** The subscriptions note looks this many days ahead, today included. */
export const SUBSCRIPTIONS_AHEAD_DAYS = 7;
/** Never a spike: «Возвраты» are money back, «Без категории» names nothing the person could look at. */
const NO_SPIKE = new Set(["refund", UNCATEGORIZED]);

export type ObservationKind = "spike" | "subscriptions";
export type ObservationPeriod = "month" | "week";

export interface Span {
  from: string;
  to: string;
}

export interface SpikeSpans {
  period: ObservationPeriod;
  current: Span;
  /** The same days one, two and three months before, in that order. */
  previous: Span[];
}

/** One category's spending in one span, summed in the database: `back` 0 is the current span, 1–3 the months before. */
export interface SpanSpendRow {
  period: ObservationPeriod;
  back: number;
  /** Null is «Без категории». */
  category: string | null;
  /** Kopecks, signed like limitSpend: refunds are negative. */
  spent: Minor;
}

/** What the app gets; it builds the text itself. `from`/`to` are the span «Операции» opens with. */
export interface Observation {
  kind: ObservationKind;
  period: ObservationPeriod | null;
  category: string | null;
  /** A spike: the span's spending and its usual (the median, whole hryvnias). Null for subscriptions. */
  spent: Minor | null;
  usual: Minor | null;
  /** Subscriptions: what they will charge. Null for a spike. */
  amount: Minor | null;
  from: string;
  to: string;
}

/** An observation the app showed on `date`, as it was shown. */
export interface ShownRow {
  date: string;
  kind: ObservationKind;
  category: string | null;
  observation: Observation;
}

/** «Не показывать такое»: a spike of one category, or the subscriptions kind (category null). */
export interface DismissedRow {
  kind: ObservationKind;
  category: string | null;
}

/** What one observation is, for repeats and dismissals: its kind and its category. */
export function observationKey(kind: ObservationKind, category: string | null): string {
  return `${kind}:${category ?? ""}`;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** The same day number `months` months away, or that month's last day when it is shorter. */
export function shiftMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(d, last))}`;
}

/** The month's and the week's spans as of the Kyiv day `today`, each with the same days of the months before. */
export function spikeSpans(today: string): SpikeSpans[] {
  const make = (period: ObservationPeriod, from: string): SpikeSpans => ({
    period,
    current: { from, to: today },
    previous: Array.from({ length: SPIKE_MONTHS }, (_, i) => ({ from: shiftMonths(from, -(i + 1)), to: shiftMonths(today, -(i + 1)) })),
  });
  return [make("month", `${today.slice(0, 7)}-01`), make("week", addDays(today, -(WEEK_DAYS - 1)))];
}

function median(values: Minor[]): Minor {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Today's spike, or null. A span is judged only when the history (the first day any operation is stored,
 * `historyFrom`, as for new places) reaches back over its oldest month: with a shorter one the usual would be made
 * of days that were never loaded. A month with no rows in the span counts as 0; a median of 0 is no usual to compare
 * with, so a category new to the person is not a spike. Of several, the largest excess over the usual; on a tie
 * the month before the week, then the category's key. `excluded` holds observationKey()s left out.
 */
export function findSpike(today: string, rows: readonly SpanSpendRow[], historyFrom: string | null, excluded: ReadonlySet<string>): Observation | null {
  if (historyFrom === null) return null;
  const sums = new Map<string, Minor[]>();
  for (const r of rows) {
    const category = r.category ?? UNCATEGORIZED;
    if (NO_SPIKE.has(category) || r.back < 0 || r.back > SPIKE_MONTHS) continue;
    const key = `${r.period}\n${category}`;
    const s = sums.get(key) ?? Array<Minor>(SPIKE_MONTHS + 1).fill(0);
    s[r.back]! += r.spent;
    sums.set(key, s);
  }
  let best: { o: Observation; excess: Minor } | null = null;
  for (const spans of spikeSpans(today)) {
    if (historyFrom > spans.previous[SPIKE_MONTHS - 1]!.from) continue;
    for (const [key, [spent, ...before]] of sums) {
      const [period, category] = key.split("\n") as [ObservationPeriod, string];
      if (period !== spans.period || excluded.has(observationKey("spike", category))) continue;
      const usual = median(before);
      if (usual <= 0 || spent! * 100 <= usual * SPIKE_PERCENT || spent! - usual < SPIKE_MIN) continue;
      const excess = spent! - usual;
      const o: Observation = {
        kind: "spike",
        period,
        category,
        spent: spent!,
        usual: Math.round(usual / 100) * 100,
        amount: null,
        from: spans.current.from,
        to: spans.current.to,
      };
      // The month's spans come first, so a later tie keeps the month; within a period, the smaller key.
      if (!best || excess > best.excess || (excess === best.excess && o.period === best.o.period && category < best.o.category!)) best = { o, excess };
    }
  }
  return best?.o ?? null;
}

/**
 * When a subscription is expected next: the same day a month after its last charge (clamped to a shorter month).
 * Every subscription findSubscriptions finds is monthly, so its usual step is a month.
 */
export function nextChargeDate(lastDate: string): string {
  return shiftMonths(lastDate, 1);
}

/**
 * The shortage mode's one observation: what the active subscriptions (missed 0) will charge from today through the
 * SUBSCRIPTIONS_AHEAD_DAYS, and before the expected income (`incomeOn`, null when no date is known: then the week
 * alone). One already a little late (due before today, still active) is counted as due today. Null when nothing is.
 */
export function upcomingSubscriptions(subscriptions: readonly Subscription[], today: string, incomeOn: string | null): Observation | null {
  const weekEnd = addDays(today, SUBSCRIPTIONS_AHEAD_DAYS - 1);
  const to = incomeOn !== null && addDays(incomeOn, -1) < weekEnd ? addDays(incomeOn, -1) : weekEnd;
  if (to < today) return null;
  const amount = subscriptions.filter((s) => s.missed === 0 && nextChargeDate(s.lastDate) <= to).reduce((sum, s) => sum + s.amount, 0);
  if (amount <= 0) return null;
  return { kind: "subscriptions", period: null, category: null, spent: null, usual: null, amount, from: today, to };
}

/**
 * The caps and the memory. `fixed`: today's answer is settled — the one already shown today (unless dismissed since),
 * or null after MAX_SHOWN in the WINDOW_DAYS before today. Otherwise `excluded`: the observationKey()s shown in that
 * window and the dismissed ones, which a new observation must not be.
 */
export function gateObservations(
  today: string,
  shown: readonly ShownRow[],
  dismissed: readonly DismissedRow[],
): { fixed: Observation | null } | { excluded: Set<string> } {
  const gone = new Set(dismissed.map((d) => observationKey(d.kind, d.category)));
  const own = shown.find((s) => s.date === today);
  if (own) return { fixed: gone.has(observationKey(own.kind, own.category)) ? null : own.observation };
  const windowFrom = addDays(today, -(WINDOW_DAYS - 1));
  const recent = shown.filter((s) => s.date >= windowFrom && s.date < today);
  if (recent.length >= MAX_SHOWN) return { fixed: null };
  return { excluded: new Set([...recent.map((s) => observationKey(s.kind, s.category)), ...gone]) };
}
