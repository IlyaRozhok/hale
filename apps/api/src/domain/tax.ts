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
}

/** Estimated tax to hold back from own money. Never negative. */
export function taxReserve(i: TaxInput): Minor {
  const base = Math.round((i.fopIncomeQuarter * i.rateBp) / 10_000);
  const esv = Math.round((i.esvQuarter * i.dayOfQuarter) / i.daysInQuarter);
  const accrual = i.currentQuarterHasRows ? 0 : base + esv;
  return Math.max(0, accrual + i.unpaidScheduled - i.paidAgainstCurrentQuarter);
}
