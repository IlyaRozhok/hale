// Kept apart from index.ts, with no zod: the app imports it at runtime as "@hale/contracts/exchange" and so does not
// carry the schemas in its bundle. The server takes it from "@hale/contracts", which re-exports it.

/**
 * The rate of an exchange of USDC for cash (task Б22): hryvnias per dollar, to two decimals; ₴65,430 for $1,400 is
 * 46.74. `kopecks` received, `cents` given (positive). The one rounding the server's DTO and the app's sheet share.
 */
export function exchangeRate(kopecks: number, cents: number): number {
  return Math.round((kopecks / cents) * 100) / 100;
}
