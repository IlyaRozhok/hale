import { describe, expect, it } from "vitest";
import { nearestDay, runwayChart } from "./runwayChart";

const days = (balances: number[]) => balances.map((balance, i) => ({ date: `2026-11-${String(11 + i).padStart(2, "0")}`, balance }));

describe("runwayChart", () => {
  it("spreads the days across the width and the money between the top and the zero line", () => {
    const c = runwayChart(days([400, 300, 200, 100, 0]), [], 200, 120, 10);
    expect(c.xs).toEqual([0, 50, 100, 150, 200]);
    expect(c.zeroY).toBe(110);
    expect(c.line).toEqual([{ x: 0, y: 10 }, { x: 50, y: 35 }, { x: 100, y: 60 }, { x: 150, y: 85 }, { x: 200, y: 110 }]);
    expect(c.cross).toBeNull();
  });

  it("a payment is a step down on its day, then the slope goes on", () => {
    const c = runwayChart(days([400, 300, 100, 0]), [{ id: "1", date: "2026-11-12", name: "Аренда", amount: 100 }], 300, 100, 0);
    expect(c.line).toEqual([{ x: 0, y: 0 }, { x: 100, y: 25 }, { x: 100, y: 50 }, { x: 200, y: 75 }, { x: 300, y: 100 }]);
  });

  it("keeps the zero line inside when the money goes below it, and finds where it is crossed", () => {
    const c = runwayChart(days([100, 0, -100]), [], 200, 100, 0);
    expect(c.zeroY).toBe(50);
    expect(c.cross).toBe(100);
    // Between two days the crossing is where the line meets zero.
    expect(runwayChart(days([100, -100]), [], 200, 100, 0).cross).toBe(100);
    // A step can cross it too: straight down on the payment's day.
    expect(runwayChart(days([100, 50, -200]), [{ id: "1", date: "2026-11-12", name: "x", amount: 200 }], 200, 100, 0).cross).toBe(100);
    expect(runwayChart(days([-5, -10]), [], 200, 100, 0).cross).toBe(0);
  });

  it("draws a flat line when nothing changes, and nothing for a single day or no width", () => {
    expect(runwayChart(days([0, 0]), [], 100, 100, 10).line.map((p) => p.y)).toEqual([90, 90]);
    expect(runwayChart(days([500]), [], 100, 100, 10).line).toEqual([]);
    expect(runwayChart(days([500, 400]), [], 0, 100, 10).line).toEqual([]);
  });
});

describe("nearestDay", () => {
  it("is the day whose point is closest to the finger", () => {
    const xs = [0, 50, 100];
    expect(nearestDay(xs, -20)).toBe(0);
    expect(nearestDay(xs, 24)).toBe(0);
    expect(nearestDay(xs, 26)).toBe(1);
    expect(nearestDay(xs, 400)).toBe(2);
  });
});
