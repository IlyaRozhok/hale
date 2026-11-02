import { describe, expect, it } from "vitest";
import {
  compareTotals,
  isAllowed,
  parseCsv,
  reportGroupOf,
  sumByReportGroup,
  type SummableRow,
} from "./golden-mapping";
import { parseExpected, renderComparison, summarizeDb, type DbRow } from "./golden-import";

describe("isAllowed", () => {
  it("follows the group table", () => {
    expect(isAllowed("Расходы", "Продукты", "spend", -100)).toBe(true);
    expect(isAllowed("Расходы", "Налоги", "tax", -100)).toBe(true);
    expect(isAllowed("Долги", "x", "debt_payment", -100)).toBe(true);
    expect(isAllowed("Долги", "x", "spend", -100)).toBe(false);
    expect(isAllowed("Переводы", "x", "person_transfer", -100)).toBe(true);
    expect(isAllowed("Свои счета", "x", "own_transfer", 100)).toBe(true);
    expect(isAllowed("Займы", "x", "loan_in", 100)).toBe(true);
    expect(isAllowed("Неизвестная", "x", "spend", 1)).toBe(false);
  });

  it("accepts own_transfer in income only for the fop category, spend only when positive", () => {
    expect(isAllowed("Доход", "С ФОП-счёта", "own_transfer", 100)).toBe(true);
    expect(isAllowed("Доход", "Переводы от людей", "own_transfer", 100)).toBe(false);
    expect(isAllowed("Доход", "Возвраты", "spend", 100)).toBe(true);
    expect(isAllowed("Доход", "Возвраты", "spend", -100)).toBe(false);
    expect(isAllowed("Доход", "x", "cash_in", 100)).toBe(true);
    expect(isAllowed("Доход", "x", "person_in", 100)).toBe(true);
  });
});

describe("sumByReportGroup", () => {
  const rows: SummableRow[] = [
    { type: "income", amount: 1000, fopWithdrawal: false },
    { type: "cash_in", amount: 200, fopWithdrawal: false },
    { type: "person_in", amount: 50, fopWithdrawal: false },
    { type: "own_transfer", amount: 300, fopWithdrawal: true },
    { type: "own_transfer", amount: -70, fopWithdrawal: false },
    { type: "spend", amount: 20, fopWithdrawal: false },
    { type: "spend", amount: -400, fopWithdrawal: false },
    { type: "tax", amount: -30, fopWithdrawal: false },
    { type: "cash_out", amount: -10, fopWithdrawal: false },
    { type: "debt_payment", amount: -90, fopWithdrawal: false },
    { type: "loan_in", amount: 500, fopWithdrawal: false },
    { type: "person_transfer", amount: -60, fopWithdrawal: false },
    { type: "obligation", amount: -40, fopWithdrawal: false },
  ];

  it("maps types to report groups with the report definitions", () => {
    expect(reportGroupOf("own_transfer", 1, true)).toBe("Доход");
    expect(sumByReportGroup(rows)).toEqual({
      Доход: 1000 + 200 + 50 + 300 + 20,
      Расходы: -400 - 30 - 10,
      Долги: -90,
      Займы: 500,
      Переводы: -100,
      "Свои счета": -70,
    });
  });

  it("compares absolute totals with expectations", () => {
    const diff = compareTotals(sumByReportGroup(rows), {
      Доход: 1570,
      Расходы: 440,
      Долги: 100,
      Займы: 500,
      Переводы: 100,
    });
    expect(diff.find((d) => d.group === "Доход")).toMatchObject({ actual: 1570, diff: 0 });
    expect(diff.find((d) => d.group === "Долги")).toMatchObject({ actual: 90, diff: -10 });
    expect(diff.find((d) => d.group === "Расходы")).toMatchObject({ actual: 440, diff: 0 });
  });
});

describe("golden-import summing", () => {
  const dbRows: DbRow[] = [
    { type: "income", amount_uah: 1_000_00, description: "Salary", hold: false },
    { type: "own_transfer", amount_uah: 500_00, description: "З гривневого рахунку ФОП", hold: false },
    { type: "own_transfer", amount_uah: -200_00, description: "З Білої картки", hold: false },
    { type: "spend", amount_uah: -300_00, description: "Cafe", hold: false },
    { type: "spend", amount_uah: -999_00, description: "Pending", hold: true },
    { type: "spend", amount_uah: null, description: "No rate", hold: false },
    { type: null, amount_uah: -50_00, description: "Untyped", hold: false },
    { type: "loan_in", amount_uah: 100_00, description: "Loan", hold: false },
  ];

  it("converts kopecks, skips holds and rows without a UAH amount, counts untyped", () => {
    const r = summarizeDb(dbRows);
    expect(r.sums["Доход"]).toBe(1500);
    expect(r.sums["Расходы"]).toBe(-300);
    expect(r.sums["Свои счета"]).toBe(-200);
    expect(r.sums["Займы"]).toBe(100);
    expect(r.skipped).toEqual({ hold: 1, noAmount: 1, untyped: 1 });
  });

  it("renders a table with the differences", () => {
    const text = renderComparison(summarizeDb(dbRows), {
      Доход: 1500,
      Расходы: 250,
      Долги: 0,
      Займы: 100,
      Переводы: 0,
    });
    expect(text).toContain("Расходы");
    expect(text).toMatch(/Расходы\s+250\s+300\s+\+50/);
    expect(text).toMatch(/Доход\s+1,500\s+1,500\s+0/);
  });

  it("reads expected totals and rejects a malformed file", () => {
    expect(parseExpected('{"Доход":1,"Расходы":2,"Долги":3,"Займы":4,"Переводы":5}')).toEqual({
      Доход: 1,
      Расходы: 2,
      Долги: 3,
      Займы: 4,
      Переводы: 5,
    });
    expect(() => parseExpected('{"Доход":1}')).toThrow(/Расходы/);
  });
});

describe("parseCsv", () => {
  it("handles quotes, commas and CRLF", () => {
    expect(parseCsv('a,b\r\n1,"x, ""y"""\n2,z\n')).toEqual([
      { a: "1", b: 'x, "y"' },
      { a: "2", b: "z" },
    ]);
  });
});
