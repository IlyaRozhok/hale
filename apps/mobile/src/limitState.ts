// No native imports: runs in node tests.

export type LimitState = "ok" | "low" | "over";

/** A quarter or less of the day's limit left is "low"; nothing left (or less) is "over". */
const LOW = 0.25;

/** How the day stands, for the colour of the spark at the end of the limit strip. */
export function limitState(s: { leftToday: number; level: number }): LimitState {
  if (s.leftToday <= 0) return "over";
  return s.level <= LOW ? "low" : "ok";
}
