// Subscriptions in «Итоги» (task В4, audit §8): found without a model, from the card purchases the limit counts.
// A subscription is one place (the counterparty key of «Операции», as for places) charging about the same sum about
// once a month. Pure: the service hands over the purchases, this decides which of them are subscriptions.
import { type Minor, addDays, daysBetween } from "./money";

/** Months looked at, the one asked included: three charges and two missed ones fit, a long-cancelled one drops out. */
export const SUBSCRIPTION_MONTHS = 6;
/** Charges a subscription needs: two a month apart are too often a shop visited twice. */
export const MIN_CHARGES = 3;
/** Days between two charges of a monthly subscription: 28 to 31 calendar days, and a bank a few days late. */
export const STEP_MIN = 25;
export const STEP_MAX = 35;
/** One month skipped inside a subscription's history (a declined card, a paused month): about two steps, once. */
export const SKIP_MIN = 50;
export const SKIP_MAX = 70;
/** The same sum, give or take: a charge in dollars drifts with the rate. Whichever is larger. */
const DRIFT_PERCENT = 15;
const DRIFT_MIN: Minor = 500;
/**
 * A price rise beyond the drift is still the same subscription up to this many percent, once in its history, and
 * only after a steady price of MIN_CHARGES charges: visits to a café at ₴120, ₴125, ₴190 are not a price rise.
 */
const RISE_PERCENT = 60;
/**
 * A place is a shop, not a subscription, when within a chain's span it charged more sums like the chain's than this
 * many a month (two subscriptions at one place at one price fit, a weekly purchase does not), or more other
 * purchases than one a month.
 */
const SIMILAR_PER_MONTH = 2;

/** One card purchase from the limit at a place, money out. */
export interface ChargeRow {
  /** counterKeySql of the row. */
  key: string;
  /** As «Операции» names the place's latest row. */
  name: string;
  /** The Kyiv day. */
  date: string;
  /** Kopecks, positive. */
  amount: Minor;
}

export interface Subscription {
  key: string;
  name: string;
  /** The latest charge, kopecks: what it costs a month now. */
  amount: Minor;
  lastDate: string;
  /** How much the latest charge is above the one before, beyond the drift; 0 when it is not. */
  raisedBy: Minor;
  /** Charges that were due and did not come: one counts once half a step has passed after it was due. */
  missed: number;
}

export interface Subscriptions {
  /** What the ones still charged (missed 0) cost a month, kopecks. */
  monthly: Minor;
  /** The ones still charged first, the largest first; then the ones not charged for a while, the latest first. */
  items: Subscription[];
}

/** The first day looked at for `asOf`: the 1st of the month SUBSCRIPTION_MONTHS − 1 before its month. */
export function subscriptionsFrom(asOf: string): string {
  const [y, m] = asOf.split("-").map(Number) as [number, number];
  const months = y * 12 + (m - 1) - (SUBSCRIPTION_MONTHS - 1);
  return `${Math.floor(months / 12)}-${String((months % 12) + 1).padStart(2, "0")}-01`;
}

const drifts = (a: Minor, b: Minor): boolean => Math.abs(a - b) <= Math.max(DRIFT_MIN, Math.floor((Math.min(a, b) * DRIFT_PERCENT) / 100));
const rises = (older: Minor, newer: Minor): boolean => newer > older && newer * 100 <= older * (100 + RISE_PERCENT);
/** Close by the percentage alone: how a shop's similar purchases are judged, so a ₴49 and a ₴59 are apart. */
const near = (a: Minor, b: Minor): boolean => Math.abs(a - b) * 100 <= Math.min(a, b) * DRIFT_PERCENT;

/** Charges linked back from the latest, newest first, and how many months each link spans (1, or 2 for a skip). */
interface Chain {
  links: ChargeRow[];
  steps: number[];
}

/**
 * Follows a chain back from `start`: each link STEP_MIN–STEP_MAX days before the last (or, once, SKIP_MIN–SKIP_MAX:
 * a month skipped), the same sum give or take, one price rise allowed. A rise with fewer than MIN_CHARGES charges at
 * the old price behind it is not believed: the chain ends at it.
 */
function follow(start: ChargeRow, charges: readonly ChargeRow[], taken: ReadonlySet<ChargeRow>): Chain {
  const links = [start];
  const steps: number[] = [];
  let rise = -1;
  const pick = (cur: ChargeRow, min: number, max: number): ChargeRow | undefined => {
    const middle = (min + max) / 2;
    return (
      charges
        .filter(
          (c) =>
            !taken.has(c) &&
            !links.includes(c) &&
            c.date >= addDays(cur.date, -max) &&
            c.date <= addDays(cur.date, -min) &&
            (drifts(c.amount, cur.amount) || (rise < 0 && rises(c.amount, cur.amount))),
        )
        // The closest sum, then the step closest to its middle, then the later day.
        .sort(
          (a, b) =>
            Math.abs(a.amount - cur.amount) - Math.abs(b.amount - cur.amount) ||
            Math.abs(daysBetween(a.date, cur.date) - middle) - Math.abs(daysBetween(b.date, cur.date) - middle) ||
            (a.date < b.date ? 1 : -1),
        )[0]
    );
  };
  for (;;) {
    const cur = links[links.length - 1]!;
    let next = pick(cur, STEP_MIN, STEP_MAX);
    let step = 1;
    if (!next && !steps.includes(2)) {
      next = pick(cur, SKIP_MIN, SKIP_MAX);
      step = 2;
    }
    if (!next) break;
    if (!drifts(next.amount, cur.amount)) rise = links.length - 1;
    links.push(next);
    steps.push(step);
  }
  if (rise >= 0 && links.length - (rise + 1) < MIN_CHARGES) return { links: links.slice(0, rise + 1), steps: steps.slice(0, rise) };
  return { links, steps };
}

/**
 * The subscriptions as of the Kyiv day `asOf` (today, or the last day of a past month), from the purchases of the
 * SUBSCRIPTION_MONTHS up to it. At each place chains are followed back from the latest charge on (`follow`). A chain
 * of MIN_CHARGES or more is a subscription, and two chains at one place are two (two plans at one store, at one price
 * or not), unless the place is a shop: within the chain's span more sums like it than SIMILAR_PER_MONTH a month
 * (judged first, for each chain on its own), or more purchases outside the chains still standing than months. A
 * one-off purchase at the store that also bills a subscription does not matter. One not charged for a while is left
 * out when the place has since charged a sum like it outside the chains still standing: it may be back, and
 * «не списывалась» would be wrong. A yearly charge never chains. A place with no name is left out: the
 * screen would have nothing to call it. A place in `notSubscriptions` (marked «Не подписка» by the owner, ЯМ6) is
 * never a subscription: its charges are left out before anything is followed.
 */
export function findSubscriptions(rows: readonly ChargeRow[], asOf: string, notSubscriptions: ReadonlySet<string> = new Set()): Subscriptions {
  const from = subscriptionsFrom(asOf);
  const byKey = new Map<string, ChargeRow[]>();
  for (const r of rows) {
    if (r.date < from || r.date > asOf || r.amount <= 0 || r.name.trim() === "" || notSubscriptions.has(r.key)) continue;
    byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
  }
  const found: Subscription[] = [];
  for (const charges of byKey.values()) {
    // Latest first; the same day by sum, so the order never depends on the database.
    charges.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.amount - a.amount));
    const taken = new Set<ChargeRow>();
    const chains: Chain[] = [];
    for (const start of charges) {
      if (taken.has(start)) continue;
      const chain = follow(start, charges, taken);
      if (chain.links.length < MIN_CHARGES) continue;
      chains.push(chain);
      for (const c of chain.links) taken.add(c);
    }
    const judged = chains.map(({ links, steps }) => {
      const start = links[0]!;
      const first = links[links.length - 1]!;
      const months = steps.reduce((s, n) => s + n, 0);
      const inSpan = charges.filter((c) => c.date >= first.date && c.date <= start.date && !links.includes(c));
      // A missed charge counts once half a step has passed after it was due, then one more each step:
      // floor((since − step / 2) / step) with step = span / months, kept in whole numbers.
      const span = daysBetween(first.date, start.date);
      const since = daysBetween(start.date, asOf);
      const missed = Math.max(0, Math.floor((2 * since * months - span) / (2 * span)));
      const similar = links.length + inSpan.filter((c) => links.some((l) => near(l.amount, c.amount))).length;
      return { links, start, months, inSpan, missed, dense: similar > SIMILAR_PER_MONTH * (months + 1) + 1 };
    });
    // The rest is judged against the chains still standing: a purchase in a chain dropped as a shop is a shop's
    // purchase like any other. Dropping one chain can bring down another, so it runs until nothing changes.
    let kept = judged.filter((j) => !j.dense);
    for (;;) {
      const linked = new Set(kept.flatMap((j) => j.links));
      const next = kept.filter(
        (j) =>
          j.inSpan.filter((c) => !linked.has(c)).length <= j.months &&
          !(j.missed > 0 && charges.some((c) => c.date > j.start.date && !linked.has(c) && (drifts(j.start.amount, c.amount) || rises(j.start.amount, c.amount)))),
      );
      if (next.length === kept.length) break;
      kept = next;
    }
    for (const { links, start, missed } of kept) {
      const previous = links[1]!;
      found.push({
        key: start.key,
        name: start.name,
        amount: start.amount,
        lastDate: start.date,
        raisedBy: drifts(previous.amount, start.amount) ? 0 : start.amount - previous.amount,
        missed,
      });
    }
  }
  const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const active = found
    .filter((s) => s.missed === 0)
    .sort((a, b) => b.amount - a.amount || order(a.name, b.name) || order(a.key, b.key) || order(b.lastDate, a.lastDate));
  const quiet = found.filter((s) => s.missed > 0).sort((a, b) => (a.lastDate !== b.lastDate ? (a.lastDate < b.lastDate ? 1 : -1) : b.amount - a.amount));
  return { monthly: active.reduce((s, x) => s + x.amount, 0), items: [...active, ...quiet] };
}
