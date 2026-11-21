import { dueWindowEnd } from "./daily";
import type { Minor } from "./money";

/** An open loan as the limit sees it. */
export interface OpenLoan {
  id: number;
  /** What is still owed: the amount less what was repaid. */
  remaining: Minor;
  receivedOn: string;
  /** «Вернуть до», set by the owner; null when the loan has no return date. */
  dueOn: string | null;
  kind: "short" | "other";
  /** Entered by hand: a loan from a person. */
  manual: boolean;
}

export interface LoanReserveInput {
  loans: readonly OpenLoan[];
  today: string;
  /** Loans taken before this day are history: never in the limit. */
  trackingStart: string;
  /** The Kyiv day the last income was received, if any. */
  lastIncomeOn: string | null;
  nextIncomeOn: string | null;
}

export interface LoanReserve {
  /** Owed on loans with no return date: it lowers free money until they are repaid. */
  borrowed: Minor;
  /** Owed on loans with a return date inside the window (or past it): reserved like unpaid payments. */
  due: Minor;
  /** Every loan that lowers free money now, in the order given. */
  counted: OpenLoan[];
  /**
   * Reserved loans whose return date is today or already past, the oldest date first. Only reserved loans are named,
   * so nothing says a loan is in the limit when it is not; a loan due on the day the income comes is reserved (Б47 (1)).
   */
  dueNow: OpenLoan[];
}

/**
 * Which open loans lower free money, and by how much (task Б7, the owner's answer of 16 November, option А).
 *
 * - A loan with a return date, of any kind, behaves as an unpaid payment on that date: it is reserved when the
 *   date falls before the next income or on its day (or within the 30-day horizon), and when it is overdue: the
 *   window of `sumDue`.
 * - With no date, a loan from a person and a short bank loan («Кредит до завтра», МФО, a cash loan for N days)
 *   are owed in full until repaid, whatever the income cycle.
 * - With no date, a monthly bank loan counts only in the cycle it arrived, since the last received income; after
 *   that its monthly debits live in «Рассрочки».
 *
 * Loans taken before tracking began never count.
 */
export function loanReserve(i: LoanReserveInput): LoanReserve {
  const tracked = i.loans.filter((l) => l.receivedOn >= i.trackingStart && l.remaining > 0);
  const undated = tracked.filter(
    (l) => l.dueOn === null && (l.manual || l.kind === "short" || i.lastIncomeOn === null || l.receivedOn >= i.lastIncomeOn),
  );
  const end = dueWindowEnd(i.today, i.nextIncomeOn);
  const dated = tracked.filter((l) => l.dueOn !== null && l.dueOn < end);
  return {
    borrowed: undated.reduce((s, l) => s + l.remaining, 0),
    due: dated.reduce((s, l) => s + l.remaining, 0),
    counted: tracked.filter((l) => undated.includes(l) || dated.includes(l)),
    dueNow: dated.filter((l) => l.dueOn! <= i.today).sort((a, b) => a.dueOn!.localeCompare(b.dueOn!) || a.id - b.id),
  };
}

/** A received income event, as the loan cycle boundary sees it. */
export interface ReceivedIncome {
  /** The income pays the fop tax (before Д3а, the fop income): it is received by the month's money on the fop account. */
  paysFopTax: boolean;
  /** The Kyiv day it was received; null when the day is unknown. */
  receivedOn: string | null;
  /** What arrived, in kopecks; null when not recorded. */
  amountUah: Minor | null;
  /** The expected amount, in minor units of `currency`. */
  expectedAmount: Minor;
  currency: string;
  /** Marked received by a bank income on the fop account, not by the owner's «Доход пришёл». */
  byBank: boolean;
}

/**
 * The day the last income came, for the monthly-bank-loan rule of `loanReserve` (task Б33). Any fop income
 * marks its month received, so the next income date never hangs; but a small part of the expected amount is not
 * the month's income for this boundary: a fop event marked by the bank closes the cycle only once what arrived
 * reaches half the expected amount in hryvnias (a foreign one at its rate; without a rate it does not). An older
 * boundary keeps more loans in the limit: the safe side. Income confirmed by hand and USDC count as before.
 */
export function lastIncomeBoundary(events: readonly ReceivedIncome[], rates: Readonly<Record<string, number>>): string | null {
  let last: string | null = null;
  for (const e of events) {
    if (e.receivedOn === null) continue;
    if (e.paysFopTax && e.byBank) {
      const rate = e.currency === "UAH" ? 1 : rates[e.currency];
      if (!rate || e.amountUah === null || e.amountUah * 2 < e.expectedAmount * rate) continue;
    }
    if (last === null || e.receivedOn > last) last = e.receivedOn;
  }
  return last;
}
