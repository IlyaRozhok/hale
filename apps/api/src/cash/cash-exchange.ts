import type { EntityManager } from "typeorm";
import { binanceTake } from "../domain/cash-exchange";
import { BINANCE } from "../plan/binance";

/**
 * USDC exchanged for cash (task Б22): the wallet row is kept in cash_exchanges with the dollars given and the
 * cents really taken off Binance, so that changing or deleting it gives back exactly them. Everything here runs
 * in the caller's transaction, after the caller has locked the wallet row; the caller fixes the day afresh.
 */

/** SQL column over `t` (transactions): the US cents given, when the row is an exchange; else null. */
export const exchangeUsdcSql = (t = "t"): string =>
  `(SELECT e.usdc_cents::float8 FROM cash_exchanges e WHERE e.transaction_id = ${t}.id) AS exchange_usdc`;

/** A wallet row's exchange: the dollars given and the cents taken off Binance; null when the row is no exchange. */
export async function exchangeOf(m: EntityManager, id: number): Promise<{ usdc: number; binance: number } | null> {
  const r = (
    await m.query(`SELECT usdc_cents::float8 AS usdc, binance_cents::float8 AS binance FROM cash_exchanges WHERE transaction_id=$1`, [id])
  )[0] as { usdc: number; binance: number } | undefined;
  return r ?? null;
}

/** Takes the dollars off Binance, as far as it has them, and keeps the exchange with what was taken. */
export async function takeExchange(m: EntityManager, id: number, usdc: number): Promise<void> {
  const b = (await m.query(`SELECT amount::float8 AS amount FROM manual_balances WHERE name=$1 FOR UPDATE`, [BINANCE]))[0] as
    | { amount: number }
    | undefined;
  const take = binanceTake(b?.amount ?? null, usdc);
  if (take.taken !== 0) await m.query(`UPDATE manual_balances SET amount=$2 WHERE name=$1`, [BINANCE, take.next]);
  await m.query(`INSERT INTO cash_exchanges (transaction_id, usdc_cents, binance_cents) VALUES ($1,$2,$3)`, [id, usdc, take.taken]);
}

/** Gives Binance back exactly the cents the exchange took and forgets it. True when the row was an exchange. */
export async function undoExchange(m: EntityManager, id: number): Promise<boolean> {
  const e = await exchangeOf(m, id);
  if (!e) return false;
  if (e.binance !== 0) await m.query(`UPDATE manual_balances SET amount = amount + $2 WHERE name=$1`, [BINANCE, e.binance]);
  await m.query(`DELETE FROM cash_exchanges WHERE transaction_id=$1`, [id]);
  return true;
}
