import { describe, expect, it } from "vitest";
import { runway } from "./runway";

const base = { today: "2026-11-11", endOn: "2026-11-15", free: 1_000_000, dailyLimit: 200_000, leftToday: 124_000, payments: [] as { date: string; amount: number }[] };

describe("runway", () => {
  it("goes down by what is left of today, then by the limit each day, to the income day", () => {
    const r = runway(base);
    expect(r.points).toEqual([
      { date: "2026-11-11", balance: 1_000_000 },
      { date: "2026-11-12", balance: 876_000 },
      { date: "2026-11-13", balance: 676_000 },
      { date: "2026-11-14", balance: 476_000 },
      { date: "2026-11-15", balance: 276_000 },
    ]);
    expect(r.reserve).toBe(276_000);
    expect(r.zeroOn).toBeNull();
  });

  it("starts with the payments' money still there and drops by each on its day; overdue ones today", () => {
    const r = runway({ ...base, payments: [{ date: "2026-11-13", amount: 300_000 }, { date: "2026-11-06", amount: 50_000 }] });
    expect(r.points[0]).toEqual({ date: "2026-11-11", balance: 1_350_000 });
    expect(r.points[1]!.balance).toBe(1_350_000 - 124_000 - 50_000);
    expect(r.points[3]!.balance).toBe(r.points[2]!.balance - 200_000 - 300_000);
    // The payments were already taken out of `free`: the reserve does not change.
    expect(r.reserve).toBe(276_000);
  });

  it("an overspent day spends nothing more today", () => {
    expect(runway({ ...base, leftToday: -50_000 }).points[1]!.balance).toBe(1_000_000);
  });

  it("names the day the money ends: the one whose spending or payment takes it below zero", () => {
    // 400,000 → 276,000 → 76,000 → the 13th spends 200,000 of it.
    const r = runway({ ...base, free: 400_000 });
    expect(r.reserve).toBe(400_000 - 124_000 - 600_000);
    expect(r.zeroOn).toBe("2026-11-13");
    // A payment's day, not the morning after it.
    expect(runway({ ...base, free: 100_000, payments: [{ date: "2026-11-12", amount: 900_000 }] }).zeroOn).toBe("2026-11-12");
    expect(runway({ ...base, free: -1 }).zeroOn).toBe("2026-11-11");
    // Ending exactly at zero is not below it.
    expect(runway({ ...base, endOn: "2026-11-12", free: 124_000 }).zeroOn).toBeNull();
  });

  it("is a single point when the income is today", () => {
    const r = runway({ ...base, endOn: "2026-11-11" });
    expect(r.points).toEqual([{ date: "2026-11-11", balance: 1_000_000 }]);
    expect(r.reserve).toBe(1_000_000);
  });
});
