import { describe, expect, it } from "vitest";
import type { ExpectedIncomeDto, OwnMoneyItemDto } from "@hale/contracts";
import { hasNamedIncomes, incomeDetail, incomePlaces, incomeOnDay, incomeWhen, installmentGroups, nextIncomeLine, paymentsCount, taxesShown, unpaidTaxCount } from "./planSummary";
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

describe("incomes, named (Д3б)", () => {
  const fop: ExpectedIncomeDto = {
    id: 1, source: "fop", amount: 500_000, currency: "USD", window_start_day: 1, window_end_day: 5, name: "ФОП", schedule: "monthly",
    second_day: null, pays_fop_tax: true, crypto: false, account: { source: "account", id: 4 },
  };
  const usdc: ExpectedIncomeDto = {
    ...fop, id: 2, source: "usdc", amount: 120_000, name: "USDC", window_start_day: 20, window_end_day: 20, pays_fop_tax: false, crypto: true,
    account: { source: "manual", id: 7 },
  };
  const places: OwnMoneyItemDto[] = [
    { kind: "fop", name: "ФОП", own: 0, source: "account", id: 4 },
    { kind: "white", name: "Белая карта", own: 0, source: "account", id: 5 },
    { kind: "cash", name: "Наличные", own: 0, source: "cash" },
    { kind: "binance", name: "Binance", own: 0, source: "manual", id: 7 },
    { kind: "black", name: "Чёрная карта", own: 0 },
  ];

  it("says when an income comes: a window, a day, two days, or no schedule", () => {
    expect(incomeWhen(fop)).toBe("1–5 числа");
    expect(incomeWhen(usdc)).toBe("20-го");
    expect(incomeWhen({ ...fop, schedule: "twice", window_start_day: 5, window_end_day: 5, second_day: 20 })).toBe("5-го и 20-го");
    expect(incomeWhen({ ...fop, schedule: "none" })).toBe("без расписания");
    // An older server has no schedule: its window, as before.
    expect(incomeWhen({ ...fop, schedule: undefined })).toBe("1–5 числа");
  });

  it("offers the places money lies that an income can come to, as «Сегодня» lists them", () => {
    expect(incomePlaces(places).map((p) => [p.name, p.account])).toEqual([
      ["ФОП", { source: "account", id: 4 }],
      ["Белая карта", { source: "account", id: 5 }],
      ["Наличные", { source: "cash" }],
      ["Binance", { source: "manual", id: 7 }],
    ]);
  });

  it("describes a row: amount, when, and where it comes", () => {
    expect(incomeDetail(fop, places)).toBe("$5,000 · 1–5 числа · на счёт ФОП");
    expect(incomeDetail(usdc, places)).toBe("$1,200 · 20-го · на Binance");
    expect(incomeDetail({ ...fop, account: { source: "cash" } }, places)).toBe("$5,000 · 1–5 числа · наличными");
    // No account, an account not in the list, or an older server: no third part.
    expect(incomeDetail({ ...fop, account: null }, places)).toBe("$5,000 · 1–5 числа");
    expect(incomeDetail({ ...fop, account: { source: "account", id: 99 } }, places)).toBe("$5,000 · 1–5 числа");
    expect(incomeDetail({ ...fop, account: undefined }, [])).toBe("$5,000 · 1–5 числа");
  });

  it("names the next income under the list", () => {
    const ev = (id: number, expected_income_id: number, expected_on: string) => ({ id, expected_income_id, period: expected_on.slice(0, 7), expected_on, status: "expected" });
    expect(nextIncomeLine([fop, usdc], [ev(1, 2, "2026-11-20"), ev(2, 1, "2026-12-01")])).toBe("Следующий — 20.11, $1,200.");
    expect(nextIncomeLine([fop], [])).toBeNull();
  });

  it("knows an older server by incomes without names", () => {
    expect(hasNamedIncomes([fop, usdc])).toBe(true);
    expect(hasNamedIncomes([{ ...fop, name: undefined }])).toBe(false);
    expect(hasNamedIncomes([])).toBe(true);
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
});

describe("whether «Налоги» is shown (Д4)", () => {
  it("is hidden only when the server says there are no taxes and no tax payment is unpaid", () => {
    expect(taxesShown(false, [])).toBe(false);
    expect(taxesShown(false, undefined)).toBe(false);
    expect(taxesShown(false, [pay({ kind: "tax", paid_at: "x" }), pay({})])).toBe(false);
    expect(taxesShown(false, [pay({ kind: "tax" })])).toBe(true);
    expect(taxesShown(true, [])).toBe(true);
    // An older server does not say: taxes are shown, as before.
    expect(taxesShown(undefined, [])).toBe(true);
  });
});

describe("the counts on «План» (variant А)", () => {
  const recurring = (over: object) => ({ id: 1, kind: "obligation", name: "Квартира", amount: 100_000, currency: "UAH", day_of_month: 26, active: true, ...over }) as never;

  it("counts monthly payments and unpaid one-off ones, not the rows a monthly one made", () => {
    const list = [pay({ id: 1, recurring_id: 3 }), pay({ id: 2 }), pay({ id: 3, paid_at: "x" }), pay({ id: 4, kind: "tax" }), pay({ id: 5, kind: "installment" })];
    expect(paymentsCount([recurring({ id: 3 }), recurring({ id: 4, active: false }), recurring({ id: 5, kind: "installment" })], list)).toBe(2);
    expect(paymentsCount([], [])).toBe(0);
  });

  it("counts unpaid tax payments only", () => {
    expect(unpaidTaxCount([pay({ kind: "tax" }), pay({ kind: "tax", paid_at: "x" }), pay({})])).toBe(1);
    expect(unpaidTaxCount([pay({ kind: "tax", paid_at: "x" })])).toBe(0);
  });
});

describe("the income on its day", () => {
  const expected = [
    { id: 1, source: "usdc", amount: 270_000, currency: "USD", window_start_day: 5, window_end_day: 7, name: "Работа" },
    { id: 2, source: "fop", amount: 1_000_000, currency: "UAH", window_start_day: 25, window_end_day: 25 },
  ] as never[];
  const event = (id: number, expected_income_id: number, expected_on: string, status = "expected") => ({ id, expected_income_id, period: expected_on.slice(0, 7), expected_on, status }) as never;

  it("finds the expected income whose event not yet received falls on the day", () => {
    const events = [event(1, 2, "2026-11-07", "received"), event(2, 1, "2026-11-07"), event(3, 2, "2026-11-25")];
    expect(incomeOnDay(expected, events, "2026-11-07")).toMatchObject({ id: 1 });
    expect(incomeOnDay(expected, events, "2026-11-25")).toMatchObject({ id: 2 });
    expect(incomeOnDay(expected, events, "2026-11-08")).toBeUndefined();
    expect(incomeOnDay(expected, [event(4, 9, "2026-11-07")], "2026-11-07")).toBeUndefined();
  });
});
