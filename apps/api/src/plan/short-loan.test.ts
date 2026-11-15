import { describe, expect, it } from "vitest";
import { INTEREST_TEXT, LOAN_COST_TEXT, SHORT_LOAN_TEXT } from "./short-loan";

describe("short loans", () => {
  it.each([
    ["Кредит готівкою на 4 дні"],
    ["Кредит готівкою на 2 дні"],
    ["Кредит готівкою на 1 день"],
    ["Кредит готівкою на 14 днів"],
    ["Погашення Кредит готівкою на 4 дні"],
    ["Погашення Кредит готівкою на 2 дні"],
    ["Кредит До завтра на 9 днів"],
  ])("%s is a short loan and a cost of borrowing", (text) => {
    expect(SHORT_LOAN_TEXT.test(text)).toBe(true);
    expect(LOAN_COST_TEXT.test(text)).toBe(true);
  });

  it.each([
    ["Кредит готівкою"],
    ["Погашення Кредит готівкою"],
    ["Кредит готівкою на 12 місяців"],
    ["Розстрочка на картку"],
    ["Рассрочка на карту"],
  ])("%s is not a short loan: it is paid monthly", (text) => {
    expect(SHORT_LOAN_TEXT.test(text)).toBe(false);
  });

  it("a day-term cash loan repayment is not an interest write-off", () => {
    expect(INTEREST_TEXT.test("Погашення Кредит готівкою на 4 дні")).toBe(false);
  });
});
