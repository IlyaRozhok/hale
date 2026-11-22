import type { EntityManager } from "typeorm";

/** Task Д4: some income pays the fop tax. Without one nothing accrues and no estimate is written. */
export async function paysFopTax(m: EntityManager): Promise<boolean> {
  const [{ on }] = (await m.query(`SELECT EXISTS (SELECT 1 FROM expected_incomes WHERE pays_fop_tax) AS on`)) as [{ on: boolean }];
  return on;
}

/**
 * What a quarter's tax accrual is built from: income on the FOP account, and tax payments that no
 * scheduled tax row claims, by `transaction_id` or `payment_links` (those belong to the quarter they
 * were paid in). A part linked to a row not yet closed is left out too: the row stays reserved whole.
 */
export async function quarterTaxFacts(
  m: EntityManager,
  start: string,
  end: string,
): Promise<{ fopIncome: number; paidUnmatched: number }> {
  const fopIncome = (
    await m.query(
      `SELECT COALESCE(SUM(t.amount_uah),0)::float8 AS s FROM transactions t JOIN accounts a ON a.id=t.account_id
        WHERE a.kind='fop' AND t.type='income' AND t.local_date BETWEEN $1 AND $2`,
      [start, end],
    )
  )[0].s as number;
  const paidUnmatched = (
    await m.query(
      `SELECT COALESCE(SUM(-t.amount_uah),0)::float8 AS s FROM transactions t
        WHERE t.type='tax' AND t.amount < 0 AND t.local_date BETWEEN $1 AND $2
          AND NOT EXISTS (SELECT 1 FROM scheduled_payments p WHERE p.transaction_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM payment_links l WHERE l.transaction_id = t.id)`,
      [start, end],
    )
  )[0].s as number;
  return { fopIncome, paidUnmatched };
}
