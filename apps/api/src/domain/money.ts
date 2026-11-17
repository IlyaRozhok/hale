// Money engine primitives. Pure functions only: no Nest, no I/O, no clock.
// All dates are 'YYYY-MM-DD' strings and are handled with UTC arithmetic so
// DST changes can never shift a day.

import { KYIV_TZ } from "../time/clock";

/** Integer kopecks (or cents). */
export type Minor = number;

/** Exchange rate: UAH per one unit of the currency. Keyed by alpha code. */
export type Rates = Record<string, { rate: number; fetchedAt: string }>;

export const UAH = 980;
/** ISO 4217 numeric to alpha code. Single source for the money engine and the importer. */
export const CURRENCY_ALPHA: Record<number, string> = {
  980: "UAH",
  840: "USD",
  978: "EUR",
  826: "GBP",
  985: "PLN",
  756: "CHF",
  203: "CZK",
};
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export function ownMoney(account: { balance: Minor; creditLimit: Minor }): Minor {
  return account.balance - account.creditLimit;
}

/**
 * Converts to UAH kopecks. `now` is an ISO instant; a rate fetched more than
 * 48 hours before it is flagged stale. Throws when there is no rate.
 */
export function toUah(
  amount: Minor,
  currency: number,
  rates: Rates,
  now: string,
): { uah: Minor; stale: boolean } {
  if (currency === UAH) return { uah: amount, stale: false };
  const alpha = CURRENCY_ALPHA[currency];
  if (!alpha) throw new Error(`Unknown currency code ${currency}`);
  const entry = rates[alpha];
  if (!entry) throw new Error(`No exchange rate for ${alpha}`);
  const age = Date.parse(now) - Date.parse(entry.fetchedAt);
  return { uah: Math.round(amount * entry.rate), stale: age > STALE_AFTER_MS };
}

/**
 * The hryvnia side of an operation on a foreign-currency account that was itself made in hryvnias
 * (monobank's `currencyCode` 980), e.g. dollars sold to the owner's own hryvnia card. monobank gives that
 * side exactly as `operationAmount`, with the same sign as `amount`; the implied rate is kept so a later
 * sync that recomputes `amount × rate` lands on the same hryvnias. Null when the operation was in another
 * currency, the amount is zero, or the two sides disagree in sign.
 */
export function hryvniaLeg(item: {
  amount: Minor;
  operationAmount: Minor;
  currencyCode: number;
}): { amountUah: Minor; fxRate: number } | null {
  if (item.currencyCode !== UAH) return null;
  if (item.amount === 0 || Math.sign(item.amount) !== Math.sign(item.operationAmount)) return null;
  return { amountUah: item.operationAmount, fxRate: item.operationAmount / item.amount };
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / DAY_MS;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

const kyivFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: KYIV_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Local calendar date in Kyiv for an instant. */
export function kyivDate(instant: Date): string {
  return kyivFormat.format(instant);
}
