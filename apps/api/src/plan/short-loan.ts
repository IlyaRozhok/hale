/** Lenders whose loans are repaid within a cycle ("Кредит до завтра", microfinance). */
export const SHORT_LOAN_TEXT = /(кредит\s+до\s+завтра|moneyveo|miloan|creditkasa|швидко\s?гроші|sgroshi|easycash|gocrd|gopcr)/i;
/** Interest write-offs do not repay principal. */
export const INTEREST_TEXT = /^\s*списання відсотків/i;
/** Rows that pay lenders and their fees: everything here beyond the principal is the cost of borrowing. */
export const LOAN_COST_TEXT = new RegExp(
  [SHORT_LOAN_TEXT.source, INTEREST_TEXT.source, "^\\s*штраф за порушення погашення", "pgid_commission", "pt_slc"].join("|"),
  "i",
);
