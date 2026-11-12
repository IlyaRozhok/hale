export type DayStatus = "within" | "over" | "far_over" | "no_limit";

/** Above this share of the limit a day is far over it. */
const FAR_OVER = 1.5;

/**
 * A day with no limit, or a zero one, cannot be judged: there was nothing to stay within. Neither
 * can the day the shortage mode came on: what was spent before the new limit is not set against it.
 */
export function dayStatus(limit: number | null, spent: number, shortageStart = false): DayStatus {
  if (shortageStart || limit === null || limit <= 0) return "no_limit";
  if (spent <= limit) return "within";
  return spent <= limit * FAR_OVER ? "over" : "far_over";
}

export interface LimitDay {
  date: string;
  limit: number | null;
  spent: number;
  /** The shortage mode came on that day. */
  shortageStart?: boolean;
}

/**
 * Days within the limit in a row, back from yesterday: today is not over yet. A day with no limit
 * neither breaks the streak nor adds to it, and the same goes for the day the shortage mode came on.
 */
export function currentStreak(days: readonly LimitDay[], today: string): number {
  const past = days.filter((d) => d.date < today).sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  for (const d of past) {
    const status = dayStatus(d.limit, d.spent, d.shortageStart);
    if (status === "over" || status === "far_over") break;
    if (status === "within") streak++;
  }
  return streak;
}
