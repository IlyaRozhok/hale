import type { EntityManager } from "typeorm";

/** The wallet account's external id: it has no bank statement. */
export const CASH_ACCOUNT_ID = "manual:cash";

/**
 * The recorded cash in the pocket, never stored: rows on the wallet (opening balance, operations
 * entered by hand, counts), plus cash withdrawn at ATMs since the start, less deposits the owner
 * said came from the wallet.
 */
export async function walletBalance(m: EntityManager): Promise<{ start: string | null; balance: number }> {
  const r = (
    await m.query(
      `SELECT s.cash_start::text AS start, (
         COALESCE((SELECT SUM(t.amount) FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.kind='cash'), 0)
       + COALESCE((SELECT SUM(-t.amount_uah) FROM transactions t JOIN accounts a ON a.id=t.account_id
                    WHERE a.kind NOT IN ('jar','cash') AND t.type='cash_out' AND t.local_date >= s.cash_start), 0)
       - COALESCE((SELECT SUM(t.amount_uah) FROM transactions t WHERE t.from_wallet), 0)
       )::float8 AS balance FROM settings s WHERE s.id=1`,
    )
  )[0] as { start: string | null; balance: number };
  return { start: r.start, balance: r.start === null ? 0 : r.balance };
}
