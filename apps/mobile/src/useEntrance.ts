import { useEffect, useRef, useState } from "react";
import { ENTRANCE, ENTRANCE_IDLE, countAt, entranceStep, type EntranceInput } from "./entrance";
import { useReduceMotion } from "./metal/useMetalActive";

/**
 * The key of a screen's entrance (task ЧЛ8), for its sections: 0 — nothing plays, everything is in its final state;
 * a new number above zero — play from the start, once. `entranceStep` decides when a new one begins (the first data,
 * a pull's answer) and reduce motion keeps it at 0.
 *
 * The key is live only while the entrance runs (`ENTRANCE.settleMs`) and then goes back to 0, so a section that is
 * first drawn later (a payment appeared, a background refetch) just appears. Going back to 0 cuts nothing short.
 */
export function useEntrance(of: Omit<EntranceInput, "reduced">): number {
  const reduced = useReduceMotion();
  const input: EntranceInput = { shown: of.shown, stamp: of.stamp, pulling: of.pulling, fetching: of.fetching, reduced };
  const [state, setState] = useState(() => entranceStep(ENTRANCE_IDLE, input));
  // Stepped while rendering, so the render that first has the data is already the entrance's first frame.
  const next = entranceStep(state, input);
  if (next !== state) setState(next);
  const { plays } = next;
  const [settled, setSettled] = useState(0);
  useEffect(() => {
    if (plays === 0) return;
    const timer = setTimeout(() => setSettled(plays), ENTRANCE.settleMs);
    return () => clearTimeout(timer);
  }, [plays]);
  return plays > settled && !reduced ? plays : 0;
}

/**
 * A figure counting up to `to` kopecks when `play` (a key of `useEntrance`) turns to a new number above zero: the
 * kopecks to show on the way, or null when the figure is simply its amount — before, after, with nothing to count
 * (zero or less) and whenever the key is 0. Display only: the amount itself is never touched.
 *
 * It counts on the JS thread, one small text a frame for 0.9 s, and then stops: no frame is asked for afterwards.
 */
export function useCountUp(to: number, play: number): number | null {
  const start = (key: number) => (key > 0 && to > 0 ? 0 : null);
  const [run, setRun] = useState(() => ({ play, shown: start(play) }));
  let now = run;
  // Reset while rendering, so the first frame of an entrance is already zero, not the amount.
  if (run.play !== play) {
    now = { play, shown: start(play) };
    setRun(now);
  }
  const target = useRef(to);
  target.current = to;
  useEffect(() => {
    if (play === 0) return;
    const began = Date.now();
    let frame: ReturnType<typeof requestAnimationFrame> | null = null;
    const step = () => {
      const elapsed = Date.now() - began;
      const done = elapsed >= ENTRANCE.countMs || !(target.current > 0);
      const shown = done ? null : countAt(target.current, elapsed);
      setRun((r) => (r.play !== play || r.shown === shown ? r : { play, shown }));
      frame = done ? null : requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [play]);
  return now.shown;
}
