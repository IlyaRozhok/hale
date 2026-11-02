import { addDays, daysBetween } from "./money";

/** The calendar quarter containing `date` (YYYY-MM-DD): first and last day, its length, and which day `date` is (1-based). */
export function quarterOf(date: string): { start: string; end: string; daysIn: number; dayOf: number } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  const start = `${y}-${String(qm).padStart(2, "0")}-01`;
  const ny = qm + 3 > 12 ? y + 1 : y;
  const nm = ((qm + 2) % 12) + 1;
  const next = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return { start, end: addDays(next, -1), daysIn: daysBetween(start, next), dayOf: daysBetween(start, date) + 1 };
}

/** The quarter containing `date`, as stored in `scheduled_payments.tax_quarter`: "2026-Q4". */
export function quarterLabel(date: string): string {
  return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
}

/** The quarter before the one containing `date`. Tax due on 2027-02-20 is for "2026-Q4". */
export function precedingQuarter(date: string): string {
  return quarterLabel(addDays(quarterOf(date).start, -1));
}

/** First and last day of a quarter given by its label. */
export function quarterBounds(label: string): { start: string; end: string } {
  const year = label.slice(0, 4);
  const first = (Number(label.slice(6)) - 1) * 3 + 1;
  const { start, end } = quarterOf(`${year}-${String(first).padStart(2, "0")}-01`);
  return { start, end };
}

/** The 20th of the second month after the quarter ends. */
export function estimateDueOn(label: string): string {
  const after = addDays(quarterBounds(label).end, 1);
  const month = Number(after.slice(5, 7)) + 1;
  return `${after.slice(0, 4)}-${String(month).padStart(2, "0")}-20`;
}
