import { addDays, type Minor } from "./money";

export interface RunwayInput {
  today: string;
  /** The day the next income comes (or the horizon's end): the last point. */
  endOn: string;
  /** Own money with reserves and the payments below already taken out. */
  free: Minor;
  dailyLimit: Minor;
  /**
   * What each day after today spends, when it is not `dailyLimit`: on the day the shortage came on, today keeps
   * its morning limit while the days after it already run on the shortage one. Defaults to `dailyLimit`.
   */
  laterLimit?: Minor;
  /** What is left of today's limit; negative when overspent. */
  leftToday: Minor;
  /** Unpaid payments up to `endOn`, in hryvnias. Overdue ones count today; one on `endOn` leaves before it. */
  payments: readonly { date: string; amount: Minor }[];
}

export interface Runway {
  /** Money at the start of each day, from today to `endOn`. */
  points: { date: string; balance: Minor }[];
  /** What is left on `endOn` if every day spends its limit. */
  reserve: Minor;
  /** The day the money ends: its spending or payment takes the balance below zero. Null if none does. */
  zeroOn: string | null;
}

/**
 * The money day by day until the next income: today spends what is left of its limit, each later
 * day its whole limit (or `laterLimit`), and a payment leaves on its day. Pure; the same input gives the same answer.
 */
export function runway(i: RunwayInput): Runway {
  let balance = i.free + i.payments.reduce((s, p) => s + p.amount, 0);
  const points = [{ date: i.today, balance }];
  const day = (p: { date: string }) => (p.date <= i.today ? i.today : p.date);
  for (let d = i.today; d < i.endOn; d = addDays(d, 1)) {
    const spend = d === i.today ? Math.max(0, i.leftToday) : (i.laterLimit ?? i.dailyLimit);
    const paid = i.payments.reduce((s, p) => s + (day(p) === d ? p.amount : 0), 0);
    balance -= spend + paid;
    points.push({ date: addDays(d, 1), balance });
  }
  // A payment due on `endOn` (the income day) is reserved in advance (Б47 (1)): it leaves before the last point.
  const onEnd = i.payments.reduce((s, p) => s + (day(p) >= i.endOn ? p.amount : 0), 0);
  if (onEnd !== 0) {
    balance -= onEnd;
    points[points.length - 1] = { date: points[points.length - 1]!.date, balance };
  }
  const below = points.findIndex((p) => p.balance < 0);
  return { points, reserve: balance, zeroOn: below < 0 ? null : points[Math.max(0, below - 1)]!.date };
}
