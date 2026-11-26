import { describe, expect, it } from "vitest";
import { GROW_SECONDS, STILL_TIME, clampLevel, growLevel, shaderTime, stepGrow, stepLevel, waveLevel } from "./level";

describe("clampLevel", () => {
  it("keeps values inside 0..1", () => {
    expect(clampLevel(-0.4)).toBe(0);
    expect(clampLevel(1.7)).toBe(1);
    expect(clampLevel(0.42)).toBe(0.42);
  });
  it("turns NaN and infinities into safe values", () => {
    expect(clampLevel(NaN)).toBe(0);
    expect(clampLevel(Infinity)).toBe(1);
    expect(clampLevel(-Infinity)).toBe(0);
  });
});

describe("waveLevel", () => {
  it("stays inside 0..1 even for out-of-range or NaN input", () => {
    expect(waveLevel(5, false, 1.3, 0.2)).toBeLessThanOrEqual(1);
    expect(waveLevel(-5, false, 1.3, 0.2)).toBeGreaterThanOrEqual(0);
    expect(waveLevel(NaN, false, 1, 0.5)).toBeGreaterThanOrEqual(0);
  });
  it("is the flat level when motion is reduced, whatever the time", () => {
    expect(waveLevel(0.6, true, 0, 0.3)).toBe(0.6);
    expect(waveLevel(0.6, true, 99, 0.9)).toBe(0.6);
  });
  it("ripples around the level when motion is allowed", () => {
    const samples = [0, 1, 2, 3, 4, 5].map((t) => waveLevel(0.5, false, t, 0.37));
    expect(new Set(samples).size).toBeGreaterThan(1);
    for (const s of samples) expect(Math.abs(s - 0.5)).toBeLessThanOrEqual(0.03);
  });
});

describe("shaderTime", () => {
  it("passes elapsed time through when motion is allowed", () => {
    expect(shaderTime(12.5, false)).toBe(12.5);
  });
  it("does not change with elapsed time when motion is reduced", () => {
    expect(shaderTime(0, true)).toBe(STILL_TIME);
    expect(shaderTime(123, true)).toBe(STILL_TIME);
  });
});

describe("stepLevel", () => {
  it("moves toward the target without overshooting and converges", () => {
    let v = 0;
    let prev = v;
    for (let i = 0; i < 120; i++) {
      v = stepLevel(v, 0.8, 1 / 60, false);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(0.8);
      prev = v;
    }
    expect(v).toBeCloseTo(0.8, 2);
  });
  it("moves down smoothly too", () => {
    const a = stepLevel(0.9, 0.2, 1 / 60, false);
    expect(a).toBeLessThan(0.9);
    expect(a).toBeGreaterThan(0.2);
  });
  it("is not a jump: one frame covers only part of the distance", () => {
    expect(stepLevel(0, 1, 1 / 60, false)).toBeLessThan(0.5);
  });
  it("is frame-rate independent", () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = stepLevel(a, 1, 1 / 60, false);
    let b = 0;
    for (let i = 0; i < 30; i++) b = stepLevel(b, 1, 1 / 30, false);
    expect(a).toBeCloseTo(b, 6);
  });
  it("snaps to the target when motion is reduced", () => {
    expect(stepLevel(0, 0.7, 1 / 60, true)).toBe(0.7);
  });
  it("sanitises inputs", () => {
    expect(stepLevel(NaN, 0.5, 1 / 60, true)).toBe(0.5);
    expect(stepLevel(0.2, 3, 1 / 60, true)).toBe(1);
    expect(stepLevel(0.2, 0.9, NaN, false)).toBe(0.2);
    expect(stepLevel(0.2, 0.9, -1, false)).toBe(0.2);
  });
});

// Task ЧЛ8: the strip grows to its length once, when «Сегодня» opens.
describe("growLevel", () => {
  it("takes a second, as the spec's bars do", () => {
    expect(GROW_SECONDS).toBe(1);
  });

  it("goes from nothing to the whole length, never past it and never back", () => {
    expect(growLevel(0)).toBe(0);
    expect(growLevel(GROW_SECONDS)).toBe(1);
    expect(growLevel(GROW_SECONDS + 5)).toBe(1);
    expect(growLevel(-1)).toBe(0);
    expect(growLevel(NaN)).toBe(1);
    let before = 0;
    for (let t = 0; t <= GROW_SECONDS; t += 1 / 60) {
      const now = growLevel(t);
      expect(now).toBeGreaterThanOrEqual(before);
      expect(now).toBeLessThanOrEqual(1);
      before = now;
    }
  });

  it("eases out: more than half the way in half the time", () => {
    expect(growLevel(GROW_SECONDS / 2)).toBeGreaterThan(0.5);
  });
});

describe("stepGrow", () => {
  it("moves on by the frame's time and stops at the end", () => {
    expect(stepGrow(0, 1 / 60)).toBeCloseTo(1 / 60);
    expect(stepGrow(GROW_SECONDS - 0.001, 1 / 60)).toBe(GROW_SECONDS);
    expect(stepGrow(GROW_SECONDS, 1 / 60)).toBe(GROW_SECONDS);
  });

  it("a long first frame does not eat the growth", () => {
    expect(stepGrow(0, 0.8)).toBeLessThanOrEqual(0.05);
  });

  it("stands still for a frame with no time", () => {
    expect(stepGrow(0.3, 0)).toBe(0.3);
    expect(stepGrow(0.3, NaN)).toBe(0.3);
  });
});
