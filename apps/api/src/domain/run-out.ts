import { addDays, type Minor } from "./money";

/** Date the free money runs out at the current pace, or null if nothing is spent. */
export function runOutDate(i: {
  free: Minor;
  avgDailySpend: Minor;
  today: string;
}): string | null {
  if (i.avgDailySpend <= 0) return null;
  if (i.free <= 0) return i.today;
  return addDays(i.today, Math.floor(i.free / i.avgDailySpend));
}
