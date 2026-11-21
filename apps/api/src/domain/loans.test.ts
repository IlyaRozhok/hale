import { describe, expect, it } from "vitest";
import { lastIncomeBoundary, loanReserve, type LoanReserveInput, type OpenLoan, type ReceivedIncome } from "./loans.js";

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

  // Б47 (1), option А: the income day is inside the window, as for a payment; the day after it is not.
  it("the date the income comes is inside the window, as for a payment", () => {
    expect(reserve([manual({ dueOn: "2026-11-12" })]).due).toBe(100_000);
    expect(reserve([manual({ dueOn: "2026-11-13" })]).due).toBe(0);
  });

  it("an overdue loan is reserved, and a repaid part is not", () => {
    const r = reserve([manual({ dueOn: "2026-10-30", remaining: 40_000 })]);
    expect(r).toMatchObject({ borrowed: 0, due: 40_000 });
  });

  it("with no income date the window is 30 days", () => {
    expect(reserve([manual({ dueOn: "2026-11-30" }), short({ dueOn: "2026-12-05" })], { nextIncomeOn: null }).due).toBe(100_000);
  });

  // The finding on PR #93 still holds (a loan is named only while it is reserved); since Б47 (1) such a loan is both.
  it("on the day the income comes, a loan due that day is reserved and named as due", () => {
    const r = reserve([manual({ receivedOn: "2026-11-01", dueOn: "2026-11-12" })], { today: "2026-11-12", lastIncomeOn: "2026-10-12", nextIncomeOn: "2026-11-12" });
    expect(r).toMatchObject({ borrowed: 0, due: 100_000, dueNow: [expect.objectContaining({ id: 1 })] });
    expect(r.counted.map((l) => l.id)).toEqual([1]);
    // An overdue one is reserved on that day too, so it is still named.
    const late = reserve([manual({ receivedOn: "2026-11-01", dueOn: "2026-11-10" })], { today: "2026-11-12", lastIncomeOn: "2026-10-12", nextIncomeOn: "2026-11-12" });
    expect(late).toMatchObject({ due: 100_000, dueNow: [expect.objectContaining({ id: 1 })] });
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

describe("lastIncomeBoundary: which received income closes the loan cycle (Б33)", () => {
  const ev = (o: Partial<ReceivedIncome> = {}): ReceivedIncome => ({
    paysFopTax: true, receivedOn: "2026-11-06", amountUah: 200_000, expectedAmount: 5_000_000, currency: "UAH", byBank: true, ...o,
  });
  const october = ev({ receivedOn: "2026-10-20", amountUah: 5_000_000 });

  it("a fop income below half the expected amount does not move the boundary", () => {
    expect(lastIncomeBoundary([october, ev()], {})).toBe("2026-10-20");
  });

  it("once the month's fop income reaches half, its day is the boundary", () => {
    expect(lastIncomeBoundary([october, ev({ amountUah: 2_500_000 })], {})).toBe("2026-11-06");
  });

  it("a foreign expected amount is compared at the rate; without a rate the event is ignored", () => {
    const usd = ev({ expectedAmount: 500_000, currency: "USD", amountUah: 10_000_000 }); // $5,000; half at 40 = ₴100,000
    expect(lastIncomeBoundary([october, usd], { USD: 40 })).toBe("2026-11-06");
    expect(lastIncomeBoundary([october, usd], { USD: 41 })).toBe("2026-10-20");
    expect(lastIncomeBoundary([october, usd], {})).toBe("2026-10-20");
  });

  it("a fop income confirmed by hand and a USDC income count as before, whatever their amount", () => {
    expect(lastIncomeBoundary([october, ev({ byBank: false, amountUah: null })], {})).toBe("2026-11-06");
    expect(lastIncomeBoundary([october, ev({ paysFopTax: false, amountUah: null, byBank: false })], {})).toBe("2026-11-06");
  });

  it("is null with nothing received, and skips an event with no day", () => {
    expect(lastIncomeBoundary([], {})).toBeNull();
    expect(lastIncomeBoundary([ev({ receivedOn: null, byBank: false })], {})).toBeNull();
  });
});
