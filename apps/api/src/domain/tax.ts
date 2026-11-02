import type { Minor } from "./money";

export interface TaxInput {
  fopIncomeQuarter: Minor;
  /** Combined rate in basis points (5% + 1% = 600). */
  rateBp: number;
  esvQuarter: Minor;
  dayOfQuarter: number;
  daysInQuarter: number;
  paidThisQuarter: Minor;
  /** Scheduled but not yet paid tax payments. */
  unpaidScheduled: Minor;
}

/** Estimated tax to hold back from own money. Never negative. */
export function taxReserve(i: TaxInput): Minor {
  const base = Math.round((i.fopIncomeQuarter * i.rateBp) / 10_000);
  const esv = Math.round((i.esvQuarter * i.dayOfQuarter) / i.daysInQuarter);
  return Math.max(0, base + esv + i.unpaidScheduled - i.paidThisQuarter);
}
