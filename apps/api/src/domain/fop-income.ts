import { previousMonth } from "./insights";

/** A hryvnia income on the fop account, as the bank dated it (Kyiv day). */
export interface FopIncome {
  id: number;
  localDate: string;
  occurredAt: Date;
  amountUah: number;
}

/** The fop income a month's event takes: its sum and its first row. */
export interface FopMonthIncome {
  sum: number;
  firstId: number;
  firstAt: Date;
}

/**
 * The month whose fop event an income on `localDate` belongs to (task Б46). Last month's money often comes in the
 * first days of the next one: an income before this month's window starts goes to last month while last month
 * still waits for its money; otherwise it is this month's, whatever its size (Б33). A window that starts on the
 * 1st never gives money back to last month.
 */
export function fopIncomePeriod(localDate: string, windowStartDay: number, previousWaits: boolean): string {
  const month = localDate.slice(0, 7);
  return previousWaits && Number(localDate.slice(8, 10)) < windowStartDay ? previousMonth(month) : month;
}

/**
 * Whether a month's fop event still takes late money from the next month: it is not received yet, or it was received
 * by the bank with a row from after its month (late money already came and more may follow). An event received
 * by its own month's income, or confirmed by hand, takes no more. `matchedOn` is the Kyiv day of the row that
 * received it, null when none did.
 */
export function waitsForLateIncome(e: { period: string; received: boolean; matchedOn: string | null }): boolean {
  if (!e.received) return true;
  return e.matchedOn !== null && e.matchedOn.slice(0, 7) > e.period;
}

/**
 * Fop incomes, in order of arrival, given out to the months of one expected income with its window start:
 * `waiting` are the months whose event still takes late money (waitsForLateIncome). A month that gets an income of
 * its own on the way stops waiting, as it would once received by it, so the answer does not depend on how many of
 * the rows were already counted. Returns each row's month and each month's sum and first row.
 */
export function fopIncomeByPeriod(
  incomes: readonly FopIncome[],
  windowStartDay: number,
  waiting: ReadonlySet<string>,
): { periodOf: Map<number, string>; months: Map<string, FopMonthIncome> } {
  const periodOf = new Map<number, string>();
  const months = new Map<string, FopMonthIncome>();
  const waits = new Set(waiting);
  for (const i of incomes) {
    const own = i.localDate.slice(0, 7);
    const period = fopIncomePeriod(i.localDate, windowStartDay, waits.has(previousMonth(own)));
    if (period === own) waits.delete(own);
    periodOf.set(i.id, period);
    const m = months.get(period);
    if (m) m.sum += i.amountUah;
    else months.set(period, { sum: i.amountUah, firstId: i.id, firstAt: i.occurredAt });
  }
  return { periodOf, months };
}
