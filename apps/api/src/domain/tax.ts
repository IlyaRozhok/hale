import type { Minor } from "./money";

export interface TaxInput {
  fopIncomeQuarter: Minor;
  /** Combined rate in basis points (5% + 1% = 600). */
  rateBp: number;
  esvQuarter: Minor;
  dayOfQuarter: number;
  daysInQuarter: number;
  /**
   * Payments made against the CURRENT quarter's accrual only. Paying an earlier
   * quarter's scheduled tax is NOT counted here: it is represented solely by
   * `unpaidScheduled` dropping to zero (otherwise it would be subtracted twice).
   */
  paidAgainstCurrentQuarter: Minor;
  /** Scheduled tax payments not yet paid (estimates included). */
  unpaidScheduled: Minor;
  /**
   * The owner has entered real payments for the current quarter. They are counted in
   * `unpaidScheduled` once they exist, so the quarter does not also accrue.
   */
  currentQuarterHasRows: boolean;
  /**
   * Some income pays the fop tax (task Д4). Without one the quarter accrues nothing, ESV included, and no estimate is
   * written; tax rows already entered and not paid stay reserved.
   */
  paysFopTax: boolean;
}

/** Task Д4: the person has taxes when an income pays the fop tax, or a tax payment entered earlier is still unpaid. */
export function taxesOn(i: { paysFopTax: boolean; unpaidTaxRows: number }): boolean {
  return i.paysFopTax || i.unpaidTaxRows > 0;
}

/** Estimated tax to hold back from own money. Never negative. */
export function taxReserve(i: TaxInput): Minor {
  const base = Math.round((i.fopIncomeQuarter * i.rateBp) / 10_000);
  const esv = Math.round((i.esvQuarter * i.dayOfQuarter) / i.daysInQuarter);
  const accrual = i.currentQuarterHasRows || !i.paysFopTax ? 0 : base + esv;
  return Math.max(0, accrual + i.unpaidScheduled - i.paidAgainstCurrentQuarter);
}
