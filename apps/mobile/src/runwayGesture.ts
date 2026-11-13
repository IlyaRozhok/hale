/** How far, in points, a finger may drift on either axis and still be a tap. */
export const SLOP = 8;

/** What a touch on the runway chart has become: still a tap, a scrub across the days, or the page's scroll. */
export type RunwayGesture = "wait" | "scrub" | "scroll";

/**
 * Reads a touch on the runway chart from how far it has moved since it began. Within the slop it is
 * still a tap; past it, a mostly horizontal move scrubs the days and anything else (an exact diagonal
 * too) belongs to the page, so the screen scrolls and pulls to refresh over the chart as well.
 */
export function runwayGesture(dx: number, dy: number, slop = SLOP): RunwayGesture {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < slop && ay < slop) return "wait";
  return ax > ay ? "scrub" : "scroll";
}
