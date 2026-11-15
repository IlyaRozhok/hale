import { describe, expect, it } from "vitest";
import type { LedgerContext, LedgerRow } from "./ledger";
import {
  type ChainAccount,
  type ChainRow,
  bankBalanceCheck,
  cashWalletCheck,
  categoriesCheck,
  daySpentCheck,
  loneLegsCheck,
} from "./ledger-check";

const MIN = 60_000;
const at = (date: string, minute = 0) => Date.parse(`${date}T08:00:00Z`) + minute * MIN;

let seq = 0;
const row = (date: string, amount: number, balanceAfter: number | null, minute = 0): ChainRow => ({
  id: ++seq,
  at: at(date, minute),
  localDate: date,
  amount,
  balanceAfter,
});
const account = (rows: ChainRow[], balance: number, balanceDate = "2026-11-12"): ChainAccount => ({
  balance,
  balanceAt: at(balanceDate, 600),
  balanceDate,
  rows,
});

describe("bankBalanceCheck (invariant 1)", () => {
  it("is ok when every bank balance follows from the one before and the bank's balance ends the chain", () => {
    const rows = [row("2026-11-05", -10_000, 90_000), row("2026-11-06", -32_000, 58_000), row("2026-11-08", 5_000, 63_000)];
    expect(bankBalanceCheck(account(rows, 63_000))).toEqual({ amount: 0, since: null });
  });

  it("a lost operation shows as the bank's balance minus ours, from the first operation after it", () => {
    // ₴320 went out on 7 November and never reached the base.
    const rows = [row("2026-11-05", -10_000, 90_000), row("2026-11-08", -5_000, 53_000), row("2026-11-09", -1_000, 52_000)];
    expect(bankBalanceCheck(account(rows, 52_000))).toEqual({ amount: -32_000, since: "2026-11-08" });
  });

  it("a hold the bank dropped and the base kept shows as money the bank has and we do not", () => {
    const rows = [row("2026-11-05", -10_000, 90_000), row("2026-11-06", -20_000, 70_000), row("2026-11-07", -1_000, 89_000)];
    expect(bankBalanceCheck(account(rows, 89_000))).toEqual({ amount: 20_000, since: "2026-11-07" });
  });

  it("a lost last operation shows against the bank's current balance, on the day of that balance", () => {
    const rows = [row("2026-11-05", -10_000, 90_000)];
    expect(bankBalanceCheck(account(rows, 80_000, "2026-11-12"))).toEqual({ amount: -10_000, since: "2026-11-12" });
  });

  it("keeps the date of the first break while the difference stays, and clears it once it is made up", () => {
    const rows = [
      row("2026-11-05", -10_000, 90_000),
      row("2026-11-06", -1_000, 88_000), // −1,000 lost
      row("2026-11-07", -1_000, 86_000), // another −1,000 lost
      row("2026-11-08", -1_000, 85_000),
    ];
    expect(bankBalanceCheck(account(rows, 85_000))).toEqual({ amount: -2_000, since: "2026-11-06" });
    const madeUp = [...rows, row("2026-11-09", -1_000, 86_000)]; // +2,000 the base never saw
    expect(bankBalanceCheck(account(madeUp, 86_000))).toEqual({ amount: 0, since: null });
  });

  it("carries rows without a bank balance (stored before it was kept) and checks at the next known one", () => {
    const rows = [row("2026-11-05", -10_000, 90_000), row("2026-11-06", -5_000, null), row("2026-11-07", -1_000, 84_000)];
    expect(bankBalanceCheck(account(rows, 84_000))).toEqual({ amount: 0, since: null });
    const lost = [row("2026-11-05", -10_000, 90_000), row("2026-11-06", -5_000, null), row("2026-11-07", -1_000, 80_000)];
    expect(bankBalanceCheck(account(lost, 80_000))).toEqual({ amount: -4_000, since: "2026-11-07" });
  });

  it("starts the chain at the first row with a bank balance", () => {
    const rows = [row("2026-11-04", -7_000, null), row("2026-11-05", -10_000, 90_000), row("2026-11-06", -1_000, 89_000)];
    expect(bankBalanceCheck(account(rows, 89_000))).toEqual({ amount: 0, since: null });
  });

  it("orders operations of the same second by their balances, not by id", () => {
    // Two operations at the same second, stored in the other order.
    const second = row("2026-11-06", -2_000, 87_000, 1);
    const first = row("2026-11-06", -1_000, 89_000, 1);
    const rows = [row("2026-11-05", -10_000, 90_000), second, first];
    expect(bankBalanceCheck(account(rows, 87_000))).toEqual({ amount: 0, since: null });
  });

  it("leaves out operations after the moment of the bank's balance", () => {
    const rows = [row("2026-11-05", -10_000, 90_000), row("2026-11-13", -1_000, 89_000)];
    expect(bankBalanceCheck(account(rows, 90_000, "2026-11-12"))).toEqual({ amount: 0, since: null });
  });

  it("cannot say anything without a single bank balance on the rows", () => {
    expect(bankBalanceCheck(account([], 90_000))).toBeNull();
    expect(bankBalanceCheck(account([row("2026-11-05", -10_000, null)], 90_000))).toBeNull();
  });
});

describe("loneLegsCheck (invariant 2)", () => {
  it("counts the legs and names the oldest day", () => {
    expect(loneLegsCheck([])).toEqual({ count: 0, since: null });
    expect(loneLegsCheck(["2026-11-09", "2026-11-03", "2026-11-07"])).toEqual({ count: 3, since: "2026-11-03" });
  });
});

const ctx: LedgerContext = { cashStart: null };
const spend = (localDate: string, amountUah: number, category: string | null = "cafe", over: Partial<LedgerRow> = {}): LedgerRow => ({
  type: "spend",
  accountKind: "black",
  amountUah,
  localDate,
  category,
  ...over,
});

describe("categoriesCheck (invariant 3)", () => {
  it("is ok when every counted row has a category", () => {
    const rows = [spend("2026-11-05", -10_000), spend("2026-11-06", -2_000, "groceries"), spend("2026-11-06", -500, null, { type: "income" })];
    expect(categoriesCheck(rows, ctx)).toEqual({ amount: 0, since: null });
  });

  it("names the spending left out of every category and the first day it is missing", () => {
    const rows = [
      spend("2026-11-05", -10_000),
      spend("2026-11-07", -3_000, null),
      spend("2026-11-09", -1_000, null, { type: "person_transfer" }),
    ];
    expect(categoriesCheck(rows, ctx)).toEqual({ amount: 4_000, since: "2026-11-07" });
  });

  it("counts by the ledger: a jar row or one without a hryvnia amount is not spending", () => {
    const rows = [spend("2026-11-05", -10_000, null, { accountKind: "jar" }), spend("2026-11-06", 0, null, { amountUah: null })];
    expect(categoriesCheck(rows, ctx)).toEqual({ amount: 0, since: null });
  });
});

describe("daySpentCheck (invariant 4)", () => {
  const ref = new Map([
    ["2026-11-05", 10_000],
    ["2026-11-06", 2_000],
  ]);

  it("is ok when every screen's day totals match the ledger, a missing day being zero", () => {
    expect(daySpentCheck(ref, [new Map(ref), new Map([...ref, ["2026-11-07", 0]])])).toEqual({ amount: 0, since: null, days: 0 });
  });

  it("names the first day that differs and the difference that day", () => {
    const other = new Map([
      ["2026-11-05", 10_000],
      ["2026-11-06", 2_500],
      ["2026-11-08", 700],
    ]);
    expect(daySpentCheck(ref, [new Map(ref), other])).toEqual({ amount: 500, since: "2026-11-06", days: 2 });
    expect(daySpentCheck(ref, [new Map([["2026-11-05", 10_000]])])).toEqual({ amount: -2_000, since: "2026-11-06", days: 1 });
  });
});

describe("cashWalletCheck (invariant 7)", () => {
  it("has nothing to check before the wallet starts", () => {
    expect(cashWalletCheck(null, 0, new Map())).toBeNull();
  });

  it("is ok at zero or above, even after a day below zero", () => {
    const changes = new Map([
      ["2026-11-01", 50_000],
      ["2026-11-03", -60_000],
      ["2026-11-04", 20_000],
    ]);
    expect(cashWalletCheck("2026-11-01", 10_000, changes)).toEqual({ amount: 10_000, since: null });
  });

  it("below zero, names the balance and the first day of the stretch below zero", () => {
    const changes = new Map([
      ["2026-11-01", 50_000],
      ["2026-11-03", -60_000],
      ["2026-11-04", 20_000],
      ["2026-11-08", -40_000],
      ["2026-11-09", 5_000],
    ]);
    expect(cashWalletCheck("2026-11-01", -25_000, changes)).toEqual({ amount: -25_000, since: "2026-11-08" });
  });
});
