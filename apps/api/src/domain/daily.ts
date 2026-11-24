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
  /** The cap is the default one, used while the person has not set theirs: it is then not «their cap» (ЧЛ2). */
  lifestyleCapDefault?: boolean;
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

/**
 * Which rule gave the limit (ЧЛ2), decided in whole kopecks a day:
 * - `cap` — the cap (a thirtieth of the month's) is below the larger of the share and the recommended sum, so it is
 *   the limit. That covers a cap below both, and a cap between them: with the share below the cap the limit is then
 *   above the share and leaves no reserve, which the parts show (`share < dailyLimit`).
 * - `share` — the share of free money over the days as it is: not below the recommended sum, not above the cap.
 *   A tie is the share: a cap equal to it lowers nothing, a recommended sum equal to it raises nothing.
 * - `floor` — the recommended sum: the share is below it and the cap is not; and in the shortage (free money below
 *   zero) while no plan is confirmed. The cap does not apply in the shortage.
 * - `plan` — the shortage with a confirmed plan: the plan's sum.
 */
export type LimitRule = "share" | "cap" | "floor" | "plan";

/**
 * What the limit is made of (ЧЛ2): the figures of the one computation that gave `dailyLimit`, so they always add up
 * to it. `own − taxReserve − obligationsDue − goalDue − borrowed = free`; `share = floor(free / daysLeft)` (below
 * zero in the shortage). What was spent today is not a part: the parts are stored with the day's limit and do not
 * move with spending.
 */
export interface LimitParts {
  own: Minor;
  taxReserve: Minor;
  obligationsDue: Minor;
  goalDue: Minor;
  borrowed: Minor;
  free: Minor;
  /** The days the free money is spread over: the engine's, 1 on the income day itself, 30 without an income date. */
  daysLeft: number;
  share: Minor;
  rule: LimitRule;
  dailyLimit: Minor;
  /** The cap in this computation was the default one, not one the person set. Left out otherwise. */
  capDefault?: true;
  /** There was no income date ahead: `daysLeft` is the 30-day horizon. Left out otherwise. */
  noIncomeDate?: true;
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
  /** What `dailyLimit` is made of, from this same computation. */
  parts: LimitParts;
}

export function computeDaily(i: DailyInput): DailyState {
  const hasIncomeDate = i.nextIncomeOn !== null && i.nextIncomeOn >= i.today;
  const daysLeft = hasIncomeDate
    ? Math.max(1, daysBetween(i.today, i.nextIncomeOn!))
    : NO_INCOME_HORIZON_DAYS;

  const ownTotal = i.cardsMoney + i.fopMoney + i.binanceMoney;
  const free = ownTotal - i.taxReserve - i.obligationsDue - i.goalDue - i.borrowed;

  const share = Math.floor(free / daysLeft);

  let mode: DailyState["mode"] = "normal";
  let rule: LimitRule;
  let dailyLimit: Minor;
  let bridge: BridgeState | null = null;

  if (free < 0) {
    mode = "bridge";
    const recommendedDaily = i.foodFloor;
    rule = i.bridgeDaily != null ? "plan" : "floor";
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
    // The limit is floor(min(max(free / daysLeft, foodFloor), cap / 30)), built from its three whole-kopeck parts
    // (rounding down commutes with min and max) so that the rule named is the one that gave the figure (`LimitRule`).
    const floorDaily = Math.floor(i.foodFloor);
    const capDaily = Math.floor(i.lifestyleCapMonthly / 30);
    rule = capDaily < Math.max(share, floorDaily) ? "cap" : share >= floorDaily ? "share" : "floor";
    dailyLimit = rule === "cap" ? capDaily : rule === "share" ? share : floorDaily;
  }

  const leftToday = dailyLimit - i.spentToday;
  const level = dailyLimit > 0 ? Math.min(1, Math.max(0, leftToday / dailyLimit)) : 0;

  const parts: LimitParts = {
    own: ownTotal,
    taxReserve: i.taxReserve,
    obligationsDue: i.obligationsDue,
    goalDue: i.goalDue,
    borrowed: i.borrowed,
    free,
    daysLeft,
    share,
    rule,
    dailyLimit,
    ...(i.lifestyleCapDefault ? { capDefault: true as const } : {}),
    ...(hasIncomeDate ? {} : { noIncomeDate: true as const }),
  };
  return { mode, daysLeft, free, dailyLimit, leftToday, level, needsIncomeDate: !hasIncomeDate, bridge, parts };
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
  /**
   * The limit today's row holds; for a day with no row, the limit it is being fixed with (its morning one).
   * Left out together with `limit`: not compared.
   */
  storedLimit?: Minor | null;
  /** The limit the shortage puts in force today: the engine's, or the plan's being chosen. */
  limit?: Minor;
}

/**
 * The mark today's row should carry. The shortage came on today when a day fixed as ordinary is now
 * in shortage, or when the day is first fixed in shortage right after an ordinary day. The very
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
 *
 * A day that began in shortage right after an ordinary day is fixed with the shortage's limit from its start
 * (task Б47 (4), the owner's option А of 18 November): its limit never changes, so it too is an ordinary
 * shortage day, judged by its limit. Only a day first fixed after it already crossed into shortage onto another
 * limit (the morning ordinary, the first fix late) is the start.
 */
export function dayMark(i: DayMarkInput): DayMark {
  if (i.live === "normal") return i.stored === "bridge" ? "bridge" : "normal";
  const changed = i.limit === undefined ? null : i.storedLimit !== i.limit;
  if (i.stored === "bridge_start") return "bridge_start";
  if (i.stored === "normal") return changed === false ? "bridge" : "bridge_start";
  // A row of `bridge` right after an ordinary day is a day that crossed on the same limit (above).
  if (i.stored === "bridge" && i.previous === "normal" && changed === true) return "bridge_start";
  if (i.stored === null && i.previous === "normal") return changed === false ? "bridge" : "bridge_start";
  return "bridge";
}
