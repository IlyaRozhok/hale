import { describe, expect, it } from "vitest";
import { type Payment, matchPayment, matchTaxPayment, monthlyEvents, monthlyDueDates } from "./recurring-match";

const pay = (over: Partial<Payment> = {}): Payment => ({
  id: 1,
  kind: "installment",
  name: "Store installment",
  amount: 529_500,
  currency: "UAH",
  due_on: "2026-11-18",
  paid_at: null,
  transaction_id: null,
  match_hint: null,
  ...over,
});
const tx = (over: Partial<Parameters<typeof matchPayment>[0]> = {}) => ({
  id: 10,
  type: "debt_payment",
  amount: -529_500,
  currency: "UAH",
  amountUah: -529_500,
  localDate: "2026-11-18",
  text: "Payment skay.ua",
  ...over,
});

describe("matchPayment", () => {
  it("finds the payment with the exact amount within three days", () => {
    const p = pay();
    expect(matchPayment(tx({ localDate: "2026-11-21" }), [p])).toBe(p);
    expect(matchPayment(tx({ localDate: "2026-11-15" }), [p])).toBe(p);
  });

  it("does not match outside the window or with a different amount", () => {
    expect(matchPayment(tx({ localDate: "2026-11-22" }), [pay()])).toBeNull();
    expect(matchPayment(tx({ amount: -529_400, amountUah: -529_400 }), [pay()])).toBeNull();
  });

  it("matches a different amount when match_hint is in the text", () => {
    const p = pay({ match_hint: "skay" });
    expect(matchPayment(tx({ amount: -1, amountUah: -1 }), [p])).toBe(p);
    expect(matchPayment(tx({ amount: -1, amountUah: -1, text: "Coffee" }), [p])).toBeNull();
  });

  it("never returns an already paid or already linked payment", () => {
    expect(matchPayment(tx(), [pay({ paid_at: new Date() })])).toBeNull();
    expect(matchPayment(tx(), [pay({ transaction_id: 3 })])).toBeNull();
  });

  it("only matches the payment kind that fits the type, and only money out", () => {
    expect(matchPayment(tx({ type: "person_in" }), [pay()])).toBeNull();
    expect(matchPayment(tx({ type: "tax" }), [pay()])).toBeNull();
    expect(matchPayment(tx({ amount: 529_500, amountUah: 529_500 }), [pay()])).toBeNull();
  });

  it("lets a spend-typed row settle an installment by exact amount or hint, within three days only", () => {
    const p = pay();
    expect(matchPayment(tx({ type: "spend" }), [p])).toBe(p);
    expect(matchPayment(tx({ type: "spend", amount: -1, amountUah: -1 }), [pay({ match_hint: "skay" })])).not.toBeNull();
    expect(matchPayment(tx({ type: "spend", localDate: "2026-11-25" }), [p])).toBeNull();
    expect(matchPayment(tx({ type: "spend" }), [pay({ kind: "obligation" })])).toBeNull();
  });

  it("picks the nearest due date when two payments fit", () => {
    const a = pay({ id: 1, due_on: "2026-11-16" });
    const b = pay({ id: 2, due_on: "2026-11-19" });
    expect(matchPayment(tx(), [a, b])).toBe(b);
  });

  const usd = (over: Partial<Payment> = {}) =>
    pay({ kind: "obligation", amount: 80_000, currency: "USD", due_on: "2026-11-05", ...over });
  const uahOut = (uah: number, over: Partial<Parameters<typeof matchPayment>[0]> = {}) =>
    tx({ type: "obligation", amount: -uah, amountUah: -uah, localDate: "2026-11-20", text: "Transfer", ...over });

  it("closes a USD obligation with a UAH debit within 5% at the current rate, same month", () => {
    const p = usd();
    const rates = { USD: 40 }; // 80_000 cents -> 3_200_000 kopecks
    expect(matchPayment(uahOut(3_300_000), [p], rates)).toBe(p);
    expect(matchPayment(uahOut(3_040_000), [p], rates)).toBe(p);
    expect(matchPayment(uahOut(3_400_000), [p], rates)).toBeNull();
    expect(matchPayment(uahOut(3_300_000), [p], {})).toBeNull();
    expect(matchPayment(uahOut(3_300_000, { type: "spend" }), [p], rates)).toBeNull();
    expect(matchPayment(uahOut(3_300_000, { localDate: "2026-12-20" }), [p], rates)).toBeNull();
  });

  it("a hint alone closes only within three days and needs three characters", () => {
    const p = usd({ match_hint: "partner" });
    expect(matchPayment(uahOut(1_000, { localDate: "2026-11-07", text: "Partner" }), [p])).toBe(p);
    expect(matchPayment(uahOut(1_000, { localDate: "2026-11-15", text: "Partner" }), [p])).toBeNull();
    const short = usd({ match_hint: "pa" });
    expect(matchPayment(uahOut(1_000, { localDate: "2026-11-07", text: "pa" }), [short])).toBeNull();
  });

  it("same month needs the amount: an unrelated same-month row does not close an obligation", () => {
    const rent = pay({ kind: "obligation", amount: 1_700_000, due_on: "2026-11-05" });
    expect(matchPayment(uahOut(1_700_000, { type: "spend" }), [rent])).toBeNull();
    expect(matchPayment(uahOut(1_700_000), [rent])).toBe(rent);
    expect(matchPayment(uahOut(1_700_001), [rent])).toBeNull();
  });

  it("matches a USD payment by its own-currency amount when currencies are equal", () => {
    const p = usd();
    const t = tx({ type: "obligation", amount: -80_000, currency: "USD", amountUah: -3_500_000, localDate: "2026-11-05" });
    expect(matchPayment(t, [p])).toBe(p);
  });
});

describe("matchTaxPayment", () => {
  const row = (over: Partial<Payment> = {}) =>
    pay({ kind: "tax", amount: 100_000, due_on: "2026-11-20", tax_quarter: "2026-Q3", ...over });
  const paying = (over: Partial<Parameters<typeof matchPayment>[0]> = {}) =>
    tx({ type: "tax", amount: -100_000, amountUah: -100_000, localDate: "2026-10-19", ...over });

  it("takes a row with the exact amount whatever the date or the paid mark", () => {
    const unpaid = row();
    const paid = row({ paid_at: "2026-11-20" });
    expect(matchTaxPayment(paying(), [unpaid])).toBe(unpaid);
    expect(matchTaxPayment(paying(), [paid])).toBe(paid);
    expect(matchTaxPayment(paying({ localDate: "2027-03-01" }), [paid])).toBe(paid);
  });
  it("never takes another amount, an already linked row, a non-tax row or an incoming payment", () => {
    expect(matchTaxPayment(paying({ amount: -100_001, amountUah: -100_001 }), [row()])).toBeNull();
    expect(matchTaxPayment(paying(), [row({ transaction_id: 5 })])).toBeNull();
    expect(matchTaxPayment(paying(), [row({ kind: "obligation" })])).toBeNull();
    expect(matchTaxPayment(paying({ type: "spend" }), [row()])).toBeNull();
    expect(matchTaxPayment(paying({ amount: 100_000 }), [row()])).toBeNull();
  });
  it("does not let a payment from before the quarter ended close the row", () => {
    expect(matchTaxPayment(paying({ localDate: "2026-07-15" }), [row()])).toBeNull();
    expect(matchTaxPayment(paying({ localDate: "2026-09-30" }), [row()])).toBeNull();
    expect(matchTaxPayment(paying({ localDate: "2026-10-01" }), [row()])).not.toBeNull();
    // A row with no quarter is judged by the quarter before its due date.
    expect(matchTaxPayment(paying({ localDate: "2026-09-30" }), [row({ tax_quarter: null })])).toBeNull();
    expect(matchTaxPayment(paying({ localDate: "2026-10-01" }), [row({ tax_quarter: null })])).not.toBeNull();
  });
  it("takes the nearest due date, and an unpaid row on a tie", () => {
    const q3 = row({ id: 1, paid_at: "2026-11-20" });
    const q4 = row({ id: 2, due_on: "2027-02-20", tax_quarter: "2026-Q4" });
    expect(matchTaxPayment(paying({ localDate: "2027-01-20" }), [q3, q4])).toBe(q4);
    const a = row({ id: 3, paid_at: "2026-11-20" });
    const b = row({ id: 4 });
    expect(matchTaxPayment(paying(), [a, b])).toBe(b);
    expect(matchTaxPayment(paying(), [b, a])).toBe(b);
  });
});

describe("monthlyDueDates", () => {
  it("gives this and next month, clamping to the month length", () => {
    expect(monthlyDueDates(31, "2027-01-15")).toEqual(["2027-01-31", "2027-02-28"]);
    expect(monthlyDueDates(30, "2028-02-01")).toEqual(["2028-02-29", "2028-03-30"]);
    expect(monthlyDueDates(6, "2026-12-30")).toEqual(["2026-12-06", "2027-01-06"]);
  });
});

describe("monthlyEvents", () => {
  const expected = [
    { id: 1, source: "usdc" as const, window_start_day: 15, window_end_day: 25 },
    { id: 2, source: "fop" as const, window_start_day: 15, window_end_day: 25 },
  ];

  it("makes one event per source for this and next month, dated the 25th", () => {
    const ev = monthlyEvents(expected, "2026-11-02");
    expect(ev).toEqual([
      { expected_income_id: 1, period: "2026-11", expected_on: "2026-11-25", status: "expected" },
      { expected_income_id: 2, period: "2026-11", expected_on: "2026-11-25", status: "expected" },
      { expected_income_id: 1, period: "2026-12", expected_on: "2026-12-25", status: "expected" },
      { expected_income_id: 2, period: "2026-12", expected_on: "2026-12-25", status: "expected" },
    ]);
  });

  it("rolls over the year and clamps to the month length", () => {
    const ev = monthlyEvents([{ id: 1, source: "usdc", window_start_day: 15, window_end_day: 25 }], "2026-12-30");
    expect(ev.map((e) => e.period)).toEqual(["2026-12", "2027-01"]);
    const feb = monthlyEvents([{ id: 1, source: "usdc", window_start_day: 15, window_end_day: 31 }], "2027-02-01", 31);
    expect(feb[0]!.expected_on).toBe("2027-02-28");
  });
});
