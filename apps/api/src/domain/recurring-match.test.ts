import { describe, expect, it } from "vitest";
import {
  type PayableTx,
  type Payment,
  MAX_PAID_QUESTIONS,
  PAID_QUESTION_DAYS,
  TAX_ESTIMATE_TOLERANCE,
  TAX_EXACT_TOLERANCE,
  TAX_WINDOW_DAYS,
  matchPayment,
  matchTaxPayment,
  matchTaxShare,
  monthlyEvents,
  monthlyDueDates,
  paidQuestions,
  taxTolerance,
} from "./recurring-match";

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
  it("leaves a row that already has operations linked to it to the shared path", () => {
    expect(matchTaxPayment(paying(), [row({ linked: 40_000 })])).toBeNull();
  });
});

describe("matchPayment and linked rows", () => {
  it("never settles a payment that already has operations linked to it", () => {
    expect(matchPayment(tx(), [pay({ linked: 100 })])).toBeNull();
  });
});

describe("matchTaxShare", () => {
  // A Q3 row due 20 November: ESV and single tax as the owner pays them.
  const row = (over: Partial<Payment> = {}) =>
    pay({ kind: "tax", name: "Q3", amount: 795_000, due_on: "2026-11-20", tax_quarter: "2026-Q3", is_estimate: false, linked: 0, ...over });
  const paying = (amount: number, over: Partial<Parameters<typeof matchPayment>[0]> = {}) =>
    tx({ id: 10, type: "tax", amount: -amount, amountUah: -amount, localDate: "2026-11-14", ...over });

  it("has the tolerances proposed to the owner", () => {
    expect(TAX_EXACT_TOLERANCE).toBe(2_000);
    expect(TAX_ESTIMATE_TOLERANCE).toBe(0.1);
    expect(TAX_WINDOW_DAYS).toBe(30);
    expect(taxTolerance(row())).toBe(2_000);
    expect(taxTolerance(row({ is_estimate: true, amount: 760_000 }))).toBe(76_000);
  });

  it("links the first of two payments without closing, and the second closes", () => {
    const r = row();
    expect(matchTaxShare(paying(571_000), [r], [])).toEqual({ payment: r, ids: [10], closes: false, release: false });
    const after = row({ linked: 571_000 });
    expect(matchTaxShare(paying(224_000, { id: 11 }), [after], [])).toEqual({ payment: after, ids: [11], closes: true, release: false });
  });

  it("links a pair at once when the other payment came first and nothing was linked yet", () => {
    const r = row();
    const earlier = paying(571_000, { id: 9, localDate: "2026-11-13" });
    const res = matchTaxShare(paying(224_000), [r], [earlier]);
    expect(res).toMatchObject({ payment: r, closes: true });
    expect([...res!.ids].sort((a, b) => a - b)).toEqual([9, 10]);
  });

  it("closes an estimate with one payment within 10%, and not beyond", () => {
    const est = row({ amount: 760_000, is_estimate: true });
    expect(matchTaxShare(paying(795_000), [est], [])).toMatchObject({ payment: est, closes: true });
    expect(matchTaxShare(paying(684_000), [est], [])).toMatchObject({ payment: est, closes: true });
    expect(matchTaxShare(paying(837_000), [est], [])).toBeNull();
  });

  it("closes a real row with one payment within ₴20, and not beyond", () => {
    const esv = row({ amount: 570_702 });
    expect(matchTaxShare(paying(571_000), [esv], [])).toMatchObject({ payment: esv, closes: true });
    expect(matchTaxShare(paying(573_000), [esv], [])).toBeNull();
  });

  it("a payment far above the row does not close it; far below only links", () => {
    expect(matchTaxShare(paying(2_000_000), [row()], [])).toBeNull();
    expect(matchTaxShare(paying(100_000), [row()], [])).toMatchObject({ closes: false });
  });

  it("a payment from before the quarter ended, or long after the due date, is not for the row", () => {
    expect(matchTaxShare(paying(795_000, { localDate: "2026-09-30" }), [row()], [])).toBeNull();
    expect(matchTaxShare(paying(795_000, { localDate: "2026-12-21" }), [row()], [])).toBeNull();
    expect(matchTaxShare(paying(795_000, { localDate: "2026-12-20" }), [row()], [])).not.toBeNull();
    // A pair partner from before the quarter ended does not count either.
    expect(matchTaxShare(paying(224_000, { localDate: "2026-11-14" }), [row({ paid_at: "2026-11-14" })], [paying(571_000, { id: 9, localDate: "2026-09-29" })])).toBeNull();
  });

  it("a closed row takes no more: the next payment goes to the next open row", () => {
    const closed = row({ id: 1, paid_at: "2026-11-14", linked: 795_000 });
    const next = row({ id: 2, amount: 300_000, due_on: "2026-11-25" });
    expect(matchTaxShare(paying(100_000), [closed, next], [])).toMatchObject({ payment: next, closes: false });
  });

  it("leftovers never go to the next quarter's row", () => {
    const q4 = row({ id: 2, due_on: "2027-02-20", tax_quarter: "2026-Q4" });
    expect(matchTaxShare(paying(100_000), [q4], [])).toBeNull();
    expect(matchTaxShare(paying(795_000), [q4], [])).toBeNull();
  });

  it("a row the owner marked paid takes a payment or a pair that adds up, never a lone part", () => {
    const hand = row({ paid_at: "2026-11-14" });
    expect(matchTaxShare(paying(795_500), [hand], [])).toEqual({ payment: hand, ids: [10], closes: false, release: false });
    expect(matchTaxShare(paying(224_000), [hand], [])).toBeNull();
    const res = matchTaxShare(paying(224_000), [hand], [paying(571_000, { id: 9 })]);
    expect(res).toMatchObject({ payment: hand, closes: false });
    expect([...res!.ids].sort((a, b) => a - b)).toEqual([9, 10]);
  });

  it("prefers a row the payment fits over linking a part to an earlier row", () => {
    const esv = row({ id: 1, amount: 570_702 });
    const tax = row({ id: 2, amount: 224_000 });
    expect(matchTaxShare(paying(224_000), [esv, tax], [])).toMatchObject({ payment: tax, closes: true });
  });

  it("a payment that fits the row alone takes it from a guessed part, which is let go", () => {
    const r = row({ linked: 190_000 });
    expect(matchTaxShare(paying(795_000), [r], [])).toEqual({ payment: r, ids: [10], closes: true, release: true });
  });

  it("ignores rows in another currency, non-tax rows, incoming and non-tax payments", () => {
    expect(matchTaxShare(paying(795_000), [row({ currency: "USD" })], [])).toBeNull();
    expect(matchTaxShare(paying(795_000), [row({ kind: "obligation" })], [])).toBeNull();
    expect(matchTaxShare(paying(795_000), [row({ transaction_id: 3 })], [])).toBeNull();
    expect(matchTaxShare(paying(-795_000), [row()], [])).toBeNull();
    expect(matchTaxShare(paying(795_000, { type: "spend" }), [row()], [])).toBeNull();
  });
});

describe("paidQuestions", () => {
  const TODAY = "2026-11-20";
  // Rent due 20 days ago, unpaid; a transfer of its amount went out the day before it was due.
  const rent = (over: Partial<Payment> = {}): Payment => pay({ id: 1, kind: "obligation", name: "Аренда", amount: 1_700_000, due_on: "2026-10-31", ...over });
  const out = (id: number, over: Partial<PayableTx> = {}): PayableTx => ({
    id,
    type: "person_transfer",
    amount: -1_700_000,
    currency: "UAH",
    amountUah: -1_700_000,
    localDate: "2026-10-30",
    text: "Іван П.",
    ...over,
  });
  const ask = (payments: Payment[], candidates: Record<number, PayableTx[]>, dismissed: string[] = [], today = TODAY, rates = {}) =>
    paidQuestions(payments, new Map(Object.entries(candidates).map(([k, v]) => [Number(k), v])), new Set(dismissed), today, rates).map(
      (q) => [q.payment.id, q.tx.id],
    );

  it("asks about a payment unpaid more than two weeks with an operation of its amount", () => {
    expect(PAID_QUESTION_DAYS).toBe(14);
    expect(ask([rent()], { 1: [out(10)] })).toEqual([[1, 10]]);
  });

  it("waits until the payment is more than 14 days overdue", () => {
    expect(ask([rent({ due_on: "2026-11-10" })], { 1: [out(10)] })).toEqual([]);
    expect(ask([rent({ due_on: "2026-11-06" })], { 1: [out(10)] })).toEqual([]);
    expect(ask([rent({ due_on: "2026-11-05" })], { 1: [out(10)] })).toEqual([[1, 10]]);
  });

  it("needs the payment's amount: a different sum is not a question", () => {
    expect(ask([rent()], { 1: [out(10, { amount: -1_600_000, amountUah: -1_600_000 })] })).toEqual([]);
  });

  it("takes a hryvnia debit within 5% of a foreign-currency payment, as matching does", () => {
    const usd = rent({ currency: "USD", amount: 40_000 });
    const near = out(10, { amount: -1_680_000, amountUah: -1_680_000 });
    expect(ask([usd], { 1: [near] }, [], TODAY, { USD: 41.5 })).toEqual([[1, 10]]);
    expect(ask([usd], { 1: [near] }, [], TODAY, { USD: 45 })).toEqual([]);
    expect(ask([usd], { 1: [near] })).toEqual([]);
  });

  it("leaves out taxes, paid and linked payments, own transfers and incoming rows", () => {
    expect(ask([rent({ kind: "tax" })], { 1: [out(10)] })).toEqual([]);
    expect(ask([rent({ paid_at: "2026-11-01" })], { 1: [out(10)] })).toEqual([]);
    expect(ask([rent({ transaction_id: 5 })], { 1: [out(10)] })).toEqual([]);
    expect(ask([rent({ linked: 100 })], { 1: [out(10)] })).toEqual([]);
    expect(ask([rent()], { 1: [out(10, { type: "own_transfer" })] })).toEqual([]);
    expect(ask([rent()], { 1: [out(10, { amount: 1_700_000, amountUah: 1_700_000 })] })).toEqual([]);
    expect(ask([rent()], {})).toEqual([]);
  });

  it("does not ask again about a pair the owner said no to, and offers the next operation instead", () => {
    const later = out(11, { localDate: "2026-11-03" });
    expect(ask([rent()], { 1: [out(10), later] }, ["1:10"])).toEqual([[1, 11]]);
    expect(ask([rent()], { 1: [out(10)] }, ["1:10"])).toEqual([]);
    expect(ask([rent()], { 1: [out(10)] }, ["2:10"])).toEqual([[1, 10]]);
  });

  it("picks the closest amount, then the closest date to the due date", () => {
    const usd = rent({ currency: "USD", amount: 40_000 });
    const closer = out(10, { amount: -1_662_000, amountUah: -1_662_000 });
    const farther = out(11, { amount: -1_690_000, amountUah: -1_690_000 });
    expect(ask([usd], { 1: [farther, closer] }, [], TODAY, { USD: 41.5 })).toEqual([[1, 10]]);
    const early = out(12, { localDate: "2026-10-25" });
    const onTime = out(13, { localDate: "2026-11-01" });
    expect(ask([rent()], { 1: [early, onTime] })).toEqual([[1, 13]]);
  });

  it("asks one question per payment, offers an operation once, oldest due first, two at most", () => {
    expect(MAX_PAID_QUESTIONS).toBe(2);
    const a = rent({ id: 1, due_on: "2026-10-31" });
    const b = rent({ id: 2, due_on: "2026-09-30" });
    const c = rent({ id: 3, due_on: "2026-10-15" });
    const shared = out(10);
    expect(ask([a, b, c], { 1: [shared], 2: [shared, out(11)], 3: [out(12)] })).toEqual([[2, 10], [3, 12]]);
    expect(ask([a, b], { 1: [shared], 2: [shared] })).toEqual([[2, 10]]);
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
