import { addDays, daysBetween, type Minor } from "./money";

export interface DuePayment {
  dueOn: string;
  amount: Minor;
  paid: boolean;
}

const NO_INCOME_HORIZON_DAYS = 30;

/**
 * Unpaid payments that must be covered before the next income: overdue ones
 * (still owed) plus those with today <= due < nextIncomeOn. Without an income
 * date, the next 30 days.
 */
export function sumDue(
  payments: DuePayment[],
  today: string,
  nextIncomeOn: string | null,
): Minor {
  const end = nextIncomeOn && nextIncomeOn >= today ? nextIncomeOn : addDays(today, NO_INCOME_HORIZON_DAYS);
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
  creditAvailable: Minor;
  taxReserve: Minor;
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
    const creditNeeded = -free + dailyLimit * daysLeft;
    bridge = {
      creditNeeded,
      recommendedDaily,
      maxDailyWithinCredit: Math.max(0, Math.floor((i.creditAvailable + free) / daysLeft)),
      shortfall: Math.max(0, creditNeeded - i.creditAvailable),
      overPlan: i.creditPlan !== null && ownTotal < -i.creditPlan,
    };
  } else {
    dailyLimit = Math.floor(Math.min(free / daysLeft, i.lifestyleCapMonthly / 30));
  }

  const leftToday = dailyLimit - i.spentToday;
  const level = dailyLimit > 0 ? Math.min(1, Math.max(0, leftToday / dailyLimit)) : 0;

  return { mode, daysLeft, free, dailyLimit, leftToday, level, needsIncomeDate: !hasIncomeDate, bridge };
}
