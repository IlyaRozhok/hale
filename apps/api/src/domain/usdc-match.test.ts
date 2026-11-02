import { describe, expect, it } from "vitest";
import { MAX_USDC_MATCH_QUESTIONS, USDC_MATCH_MIN_UAH, type UsdcMatchRow, usdcMatchRows } from "./usdc-match";

const row = (over: Partial<UsdcMatchRow> = {}): UsdcMatchRow => ({
  id: 1,
  type: "person_in",
  accountKind: "black",
  amountUah: USDC_MATCH_MIN_UAH,
  localDate: "2026-11-20",
  usdcChecked: false,
  ...over,
});
const input = { binanceBalance: 270_000, receivedPeriod: "2026-11", trackingStart: "2026-11-02" };
const ask = (r: UsdcMatchRow) => usdcMatchRows({ ...input, rows: [r] }).length === 1;

describe("usdcMatchRows", () => {
  it("asks about a card credit or a cash deposit of at least ₴1,000", () => {
    expect(ask(row())).toBe(true);
    expect(ask(row({ accountKind: "white" }))).toBe(true);
    expect(ask(row({ type: "cash_in" }))).toBe(true);
    expect(ask(row({ type: "cash_in", accountKind: "fop" }))).toBe(true);
    expect(ask(row({ amountUah: USDC_MATCH_MIN_UAH - 1 }))).toBe(false);
    expect(ask(row({ amountUah: null }))).toBe(false);
  });
  it("skips other types and accounts, and rows already answered", () => {
    for (const type of ["income", "own_transfer", "loan_in", "spend", null]) expect(ask(row({ type }))).toBe(false);
    expect(ask(row({ accountKind: "fop" }))).toBe(false);
    expect(ask(row({ accountKind: "jar" }))).toBe(false);
    expect(ask(row({ type: "cash_in", accountKind: "jar" }))).toBe(false);
    expect(ask(row({ usdcChecked: true }))).toBe(false);
  });
  it("asks nothing with an empty Binance balance or no received USDC", () => {
    expect(usdcMatchRows({ ...input, rows: [row()], binanceBalance: 0 })).toEqual([]);
    expect(usdcMatchRows({ ...input, rows: [row()], receivedPeriod: null })).toEqual([]);
  });
  it("leaves history alone: rows before the income's month or before tracking", () => {
    expect(ask(row({ localDate: "2026-11-02" }))).toBe(true);
    expect(ask(row({ localDate: "2026-11-01" }))).toBe(false);
    expect(usdcMatchRows({ ...input, trackingStart: "2026-01-01", rows: [row({ localDate: "2026-10-31" })] })).toEqual([]);
    expect(usdcMatchRows({ ...input, trackingStart: "2026-01-01", rows: [row({ localDate: "2026-11-01" })] })).toHaveLength(1);
  });
  it("keeps the given order and stops at three", () => {
    const rows = [1, 2, 3, 4].map((id) => row({ id }));
    expect(usdcMatchRows({ ...input, rows }).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(MAX_USDC_MATCH_QUESTIONS).toBe(3);
  });
});
