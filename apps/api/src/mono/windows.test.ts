import { describe, expect, it } from "vitest";
import { MONO_MAX_STATEMENT_WINDOW_S } from "./mono.client";
import { planWindows, splitWindow } from "./windows";

const DAY = 86_400;

describe("planWindows", () => {
  it("covers two years with windows within the limit and no gaps", () => {
    const from = 1_700_000_000;
    const to = from + 730 * DAY;
    const windows = planWindows(from, to);
    expect(windows[0]![0]).toBe(from);
    expect(windows.at(-1)![1]).toBe(to);
    for (const [a, b] of windows) {
      expect(b - a).toBeLessThanOrEqual(MONO_MAX_STATEMENT_WINDOW_S);
      expect(b).toBeGreaterThanOrEqual(a);
    }
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]![0]).toBe(windows[i - 1]![1] + 1);
    }
    expect(windows.length).toBeGreaterThanOrEqual(24);
  });

  it("returns a single window for a short range and none for an inverted one", () => {
    expect(planWindows(100, 200)).toEqual([[100, 200]]);
    expect(planWindows(200, 100)).toEqual([]);
  });
});

describe("splitWindow", () => {
  it("halves a window without gaps or overlap", () => {
    expect(splitWindow(0, 100)).toEqual([
      [0, 50],
      [51, 100],
    ]);
    expect(splitWindow(10, 11)).toEqual([
      [10, 10],
      [11, 11],
    ]);
  });

  it("returns null when the window cannot be split", () => {
    expect(splitWindow(5, 5)).toBeNull();
  });
});
