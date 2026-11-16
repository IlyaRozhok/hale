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
   * Reserved loans whose return date is today or already past, the oldest date first. A loan due on the day the
   * income comes is outside the window, so it is not named: nothing would say it is in the limit.
   */
  dueNow: OpenLoan[];
}

/**
 * Which open loans lower free money, and by how much (task Б7, the owner's answer of 16 November, option А).
 *
 * - A loan with a return date, of any kind, behaves as an unpaid payment on that date: it is reserved when the
 *   date falls before the next income (or the 30-day horizon), and when it is overdue: the window of `sumDue`.
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
