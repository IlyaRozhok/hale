import type { Minor } from "./money";

/**
 * Task Б22: USDC exchanged for cash in one action. Binance gives the dollars, the wallet gets the hryvnias;
 * it is a move between the owner's own money, not income and not spending.
 */

/** Hryvnias per dollar of an exchange, to two decimals: ₴65,430 for $1,400 is 46.74. `cents` is positive. */
export function exchangeRate(kopecks: Minor, cents: number): number {
  return Math.round((kopecks / cents) * 100) / 100;
}

/**
 * What taking `cents` off the Binance balance leaves, and how much it really takes: never below zero, so a
 * balance smaller than the exchange gives only what it has. With no Binance balance (`null`) nothing is taken.
 * The cents taken are kept with the exchange, so that changing or deleting it gives back exactly them.
 */
export function binanceTake(balance: number | null, cents: number): { next: number | null; taken: number } {
  if (balance === null || balance <= 0) return { next: balance, taken: 0 };
  const next = Math.max(balance - cents, 0);
  return { next, taken: balance - next };
}
