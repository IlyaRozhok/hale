import { describe, expect, it } from "vitest";
import { goalsLine, incomesLine, installmentGroups, installmentsLine, paymentsLine, taxLine } from "./planSummary";
import { dateLabel, monthGrid, monthTitle } from "./format";

const pay = (over: object) => ({ id: 1, kind: "obligation", name: "Квартира", amount: 100_000, currency: "UAH", due_on: "2026-11-26", paid_at: null, recurring_id: null, tax_quarter: null, is_estimate: false, ...over }) as never;

describe("calendar helpers", () => {
  it("lays a month out from Monday, with blanks before the first", () => {
    const nov = monthGrid(2026, 11); // 1 November 2026 is a Sunday
    expect(nov.slice(0, 7)).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(nov[nov.length - 1]).toBe("2026-11-30");
    expect(monthGrid(2027, 2).filter(Boolean)).toHaveLength(28);
    expect(monthGrid(2028, 2).filter(Boolean)).toHaveLength(29);
  });

  it("names dates and months", () => {
    expect(dateLabel("2026-11-03")).toBe("3 ноября 2026");
    expect(monthTitle(2026, 11)).toBe("Ноябрь 2026");
  });
});

describe("incomes line", () => {
  const expected = [{ id: 1, source: "usdc", amount: 80_000, currency: "USD", window_start_day: 1, window_end_day: 5 }, { id: 2, source: "fop", amount: 1_000_000, currency: "UAH", window_start_day: 25, window_end_day: 25 }] as never[];
  const event = (id: number, expected_income_id: number, expected_on: string, status = "expected") => ({ id, expected_income_id, period: expected_on.slice(0, 7), expected_on, status }) as never;

  it("names the next income not yet received", () => {
    expect(incomesLine(expected, [event(1, 1, "2026-11-05", "received"), event(2, 2, "2026-11-25"), event(3, 1, "2026-12-05")])).toBe("следующий 25.11, ₴10,000");
    expect(incomesLine(expected, [event(3, 1, "2026-12-05")])).toBe("следующий 05.12, $800");
  });

  it("says when nothing is expected", () => {
    expect(incomesLine([], [])).toBe("не указаны");
  });
});

describe("payments line", () => {
  it("names the nearest unpaid obligation, of any origin", () => {
    expect(paymentsLine([pay({ due_on: "2026-12-05", amount: 1 }), pay({ due_on: "2026-11-26" }), pay({ due_on: "2026-11-01", paid_at: "x" }), pay({ kind: "tax", due_on: "2026-11-02" })])).toBe("ближайший 26.11, ₴1,000");
  });
  it("says when there are none", () => {
    expect(paymentsLine([pay({ paid_at: "x" })])).toBe("нет");
  });
});

describe("installments", () => {
  const list = [
    pay({ kind: "installment", name: "Телефон", due_on: "2026-12-02", amount: 200_000 }),
    pay({ kind: "installment", name: "Телефон", due_on: "2026-11-02", amount: 200_000 }),
    pay({ kind: "installment", name: "Телефон", due_on: "2026-10-02", amount: 200_000, paid_at: "x" }),
    pay({ kind: "installment", name: "Ноутбук", due_on: "2026-11-20", amount: 500, currency: "USD" }),
    pay({ kind: "installment", name: "Закрытая", paid_at: "x" }),
  ];

  it("groups what is still to pay by name, nearest first", () => {
    expect(installmentGroups(list)).toEqual([
      { name: "Телефон", amount: 200_000, currency: "UAH", left: 2, nextDue: "2026-11-02", total: 400_000 },
      { name: "Ноутбук", amount: 500, currency: "USD", left: 1, nextDue: "2026-11-20", total: 500 },
    ]);
  });

  it("sums what is left in hryvnias, a foreign amount at the rate", () => {
    expect(installmentsLine(list, 40)).toBe("осталось ₴4,200");
    expect(installmentsLine([], 40)).toBe("нет");
  });

  it("says nothing while a dollar series has no rate to count it at", () => {
    expect(installmentsLine(list, undefined)).toBeUndefined();
    expect(installmentsLine(list, 0)).toBeUndefined();
    expect(installmentsLine(list.slice(3, 4), undefined)).toBeUndefined();
  });

  it("needs no rate for hryvnia series, and none to say there is nothing", () => {
    expect(installmentsLine(list.slice(0, 3), undefined)).toBe("осталось ₴4,000");
    expect(installmentsLine([], undefined)).toBe("нет");
  });
});

describe("tax line", () => {
  it("sums what is unpaid, with the nearest date", () => {
    expect(taxLine([pay({ kind: "tax", due_on: "2026-11-20", amount: 100_000 }), pay({ kind: "tax", due_on: "2027-02-20", amount: 50_000 }), pay({ kind: "tax", paid_at: "x" }), pay({})])).toBe("₴1,500, ближайший 20.11");
    expect(taxLine([])).toBe("нет");
  });
});

describe("goals line", () => {
  it("sums what is saved of the targets", () => {
    expect(goalsLine([{ id: 1, name: "a", saved_cents: 50_000, target_cents: 500_000, sort: 0 }, { id: 2, name: "b", saved_cents: 0, target_cents: 100_000, sort: 1 }])).toBe("$500 из $6,000");
    expect(goalsLine([])).toBe("нет");
  });
});
