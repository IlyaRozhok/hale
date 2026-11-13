import { type Minor, ownMoney } from "./money";

export interface CreditInput {
  /** Signed minor units in the account currency; a spend is negative. */
  amount: Minor;
  /** The account balance right after the operation, as the bank sent it; null on rows stored before A16. */
  balanceAfter: Minor | null;
  /** The account's credit limit at the moment of the operation; null when the server did not store it. */
  creditLimit: Minor | null;
  /** The account currency. */
  currency: string;
}

/**
 * Kopecks of a spend paid out of the credit limit, or null when none (or when it cannot be known).
 *
 * Rule, read from code and NOT yet checked on real data: own money is balance minus limit
 * (`ownMoney`), so a spend is on credit for the part that took own money below zero.
 * Only hryvnia accounts: the card shows the part as hryvnias, and monobank gives credit limits
 * only on them. An operation in a foreign currency on a hryvnia account is fine: its amount and
 * balance are in hryvnias.
 */
export function creditPart({ amount, balanceAfter, creditLimit, currency }: CreditInput): Minor | null {
  if (currency !== "UAH" || balanceAfter === null || creditLimit === null) return null;
  if (amount >= 0 || creditLimit <= 0) return null;
  const ownAfter = ownMoney({ balance: balanceAfter, creditLimit });
  const part = Math.min(-amount, Math.max(0, -ownAfter));
  return part > 0 ? part : null;
}
