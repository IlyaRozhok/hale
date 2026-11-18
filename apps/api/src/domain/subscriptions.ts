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
/** The same sum, give or take: a charge in dollars drifts with the rate. Whichever is larger. */
const DRIFT_PERCENT = 15;
const DRIFT_MIN: Minor = 1_000;
/** A price rise beyond the drift is still the same subscription up to this many percent, once in its history. */
const RISE_PERCENT = 60;

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

/**
 * The subscriptions as of the Kyiv day `asOf` (today, or the last day of a past month), from the purchases of the
 * SUBSCRIPTION_MONTHS up to it. At each place a chain is followed back from a charge: each link STEP_MIN–STEP_MAX
 * days before the last, the same sum give or take, one price rise allowed. A chain of MIN_CHARGES or more is a
 * subscription unless the place charged a similar sum between its links: that is a shop bought at often, or a place
 * visited twice a month. Other purchases at the place (an app bought once at the store that also bills the
 * subscription) do not matter, and two chains at one place are two subscriptions. A yearly charge never chains.
 * A place with no name is left out: the screen would have nothing to call it.
 */
export function findSubscriptions(rows: readonly ChargeRow[], asOf: string): Subscriptions {
  const from = subscriptionsFrom(asOf);
  const byKey = new Map<string, ChargeRow[]>();
  for (const r of rows) {
    if (r.date < from || r.date > asOf || r.amount <= 0 || r.name.trim() === "") continue;
    byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
  }
  const found: Subscription[] = [];
  for (const charges of byKey.values()) {
    // Latest first; the same day by sum, so the order never depends on the database.
    charges.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.amount - a.amount));
    const used = new Set<ChargeRow>();
    for (const start of charges) {
      if (used.has(start)) continue;
      const chain = [start];
      let rose = false;
      for (;;) {
        const cur = chain[chain.length - 1]!;
        const earliest = addDays(cur.date, -STEP_MAX);
        const latest = addDays(cur.date, -STEP_MIN);
        const options = charges.filter(
          (c) => !used.has(c) && !chain.includes(c) && c.date >= earliest && c.date <= latest && (drifts(c.amount, cur.amount) || (!rose && rises(c.amount, cur.amount))),
        );
        // The closest sum, then the step closest to a month, then the later day.
        const next = options.sort(
          (a, b) =>
            Math.abs(a.amount - cur.amount) - Math.abs(b.amount - cur.amount) ||
            Math.abs(daysBetween(a.date, cur.date) - 30) - Math.abs(daysBetween(b.date, cur.date) - 30) ||
            (a.date < b.date ? 1 : -1),
        )[0];
        if (!next) break;
        if (!drifts(next.amount, cur.amount)) rose = true;
        chain.push(next);
      }
      if (chain.length < MIN_CHARGES) continue;
      const first = chain[chain.length - 1]!;
      const stray = charges.some((c) => !chain.includes(c) && c.date > first.date && c.date < start.date && chain.some((l) => drifts(l.amount, c.amount)));
      if (stray) continue;
      for (const c of chain) used.add(c);
      const previous = chain[1]!;
      // A missed charge counts once 1.5 mean steps have passed since the last one, then one more each step:
      // floor((since − step / 2) / step) with step = span / (n − 1), kept in whole numbers.
      const span = daysBetween(first.date, start.date);
      const since = daysBetween(start.date, asOf);
      const missed = Math.max(0, Math.floor((2 * since * (chain.length - 1) - span) / (2 * span)));
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
  const active = found.filter((s) => s.missed === 0).sort((a, b) => b.amount - a.amount || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.key < b.key ? -1 : 1));
  const quiet = found.filter((s) => s.missed > 0).sort((a, b) => (a.lastDate !== b.lastDate ? (a.lastDate < b.lastDate ? 1 : -1) : b.amount - a.amount));
  return { monthly: active.reduce((s, x) => s + x.amount, 0), items: [...active, ...quiet] };
}
