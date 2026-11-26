import { describe, expect, it } from "vitest";
import { ENTRANCE, ENTRANCE_IDLE, countAt, easeOut, entranceStep, type EntranceInput, type EntranceState } from "./entrance";

const input = (over: Partial<EntranceInput> = {}): EntranceInput => ({ shown: true, stamp: 1, pulling: false, fetching: false, reduced: false, ...over });
/** Feeds the renders one after another, as the hook does. */
const run = (steps: EntranceInput[], from: EntranceState = ENTRANCE_IDLE) => steps.reduce(entranceStep, from);

describe("entranceStep", () => {
  it("plays once when the data is first shown, after a skeleton or at once", () => {
    expect(run([input({ shown: false, stamp: 0, fetching: true }), input()]).plays).toBe(1);
    expect(run([input()]).plays).toBe(1);
  });

  it("does not play while there is nothing to show", () => {
    expect(run([input({ shown: false, stamp: 0, fetching: true })]).plays).toBe(0);
  });

  it("a render that changes nothing gives the same state back", () => {
    const state = run([input()]);
    expect(entranceStep(state, input())).toBe(state);
  });

  it("does not play again on a re-render, a background refetch or new data in place", () => {
    const steps = [input(), input(), input({ fetching: true }), input({ stamp: 2 }), input({ stamp: 3 })];
    expect(run(steps).plays).toBe(1);
  });

  it("does not play again when the data goes and comes back", () => {
    expect(run([input(), input({ shown: false }), input({ stamp: 2 })]).plays).toBe(1);
  });

  it("plays again when a pull brings new data, in the render that has it", () => {
    const pulled = run([input(), input({ pulling: true, fetching: true })]);
    expect(pulled.plays).toBe(1);
    expect(entranceStep(pulled, input({ pulling: true, fetching: true })).plays).toBe(1);
    expect(entranceStep(pulled, input({ pulling: true, stamp: 2 })).plays).toBe(2);
    // The spinner may go in the same render as the data comes, or the data may come after it (the month's request).
    expect(entranceStep(pulled, input({ stamp: 2 })).plays).toBe(2);
    expect(run([input({ fetching: true }), input({ stamp: 2 })], pulled).plays).toBe(2);
  });

  it("plays once for one pull", () => {
    const steps = [input(), input({ pulling: true, fetching: true }), input({ pulling: true, stamp: 2 }), input({ stamp: 2 }), input({ stamp: 3 })];
    expect(run(steps).plays).toBe(2);
  });

  it("a failed pull plays nothing, and neither does the next background refetch", () => {
    const steps = [input(), input({ pulling: true, fetching: true }), input(), input({ fetching: true }), input({ stamp: 2 })];
    expect(run(steps).plays).toBe(1);
  });

  it("a pull with nothing shown plays nothing", () => {
    const steps = [input({ shown: false }), input({ shown: false, pulling: true, fetching: true }), input({ shown: false, stamp: 2 })];
    expect(run(steps).plays).toBe(0);
  });

  it("plays nothing under reduce motion, and does not make up for it when motion comes back", () => {
    const steps = [input({ reduced: true }), input({ reduced: true, pulling: true, fetching: true }), input({ reduced: true, stamp: 2 }), input({ stamp: 2 }), input({ stamp: 3 })];
    expect(run(steps).plays).toBe(0);
    expect(run([...steps, input({ stamp: 3, pulling: true, fetching: true }), input({ stamp: 4 })]).plays).toBe(1);
  });
});

describe("easeOut", () => {
  it("starts at 0, ends at 1 and never overshoots", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(-1)).toBe(0);
    expect(easeOut(2)).toBe(1);
    let before = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      const now = easeOut(t);
      expect(now).toBeGreaterThanOrEqual(before);
      expect(now).toBeLessThanOrEqual(1);
      before = now;
    }
  });

  it("slows down towards the end", () => {
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});

describe("countAt", () => {
  it("counts from zero to the amount in whole hryvnias, never past it", () => {
    expect(countAt(123_456, 0)).toBe(0);
    let before = 0;
    for (let ms = 0; ms < ENTRANCE.countMs; ms += 16) {
      const now = countAt(123_456, ms);
      expect(now % 100).toBe(0);
      expect(now).toBeGreaterThanOrEqual(before);
      expect(now).toBeLessThanOrEqual(123_456);
      before = now;
    }
  });

  it("ends on the exact amount, kopecks and all", () => {
    expect(countAt(123_456, ENTRANCE.countMs)).toBe(123_456);
    expect(countAt(123_456, ENTRANCE.countMs + 500)).toBe(123_456);
  });

  it("has nothing to count for zero or less", () => {
    expect(countAt(0, 100)).toBe(0);
    expect(countAt(-5_000, 100)).toBe(-5_000);
  });
});

describe("ENTRANCE", () => {
  it("keeps the spec's times, and the key lives until the longest of them is over", () => {
    expect(ENTRANCE.countMs).toBe(900);
    expect(ENTRANCE.barMs).toBe(1000);
    expect(ENTRANCE.lineMs).toBe(1400);
    // The payments' rows, one after another, are well under a second for the four there can be.
    expect(ENTRANCE.rowStepMs * 3 + ENTRANCE.rowMs).toBeLessThan(700);
    expect(ENTRANCE.settleMs).toBeGreaterThan(ENTRANCE.lineMs);
  });
});
