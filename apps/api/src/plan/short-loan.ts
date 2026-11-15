/**
 * Lenders whose loans are repaid within a cycle ("Кредит до завтра", microfinance). A cash loan counts
 * only with a term in days ("Кредит готівкою на 4 дні"): without one it is the monthly kind.
 */
export const SHORT_LOAN_TEXT = /(кредит\s+до\s+завтра|кредит\s+готівкою\s+на\s+\d+\s+(?:дн|день)|moneyveo|miloan|creditkasa|швидко\s?гроші|sgroshi|easycash|gocrd|gopcr)/i;
/** Interest write-offs do not repay principal. */
export const INTEREST_TEXT = /^\s*списання відсотків/i;
/** Rows that pay lenders and their fees: everything here beyond the principal is the cost of borrowing. */
export const LOAN_COST_TEXT = new RegExp(
  [SHORT_LOAN_TEXT.source, INTEREST_TEXT.source, "^\\s*штраф за порушення погашення", "pgid_commission", "pt_slc"].join("|"),
  "i",
);
