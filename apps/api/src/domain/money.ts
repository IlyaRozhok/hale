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
