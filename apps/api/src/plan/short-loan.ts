/** Lenders whose loans are repaid within a cycle ("Кредит до завтра", microfinance). */
export const SHORT_LOAN_TEXT = /(кредит\s+до\s+завтра|moneyveo|miloan|creditkasa|швидко\s?гроші|sgroshi|easycash|gocrd|gopcr)/i;
/** Interest write-offs do not repay principal. */
export const INTEREST_TEXT = /^\s*списання відсотків/i;
