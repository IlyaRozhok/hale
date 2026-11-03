// Pure level and time maths for the metal. No native imports: runs in node tests and, via the
// 'worklet' directives, on the Reanimated UI thread.

import { tokens } from "@hale/tokens";

/** Time (seconds) the shader is frozen at when motion is reduced: a pleasant, fixed pose. */
export const STILL_TIME = tokens.metal.stillTime;

/** Seconds for a level change to cover about 63% of its distance. */
export const LEVEL_TAU = tokens.metal.levelTau;

/** Clamp a level to 0..1. NaN becomes 0. */
export function clampLevel(level: number): number {
  "worklet";
  if (Number.isNaN(level)) return 0;
  return Math.min(1, Math.max(0, level));
}

/**
 * Surface height at horizontal position x (0..1) and time t (seconds). Same two sines as the
 * pool in the shader, so tests and the shader agree. Flat when motion is reduced.
 */
export function waveLevel(level: number, reducedMotion: boolean, t = 0, x = 0.5): number {
  "worklet";
  const base = clampLevel(level);
  if (reducedMotion) return base;
  return clampLevel(base + 0.018 * Math.sin(x * 7 + t * 0.9) + 0.012 * Math.sin(x * 13 - t * 0.7));
}

/** The time uniform for the shader: frozen when motion is reduced. */
export function shaderTime(elapsedSeconds: number, reducedMotion: boolean): number {
  "worklet";
  return reducedMotion ? STILL_TIME : elapsedSeconds;
}

/**
 * One animation step of the displayed level toward the target. Exponential easing, so it is
 * smooth, never overshoots and does not depend on the frame rate. Snaps when motion is reduced.
 */
export function stepLevel(current: number, target: number, dtSeconds: number, reducedMotion: boolean): number {
  "worklet";
  const to = clampLevel(target);
  if (reducedMotion) return to;
  const from = clampLevel(current);
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return from;
  const k = 1 - Math.exp(-dtSeconds / LEVEL_TAU);
  const next = from + (to - from) * k;
  return Math.abs(to - next) < 1e-4 ? to : next;
}
