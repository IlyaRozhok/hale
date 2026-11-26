// The entrance of «Сегодня» (task ЧЛ8): when it plays and how its figures count. Pure, no native imports: runs in
// node tests.

/** The times of the spec's section 5, in milliseconds. */
export const ENTRANCE = {
  /** A figure counts up to its amount. */
  countMs: 900,
  /** A bar grows to its length. */
  barMs: 1000,
  /** The runway's line draws itself. */
  lineMs: 1400,
  /** A payment's row fades in; each next one starts this much later. */
  rowMs: 260,
  rowStepMs: 70,
  /** How long an entrance's key stays live: past the longest animation, so something drawn later just appears. */
  settleMs: 1700,
} as const;

/** What one render of the screen knows about a request. */
export interface EntranceInput {
  /** There is data on the screen. */
  shown: boolean;
  /** When the data last came (the query's `dataUpdatedAt`): changes with every answer, not with an error. */
  stamp: number;
  /** The owner's pull is on (the spinner). */
  pulling: boolean;
  /** The request is on its way, whoever asked. */
  fetching: boolean;
  /** «Уменьшение движения», or not known yet. */
  reduced: boolean;
}

export interface EntranceState {
  /** The data has been shown once: it never counts as first again. */
  seen: boolean;
  pulling: boolean;
  /** The stamp a pull began at, while its answer is awaited; null with no pull to answer. */
  armed: number | null;
  /** How many entrances have begun. */
  plays: number;
}

export const ENTRANCE_IDLE: EntranceState = { seen: false, pulling: false, armed: null, plays: 0 };

/**
 * One render's step of the trigger. An entrance begins (`plays` grows) only:
 * - when data is shown for the first time;
 * - when a pull's answer brings new data — in the very render that has it, so the old picture is not drawn first.
 * Never on a re-render, a background refetch, a failed pull, or under reduce motion; a moment missed under reduce
 * motion is not made up for later. Gives the same state back when nothing changed.
 */
export function entranceStep(state: EntranceState, input: EntranceInput): EntranceState {
  let fire = false;
  const seen = state.seen || input.shown;
  if (input.shown && !state.seen) fire = true;

  let armed = state.armed;
  if (input.pulling && !state.pulling && armed === null) armed = input.stamp;
  if (armed !== null) {
    if (input.stamp !== armed) {
      fire = true;
      armed = null;
    } else if (!input.pulling && !input.fetching) {
      // The pull ended with no new data: it failed, and a later answer is not its own.
      armed = null;
    }
  }

  const plays = fire && input.shown && !input.reduced ? state.plays + 1 : state.plays;
  if (seen === state.seen && input.pulling === state.pulling && armed === state.armed && plays === state.plays) return state;
  return { seen, pulling: input.pulling, armed, plays };
}

/** Ease-out with no overshoot: quick at first, then settling. 0..1 in, 0..1 out. */
export function easeOut(t: number): number {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  return 1 - (1 - t) ** 3;
}

/**
 * What a counting figure shows `elapsedMs` after it began, in kopecks: whole hryvnias on the way (the formatter
 * shows no kopecks), never past the amount, and at the end the amount itself. Zero or less is not counted.
 */
export function countAt(to: number, elapsedMs: number): number {
  if (!(to > 0) || elapsedMs >= ENTRANCE.countMs) return to;
  return Math.min(to, Math.floor((to * easeOut(elapsedMs / ENTRANCE.countMs)) / 100) * 100);
}
