import { describe, expect, it } from "vitest";
import { SLOP, runwayGesture } from "./runwayGesture";

describe("runwayGesture", () => {
  it("waits while the finger has barely moved: a tap's jitter is not a gesture", () => {
    expect(runwayGesture(0, 0)).toBe("wait");
    expect(runwayGesture(SLOP - 1, 0)).toBe("wait");
    expect(runwayGesture(0, -(SLOP - 1))).toBe("wait");
    expect(runwayGesture(-3, 4)).toBe("wait");
  });

  it("a mostly horizontal drag scrubs the days, either way", () => {
    expect(runwayGesture(SLOP, 0)).toBe("scrub");
    expect(runwayGesture(-40, 10)).toBe("scrub");
    expect(runwayGesture(30, -20)).toBe("scrub");
  });

  it("a mostly vertical drag belongs to the page: scrolling and pull to refresh", () => {
    expect(runwayGesture(0, SLOP)).toBe("scroll");
    expect(runwayGesture(5, 60)).toBe("scroll");
    expect(runwayGesture(-20, -30)).toBe("scroll");
  });

  it("an exact diagonal goes to the page", () => {
    expect(runwayGesture(20, 20)).toBe("scroll");
    expect(runwayGesture(-20, 20)).toBe("scroll");
  });

  it("the slop is measured on each axis, not along the diagonal", () => {
    expect(runwayGesture(SLOP - 1, SLOP - 1)).toBe("wait");
  });
});
