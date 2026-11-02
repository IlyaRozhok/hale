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
