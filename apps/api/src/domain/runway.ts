import { addDays, type Minor } from "./money";

export interface RunwayInput {
  today: string;
  /** The day the next income comes (or the horizon's end): the last point. */
  endOn: string;
  /** Own money with reserves and the payments below already taken out. */
  free: Minor;
  dailyLimit: Minor;
  /** What is left of today's limit; negative when overspent. */
  leftToday: Minor;
  /** Unpaid payments before `endOn`, in hryvnias. Overdue ones count today. */
  payments: readonly { date: string; amount: Minor }[];
}

export interface Runway {
  /** Money at the start of each day, from today to `endOn`. */
  points: { date: string; balance: Minor }[];
  /** What is left on `endOn` if every day spends its limit. */
  reserve: Minor;
  /** The first day that starts below zero; null if none does. */
  zeroOn: string | null;
}

/**
 * The money day by day until the next income: today spends what is left of its limit, each later
 * day its whole limit, and a payment leaves on its day. Pure; the same input gives the same answer.
 */
export function runway(i: RunwayInput): Runway {
  let balance = i.free + i.payments.reduce((s, p) => s + p.amount, 0);
  const points = [{ date: i.today, balance }];
  for (let d = i.today; d < i.endOn; d = addDays(d, 1)) {
    const spend = d === i.today ? Math.max(0, i.leftToday) : i.dailyLimit;
    const paid = i.payments.reduce((s, p) => s + ((p.date <= i.today ? i.today : p.date) === d ? p.amount : 0), 0);
    balance -= spend + paid;
    points.push({ date: addDays(d, 1), balance });
  }
  return { points, reserve: balance, zeroOn: points.find((p) => p.balance < 0)?.date ?? null };
}
