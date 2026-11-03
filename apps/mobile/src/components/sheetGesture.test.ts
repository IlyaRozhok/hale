import { describe, expect, it } from "vitest";
import { shouldCloseSheet, shouldDragSheet } from "./sheetGesture";

describe("dragging a sheet", () => {
  it("starts on a downward move, when the content is at its top", () => {
    expect(shouldDragSheet({ dx: 0, dy: 12 }, 0)).toBe(true);
    expect(shouldDragSheet({ dx: 0, dy: 12 }, 40)).toBe(false);
  });
  it("leaves taps, upward moves and sideways moves alone", () => {
    expect(shouldDragSheet({ dx: 0, dy: 3 }, 0)).toBe(false);
    expect(shouldDragSheet({ dx: 0, dy: -30 }, 0)).toBe(false);
    expect(shouldDragSheet({ dx: 40, dy: 20 }, 0)).toBe(false);
  });
});

describe("letting go of a sheet", () => {
  it("closes after a long drag or a quick flick", () => {
    expect(shouldCloseSheet({ dy: 130, vy: 0 })).toBe(true);
    expect(shouldCloseSheet({ dy: 30, vy: 1 })).toBe(true);
  });
  it("otherwise goes back", () => {
    expect(shouldCloseSheet({ dy: 60, vy: 0.1 })).toBe(false);
    expect(shouldCloseSheet({ dy: 5, vy: 1 })).toBe(false);
  });
});
