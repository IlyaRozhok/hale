import { addDays, daysBetween, type Minor } from "./money";

export interface DuePayment {
  dueOn: string;
  amount: Minor;
  paid: boolean;
}

const NO_INCOME_HORIZON_DAYS = 30;

/**
 * The first due date not reserved before the next income: the day after that income's day, or the 30-day
 * horizon without one. A payment due on the income day itself is reserved in advance, like one the day before
 * (task Б47 (1), the owner's option А of 18 November): the money may well leave before the income arrives.
 * The horizon is not an income, so its window stays the 30 days the limit is spread over.
 */
export function dueWindowEnd(today: string, nextIncomeOn: string | null): string {
  return nextIncomeOn && nextIncomeOn >= today ? addDays(nextIncomeOn, 1) : addDays(today, NO_INCOME_HORIZON_DAYS);
}

/**
 * Unpaid payments that must be covered before the next income: overdue ones
 * (still owed) plus those with today <= due <= nextIncomeOn. Without an income
 * date (null or already past), the next 30 days.
 * Callers pass only non-tax payments: taxes are covered by taxReserve.
 */
export function sumDue(
  payments: DuePayment[],
  today: string,
  nextIncomeOn: string | null,
): Minor {
  const end = dueWindowEnd(today, nextIncomeOn);
  let sum = 0;
  for (const p of payments) {
    if (!p.paid && p.dueOn < end) sum += p.amount;
  }
  return sum;
}

export interface DailyInput {
  today: string;
  cardsMoney: Minor;
  fopMoney: Minor;
  binanceMoney: Minor;
  /**
   * The full credit limit (not the unused part): `-free` already contains any
   * card debt, so the headroom is limit minus the shortfall of own money.
   */
  creditLimit: Minor;
  taxReserve: Minor;
  /**
   * The part of taxReserve accrued for the current quarter and not due before the next income.
   * It stays in `free` (it lowers the normal limit) but is not cash needed to bridge to the income.
   */
  taxAccruedNotDue: Minor;
  obligationsDue: Minor;
  goalDue: Minor;
  borrowed: Minor;
  nextIncomeOn: string | null;
  spentToday: Minor;
  lifestyleCapMonthly: Minor;
  foodFloor: Minor;
  bridgeDaily: Minor | null;
  creditPlan: Minor | null;
}

export interface BridgeState {
  creditNeeded: Minor;
  recommendedDaily: Minor;
  maxDailyWithinCredit: Minor;
  shortfall: Minor;
  overPlan: boolean;
}

export interface DailyState {
  mode: "normal" | "bridge";
  daysLeft: number;
  free: Minor;
  dailyLimit: Minor;
  leftToday: Minor;
  /** 0..1 share of today's limit still unspent. */
  level: number;
  needsIncomeDate: boolean;
  bridge: BridgeState | null;
}

export function computeDaily(i: DailyInput): DailyState {
  const hasIncomeDate = i.nextIncomeOn !== null && i.nextIncomeOn >= i.today;
  const daysLeft = hasIncomeDate
    ? Math.max(1, daysBetween(i.today, i.nextIncomeOn!))
    : NO_INCOME_HORIZON_DAYS;

  const ownTotal = i.cardsMoney + i.fopMoney + i.binanceMoney;
  const free = ownTotal - i.taxReserve - i.obligationsDue - i.goalDue - i.borrowed;

  let mode: DailyState["mode"] = "normal";
  let dailyLimit: Minor;
  let bridge: BridgeState | null = null;

  if (free < 0) {
    mode = "bridge";
    const recommendedDaily = i.foodFloor;
    dailyLimit = i.bridgeDaily ?? recommendedDaily;
    const creditNeeded = Math.max(0, -(free + i.taxAccruedNotDue) + dailyLimit * daysLeft);
    bridge = {
      creditNeeded,
      recommendedDaily,
      maxDailyWithinCredit: Math.max(0, Math.floor((i.creditLimit + free + i.taxAccruedNotDue) / daysLeft)),
      shortfall: Math.max(0, creditNeeded - i.creditLimit),
      overPlan: i.creditPlan !== null && ownTotal < -i.creditPlan,
    };
  } else {
    // Not below the plan's recommended sum (task Б47 (3), the owner's option А of 18 November): near zero
    // the share of free money over the days would drop to ₴10 a day just above zero while ₴450 waits just
    // below it. The lifestyle cap is the ceiling the owner set, so it still wins over the recommended sum.
    // The days above the share then run into the credit; the runway shows that, as it does in the shortage.
    dailyLimit = Math.floor(Math.min(Math.max(free / daysLeft, i.foodFloor), i.lifestyleCapMonthly / 30));
  }

  const leftToday = dailyLimit - i.spentToday;
  const level = dailyLimit > 0 ? Math.min(1, Math.max(0, leftToday / dailyLimit)) : 0;

  return { mode, daysLeft, free, dailyLimit, leftToday, level, needsIncomeDate: !hasIncomeDate, bridge };
}

/**
 * What a fixed day's row says about the day. `bridge_start` is the day the shortage mode came on:
 * what was spent on it is not judged against the new limit (audit 6.7). Rows written before this
 * mark existed hold only the other two values, so earlier days are never read as such a day.
 */
export type DayMark = "normal" | "bridge" | "bridge_start";

export interface DayMarkInput {
  /** The mode the day is in now. */
  live: DailyState["mode"];
  /** What today's row holds; null when the day has no row (not fixed yet, or about to be fixed again). */
  stored: string | null;
  /** What the last fixed day before today holds; null when there is none. */
  previous: string | null;
  /** The limit today's row holds; null when the day has no row. Left out together with `limit`: not compared. */
  storedLimit?: Minor | null;
  /** The limit the shortage puts in force today: the engine's, or the plan's being chosen. */
  limit?: Minor;
}

/**
 * The mark today's row should carry. The shortage came on today when a day fixed as ordinary is now
 * in shortage, or when the day is fixed (again) in shortage right after an ordinary day. The very
 * first fixed day is never one: there was no limit before it to replace.
 *
 * A day that began in shortage keeps `bridge` even while the money is briefly above zero: were it
 * rewritten to `normal`, falling back the same day would mark a day whose limit never changed.
 *
 * The mark spares the day's spending from a new limit, so a day fixed as ordinary that crosses into shortage on
 * the limit it already has is not the start (task Б47 (3): near zero the ordinary limit is already the
 * recommended sum). It stays an ordinary shortage day, judged by its limit, until that limit changes the same
 * day — a plan chosen with another sum — and then it is the start. With the limits left out the mark is
 * placed as before.
 */
export function dayMark(i: DayMarkInput): DayMark {
  if (i.live === "normal") return i.stored === "bridge" ? "bridge" : "normal";
  const changed = i.limit === undefined ? null : i.storedLimit !== i.limit;
  if (i.stored === "bridge_start") return "bridge_start";
  if (i.stored === "normal") return changed === false ? "bridge" : "bridge_start";
  // A row of `bridge` right after an ordinary day is a day that crossed on the same limit (above).
  if (i.stored === "bridge" && i.previous === "normal" && changed === true) return "bridge_start";
  if (i.stored === null && i.previous === "normal") return "bridge_start";
  return "bridge";
}
