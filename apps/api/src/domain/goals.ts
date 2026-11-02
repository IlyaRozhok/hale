import type { Minor } from "./money";

export interface LeftForGoalsInput {
  /** This calendar month's expected income, all sources, in UAH. */
  income: Minor;
  /** The FOP part of that income, in UAH. */
  fopIncome: Minor;
  /** Combined tax rate in basis points. */
  taxRateBp: number;
  esvQuarter: Minor;
  /** Active recurring payments other than tax. */
  recurring: Minor;
  /** Installments due in this calendar month, paid or not. */
  installments: Minor;
  lifestyleCap: Minor;
}

/** What remains each month for goals under a lifestyle cap, never below zero (design §5.2). */
export function leftForGoalsMonthly(i: LeftForGoalsInput): Minor {
  const tax = Math.round((i.fopIncome * i.taxRateBp) / 10_000);
  const esv = Math.round(i.esvQuarter / 3);
  return Math.max(0, i.income - tax - esv - i.recurring - i.installments - i.lifestyleCap);
}
