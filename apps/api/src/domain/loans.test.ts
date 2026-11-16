import { describe, expect, it } from "vitest";
import { loanReserve, type LoanReserveInput, type OpenLoan } from "./loans.js";

// Today is 2 November; the last income came on 20 October, the next is expected on 12 November.
const base: Omit<LoanReserveInput, "loans"> = { today: "2026-11-02", trackingStart: "2026-01-01", lastIncomeOn: "2026-10-20", nextIncomeOn: "2026-11-12" };

const manual = (o: Partial<OpenLoan> = {}): OpenLoan => ({ id: 1, remaining: 100_000, receivedOn: "2026-10-05", dueOn: null, kind: "other", manual: true, ...o });
const short = (o: Partial<OpenLoan> = {}): OpenLoan => manual({ id: 2, kind: "short", manual: false, ...o });
const monthly = (o: Partial<OpenLoan> = {}): OpenLoan => manual({ id: 3, kind: "other", manual: false, ...o });

const reserve = (loans: OpenLoan[], o: Partial<typeof base> = {}) => loanReserve({ ...base, ...o, loans });

describe("loanReserve: loans with no return date", () => {
  it("a loan from a person taken before the last income is still owed in full", () => {
    const r = reserve([manual()]);
    expect(r).toMatchObject({ borrowed: 100_000, due: 0 });
    expect(r.counted.map((l) => l.id)).toEqual([1]);
  });

  it("a short bank loan taken before the last income is still owed until repaid", () => {
    expect(reserve([short()])).toMatchObject({ borrowed: 100_000, due: 0 });
  });

  it("a monthly bank loan counts only in the cycle it arrived, as before", () => {
    expect(reserve([monthly()])).toMatchObject({ borrowed: 0, due: 0, counted: [] });
    expect(reserve([monthly({ receivedOn: "2026-10-25" })])).toMatchObject({ borrowed: 100_000 });
  });

  it("with no income received yet, every tracked loan counts", () => {
    expect(reserve([manual(), short(), monthly()], { lastIncomeOn: null }).borrowed).toBe(300_000);
  });

  it("a loan taken before tracking began is history, with or without a date", () => {
    const old = { receivedOn: "2025-12-10" };
    const r = reserve([manual(old), short(old), monthly({ ...old, dueOn: "2026-11-05" })], { trackingStart: "2026-11-01", lastIncomeOn: null });
    expect(r).toMatchObject({ borrowed: 0, due: 0, counted: [], dueNow: [] });
  });

  it("only what is still owed counts: a repaid part is not", () => {
    expect(reserve([manual({ remaining: 60_000 }), short({ remaining: 0 })])).toMatchObject({ borrowed: 60_000, counted: [expect.objectContaining({ id: 1 })] });
  });
});

describe("loanReserve: loans with a return date behave as a payment on that date", () => {
  it("a date before the next income reserves what is owed, whatever the kind and the cycle", () => {
    const dueOn = "2026-11-10";
    const r = reserve([manual({ dueOn }), short({ dueOn }), monthly({ dueOn })]);
    expect(r).toMatchObject({ borrowed: 0, due: 300_000 });
    expect(r.counted.map((l) => l.id)).toEqual([1, 2, 3]);
  });

  it("a date after the next income does not lower today's money, even for a loan from a person", () => {
    const r = reserve([manual({ dueOn: "2026-11-20" }), short({ dueOn: "2026-12-01" })]);
    expect(r).toMatchObject({ borrowed: 0, due: 0, counted: [] });
  });

  it("the date the income comes is after the window, as for a payment", () => {
    expect(reserve([manual({ dueOn: "2026-11-12" })]).due).toBe(0);
  });

  it("an overdue loan is reserved, and a repaid part is not", () => {
    const r = reserve([manual({ dueOn: "2026-10-30", remaining: 40_000 })]);
    expect(r).toMatchObject({ borrowed: 0, due: 40_000 });
  });

  it("with no income date the window is 30 days", () => {
    expect(reserve([manual({ dueOn: "2026-11-30" }), short({ dueOn: "2026-12-05" })], { nextIncomeOn: null }).due).toBe(100_000);
  });

  it("names the loans due today or overdue, oldest date first", () => {
    const r = reserve([
      manual({ id: 1, dueOn: "2026-11-02" }),
      short({ id: 2, dueOn: "2026-10-28" }),
      monthly({ id: 3, dueOn: "2026-11-03" }),
      manual({ id: 4, dueOn: null }),
    ]);
    expect(r.dueNow.map((l) => l.id)).toEqual([2, 1]);
  });
});
