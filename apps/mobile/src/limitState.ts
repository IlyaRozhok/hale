// No native imports: runs in node tests.

export type LimitState = "ok" | "low" | "over";

/** A quarter or less of the day's limit left is "low"; nothing left (or less) is "over". */
const LOW = 0.25;

/**
 * How the day stands, for the colour of the spark at the end of the limit strip. On the day the
 * shortage mode came on it is sand whatever was spent: there is no red that day (audit 6.7).
 */
export function limitState(s: { leftToday: number; level: number; shortageStart?: object }): LimitState {
  if (s.shortageStart) return "low";
  if (s.leftToday <= 0) return "over";
  return s.level <= LOW ? "low" : "ok";
}
