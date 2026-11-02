import { describe, expect, it } from "vitest";
import { STILL_TIME, clampLevel, shaderTime, stepLevel, waveLevel } from "./level";

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
