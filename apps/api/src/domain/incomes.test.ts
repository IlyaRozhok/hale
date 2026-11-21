import { describe, expect, it } from "vitest";
import { changedIncome, incomeDto, incomeProblem, newIncome, paymentsPerMonth, sourceOf, type IncomeRow } from "./incomes";

const fop: IncomeRow = {
  source: "fop", name: "ФОП", amount: 500_000, currency: "USD", window_start_day: 1, window_end_day: 5, schedule: "monthly", second_day: null,
  pays_fop_tax: true, crypto: false, account_id: 4, manual_balance_id: null, to_cash: false,
};

describe("incomes (Д3а)", () => {
  it("names an old kind and gives it its flag, as an older app creates an income", () => {
    expect(newIncome({ source: "fop", amount: 500_000, currency: "USD", window_start_day: 1, window_end_day: 5 })).toEqual({
      ...fop, account_id: null,
    });
    expect(newIncome({ source: "usdc", amount: 120_000, currency: "USD", window_start_day: 20, window_end_day: 20 })).toEqual({
      source: "usdc", name: "USDC", amount: 120_000, currency: "USD", window_start_day: 20, window_end_day: 20, schedule: "monthly", second_day: null,
      pays_fop_tax: false, crypto: true, account_id: null, manual_balance_id: null, to_cash: false,
    });
  });

  it("keeps a named income with neither flag free of any old kind", () => {
    const job = newIncome({
      name: "Основная работа", amount: 3_800_000, currency: "UAH", window_start_day: 5, window_end_day: 5, schedule: "twice", second_day: 20,
      account: { source: "account", id: 2 },
    });
    expect(job).toEqual({
      source: null, name: "Основная работа", amount: 3_800_000, currency: "UAH", window_start_day: 5, window_end_day: 5, schedule: "twice",
      second_day: 20, pays_fop_tax: false, crypto: false, account_id: 2, manual_balance_id: null, to_cash: false,
    });
    // The flags decide the old kind, whatever kind was sent with them.
    expect(newIncome({ source: "fop", pays_fop_tax: false, amount: 1, currency: "UAH", window_start_day: 1, window_end_day: 1 }).source).toBeNull();
    expect(newIncome({ name: "Заказчик А", crypto: true, amount: 1, currency: "USD", window_start_day: 1, window_end_day: 1 }).source).toBe("usdc");
    expect(sourceOf({ pays_fop_tax: true, crypto: true })).toBe("fop");
  });

  it("lets an income without a schedule do without days: the whole month", () => {
    const free = newIncome({ name: "Заказчик А", amount: 100_000, currency: "USD", schedule: "none", account: { source: "cash" } });
    expect(free).toMatchObject({ schedule: "none", window_start_day: 1, window_end_day: 31, second_day: null, to_cash: true, account_id: null });
    expect(newIncome({ name: "Депозит", amount: 1, currency: "UAH", schedule: "none", account: { source: "manual", id: 7 } }).manual_balance_id).toBe(7);
  });

  it("changes what the patch names and keeps the rest; an old kind sent by an older app sets the flags", () => {
    expect(changedIncome(fop, { amount: 600_000 })).toEqual({ ...fop, amount: 600_000 });
    expect(changedIncome(fop, { name: "Заказчик А", pays_fop_tax: false })).toEqual({ ...fop, name: "Заказчик А", pays_fop_tax: false, source: null });
    expect(changedIncome(fop, { source: "usdc" })).toMatchObject({ source: "usdc", pays_fop_tax: false, crypto: true, name: "ФОП" });
    expect(changedIncome(fop, { account: null })).toMatchObject({ account_id: null, manual_balance_id: null, to_cash: false });
    expect(changedIncome(fop, { account: { source: "manual", id: 3 } })).toMatchObject({ account_id: null, manual_balance_id: 3, to_cash: false });
    // Leaving «Два раза в месяц» drops the second day.
    const twice = { ...fop, pays_fop_tax: false, source: null, schedule: "twice" as const, second_day: 20 };
    expect(changedIncome(twice, { schedule: "monthly" })).toMatchObject({ schedule: "monthly", second_day: null });
    expect(changedIncome(twice, { schedule: "none" })).toMatchObject({ schedule: "none", second_day: null, window_start_day: 1, window_end_day: 5 });
  });

  it("refuses what only the whole income shows to be wrong", () => {
    expect(incomeProblem(fop)).toBeNull();
    expect(incomeProblem({ ...fop, window_start_day: 6 })).toBe("window start is after its end");
    const job = { ...fop, pays_fop_tax: false, source: null };
    expect(incomeProblem({ ...job, schedule: "twice" })).toBe("a twice-monthly income needs its second day");
    expect(incomeProblem({ ...job, schedule: "twice", second_day: 5 })).toBe("the second payment comes after the first");
    expect(incomeProblem({ ...job, schedule: "twice", second_day: 20 })).toBeNull();
    expect(incomeProblem({ ...job, second_day: 20 })).toBe("only a twice-monthly income has a second day");
    // The fop tax follows the money on the fop account by the month: an income paying it comes once a month.
    expect(incomeProblem({ ...fop, schedule: "twice", second_day: 20 })).toBe("an income that pays the fop tax comes once a month or without a schedule");
    expect(incomeProblem({ ...fop, schedule: "none" })).toBeNull();
  });

  it("counts the payments a month brings", () => {
    expect(paymentsPerMonth("monthly")).toBe(1);
    expect(paymentsPerMonth("twice")).toBe(2);
    expect(paymentsPerMonth("none")).toBe(0);
  });

  it("answers with the old fields an older app reads and the account as «Сегодня» names it", () => {
    expect(incomeDto({ id: 1, ...fop })).toEqual({
      id: 1, source: "fop", amount: 500_000, currency: "USD", window_start_day: 1, window_end_day: 5, name: "ФОП", schedule: "monthly",
      second_day: null, pays_fop_tax: true, crypto: false, account: { source: "account", id: 4 },
    });
    expect(incomeDto({ id: 2, ...fop, account_id: null, manual_balance_id: 9 }).account).toEqual({ source: "manual", id: 9 });
    expect(incomeDto({ id: 3, ...fop, account_id: null, to_cash: true }).account).toEqual({ source: "cash" });
    expect(incomeDto({ id: 4, ...fop, account_id: null }).account).toBeNull();
  });
});
