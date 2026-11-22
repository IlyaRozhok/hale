import { daysBetween, type Minor } from "./money";
import { runOutDate } from "./run-out";

/** The hint's amount is a friendly figure: a whole ₴100. */
const HINT_STEP: Minor = 10_000;

export interface Pace {
  /** The usual day: what was spent a day on average over the last days, in kopecks. */
  avgDaily: Minor;
  /** The day the free money runs out at that pace: the same day as `runOutDate`. Always before `incomeOn`. */
  runOutOn: string;
  incomeOn: string;
  /**
   * A calm step between the limit and the pace: about `daily` a day the same free money lasts until `lastsUntil`,
   * later than `runOutOn` and still before the income. `untilIncome` (task А24а2) is what a day may take from tomorrow
   * to last until the income: the free money without what is left of today's limit, over the days after today
   * before the income, rounded down to ₴100. Always below `daily`.
   */
  hint?: { daily: Minor; lastsUntil: string; untilIncome: Minor };
}

/**
 * Task А24: the pace of spending, when at it the free money runs out before the next known income. Null when the money
 * lasts, when no income date is known, when nothing was spent, or when there is no free money (the shortage mode says
 * that itself). Null too when the usual day is within the limit: the food floor lifted the limit above the share of
 * the money, and the pace is not the person's problem then. The limit is not touched: this only reads it.
 *
 * `free` is the money now, today's spending already out of it, as `runOutDate` takes it; `spentToday` is what the
 * screen counts against today's limit.
 */
export function pace(i: {
  today: string;
  free: Minor;
  avgDailySpend: Minor;
  dailyLimit: Minor;
  spentToday: Minor;
  nextIncomeOn: string | null;
}): Pace | null {
  const incomeOn = i.nextIncomeOn;
  if (incomeOn === null || incomeOn < i.today || i.free <= 0 || i.avgDailySpend <= i.dailyLimit) return null;
  const runOutOn = runOutDate({ free: i.free, avgDailySpend: i.avgDailySpend, today: i.today });
  if (runOutOn === null || runOutOn >= incomeOn) return null;
  const result: Pace = { avgDaily: i.avgDailySpend, runOutOn, incomeOn };

  // The days to cover are those before the income day, as in the limit itself (computeDaily's `daysLeft`). Today
  // keeps what is left of its limit (nothing once it is spent past); the rest of the free money is spread over the
  // later days. Rounded down, so that «about this much — until the income» stays true. With the income tomorrow there
  // is no later day: no hint.
  const laterDays = daysBetween(i.today, incomeOn) - 1;
  if (laterDays < 1) return result;
  const restOfToday = Math.max(0, i.dailyLimit - i.spentToday);
  const untilIncome = roundDown(Math.max(0, i.free - restOfToday) / laterDays);
  const daily = roundDown((i.avgDailySpend + i.dailyLimit) / 2);
  if (untilIncome > 0 && daily > untilIncome && daily < i.avgDailySpend) {
    const lastsUntil = runOutDate({ free: i.free, avgDailySpend: daily, today: i.today })!;
    if (lastsUntil > runOutOn && lastsUntil < incomeOn) result.hint = { daily, lastsUntil, untilIncome };
  }
  return result;
}

/** Down to a whole ₴100. */
function roundDown(kopecks: number): Minor {
  return Math.floor(kopecks / HINT_STEP) * HINT_STEP;
}
