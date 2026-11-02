import { MONO_MAX_STATEMENT_WINDOW_S } from "./mono.client";

export type Window = [from: number, to: number];

/**
 * Splits [fromSec, toSec] (unix seconds, inclusive) into consecutive windows no longer
 * than monobank's statement limit. Each window starts one second after the previous ends.
 */
export function planWindows(fromSec: number, toSec: number): Window[] {
  const windows: Window[] = [];
  let start = fromSec;
  while (start <= toSec) {
    const end = Math.min(start + MONO_MAX_STATEMENT_WINDOW_S, toSec);
    windows.push([start, end]);
    start = end + 1;
  }
  return windows;
}

/** Halves a window with no gap or overlap; null when it is already a single second. */
export function splitWindow(from: number, to: number): [Window, Window] | null {
  if (to <= from) return null;
  const mid = from + Math.floor((to - from) / 2);
  return [
    [from, mid],
    [mid + 1, to],
  ];
}
