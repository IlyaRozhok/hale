import type { EntityManager } from "typeorm";
import { ownPairSql } from "../domain/own-pair";
import { counterKeySql } from "../transactions/counter-key";

/** The wallet account's external id: it has no bank statement. */
export const CASH_ACCOUNT_ID = "manual:cash";

/**
 * SQL condition over `t` (transactions): a transfer between the owner's own accounts, both legs in
 * our base. Either the other leg arrived on another account within the window (the pair rule of
 * domain/own-pair.ts, an exchange between currencies included), or the counterparty IBAN is one of
 * our accounts. Nothing can be paid with such a transfer.
 */
export const internalTransferSql = (t = "t"): string =>
  `(${t}.type = 'own_transfer'
    AND (EXISTS (SELECT 1 FROM transactions pair_o JOIN accounts pair_oa ON pair_oa.id = pair_o.account_id
                   JOIN accounts pair_ta ON pair_ta.id = ${t}.account_id
                  WHERE ${ownPairSql(t, "pair_ta", "pair_o", "pair_oa")})
         OR EXISTS (SELECT 1 FROM accounts oa WHERE oa.iban IS NOT NULL AND oa.iban = ${t}.counter_iban)))`;

/**
 * SQL condition over `t` (transactions) and `a` (its account): money sent to the owner's own card at
 * another bank since the wallet start. Its other leg is not at monobank, so it may have been taken
 * out there as cash.
 */
export const cardTransferSql = (t = "t", a = "a"): string =>
  `(${t}.type = 'own_transfer' AND ${t}.amount < 0 AND ${a}.kind NOT IN ('jar','cash') AND NOT ${t}.from_wallet
    AND ${t}.local_date >= (SELECT cash_start FROM settings WHERE id=1)
    AND NOT ${internalTransferSql(t)})`;

/** SQL for the cash such a transfer gave: the amount set for it, else all of it if the card's answer is yes, else 0. */
export const cardCashSql = (t = "t"): string =>
  `COALESCE(${t}.cash_amount, CASE WHEN (SELECT c.withdraws FROM cash_cards c WHERE c.counter_key = ${counterKeySql(t)})
                                   THEN -${t}.amount_uah END, 0)`;

/**
 * The recorded cash in the pocket, never stored: rows on the wallet (opening balance, operations
 * entered by hand, counts), plus cash withdrawn at ATMs since the start and cash taken from the
 * owner's card at another bank, less deposits the owner said came from the wallet.
 */
export async function walletBalance(m: EntityManager): Promise<{ start: string | null; balance: number }> {
  const r = (
    await m.query(
      `SELECT s.cash_start::text AS start, (
         COALESCE((SELECT SUM(t.amount) FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.kind='cash'), 0)
       + COALESCE((SELECT SUM(-t.amount_uah) FROM transactions t JOIN accounts a ON a.id=t.account_id
                    WHERE a.kind NOT IN ('jar','cash') AND t.type='cash_out' AND t.local_date >= s.cash_start), 0)
       + COALESCE((SELECT SUM(${cardCashSql()}) FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE ${cardTransferSql()}), 0)
       - COALESCE((SELECT SUM(t.amount_uah) FROM transactions t WHERE t.from_wallet), 0)
       )::float8 AS balance FROM settings s WHERE s.id=1`,
    )
  )[0] as { start: string | null; balance: number };
  return { start: r.start, balance: r.start === null ? 0 : r.balance };
}
