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
  /** Some income pays the fop tax (task Д4); without one there is no ESV either. */
  paysFopTax: boolean;
}

/** What remains each month for goals under a lifestyle cap, never below zero (design §5.2). */
export function leftForGoalsMonthly(i: LeftForGoalsInput): Minor {
  const tax = Math.round((i.fopIncome * i.taxRateBp) / 10_000);
  const esv = i.paysFopTax ? Math.round(i.esvQuarter / 3) : 0;
  return Math.max(0, i.income - tax - esv - i.recurring - i.installments - i.lifestyleCap);
}

/** The place a goal is kept in (ЯМ5): its balance and credit limit in its own currency, as the place's row has them. */
export interface GoalPlaceBalance {
  balance: Minor;
  creditLimit: Minor;
  currency: string;
}

/**
 * What a goal shows as saved (ЯМ5), in the goal's currency. A goal kept in a place shows that place's money — its balance
 * less its credit limit, the amount its row in «Отложено» or «Счета» shows — and never less than nothing; what was
 * entered by hand does not count then. A goal without a place, whose place is gone, or whose place is in another
 * currency than its target shows what was entered by hand, and is as if without a place (`linked` false).
 */
export function goalSaved(
  goal: { savedByHand: Minor; currency: string },
  place: GoalPlaceBalance | null,
): { saved: Minor; linked: boolean } {
  if (place === null || place.currency !== goal.currency) return { saved: goal.savedByHand, linked: false };
  return { saved: Math.max(0, place.balance - place.creditLimit), linked: true };
}
