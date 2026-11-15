import type { MigrationInterface, QueryRunner } from "typeorm";

// Б23: monobank's day-term cash loan ("Кредит готівкою на 4 дні") is a short loan. Before this, such a
// loan opened as 'other' and its repayment never closed it, while the stats would now count the whole
// repayment as the cost of borrowing. This turns those loans into short ones, undoes a manual «Погасил»
// on them (its excess was counted as cost, and would be counted twice), and applies their repayments
// once, here, to these loans only: the oldest first, as the service does. A loan the owner closed that
// no bank repayment covers keeps his close. Nothing to convert, nothing done: a second run changes
// nothing. The patterns are copied, not imported, so that later changes to the service do not change
// what this migration did.
const DAY_TERM = /кредит\s+готівкою\s+на\s+\d+\s+(?:дн|день)/i;
const OLD_SHORT = /(кредит\s+до\s+завтра|moneyveo|miloan|creditkasa|швидко\s?гроші|sgroshi|easycash|gocrd|gopcr)/i;
const INTEREST = /^\s*списання відсотків/i;
const TEXT = `concat_ws(' ', t.description, t.comment, t.counter_name)`;

export class DayTermCashLoans1795132800000 implements MigrationInterface {
  name = "DayTermCashLoans1795132800000";

  async up(q: QueryRunner): Promise<void> {
    const loans: { id: number; text: string }[] = await q.query(
      `SELECT l.id, ${TEXT} AS text FROM loans l JOIN transactions t ON t.id = l.source_transaction_id WHERE l.kind = 'other'`,
    );
    const ids = loans.filter((l) => DAY_TERM.test(l.text)).map((l) => l.id);

    if (ids.length === 0) return;

    // A repayment whose text the old service did not know never paid anything, so a mark on it is stale.
    const marks: { id: number; text: string }[] = await q.query(
      `SELECT r.transaction_id AS id, ${TEXT} AS text FROM loan_repayments r JOIN transactions t ON t.id = r.transaction_id`,
    );
    const stale = marks.filter((r) => DAY_TERM.test(r.text) && !OLD_SHORT.test(r.text)).map((r) => r.id);
    if (stale.length > 0) await q.query(`DELETE FROM loan_repayments WHERE transaction_id = ANY($1::int[])`, [stale]);
    const before: { id: number; repaid_amount: string; repaid_at: Date | null; repaid_date_unknown: boolean; service_cost: string }[] =
      await q.query(
        `SELECT id, repaid_amount, repaid_at, repaid_date_unknown, service_cost FROM loans WHERE id = ANY($1::int[]) AND repaid_at IS NOT NULL`,
        [ids],
      );
    await q.query(
      `UPDATE loans SET kind = 'short', repaid_amount = 0, repaid_at = NULL, repaid_date_unknown = false, service_cost = 0
        WHERE id = ANY($1::int[])`,
      [ids],
    );

    const repayments: { id: number; amount: number; local_date: string; occurred_at: Date; text: string }[] = await q.query(
      `SELECT t.id, ABS(COALESCE(t.amount_uah, t.amount))::float8 AS amount, t.local_date::text AS local_date, t.occurred_at,
              ${TEXT} AS text
         FROM transactions t
        WHERE t.type = 'debt_payment' AND t.type_source IS DISTINCT FROM 'owner' AND t.amount < 0
          AND NOT EXISTS (SELECT 1 FROM loan_repayments r WHERE r.transaction_id = t.id)
        ORDER BY t.occurred_at, t.id`,
    );
    for (const t of repayments) {
      if (!DAY_TERM.test(t.text) || INTEREST.test(t.text)) continue;
      const open: { id: number; amount: number; repaid_amount: number }[] = await q.query(
        `SELECT id, amount::float8 AS amount, repaid_amount::float8 AS repaid_amount FROM loans
          WHERE id = ANY($1::int[]) AND repaid_at IS NULL AND received_on <= $2 ORDER BY received_on, id`,
        [ids, t.local_date],
      );
      if (open.length === 0) continue;
      await q.query(`INSERT INTO loan_repayments (transaction_id) VALUES ($1)`, [t.id]);
      let left = t.amount;
      for (const l of open) {
        if (left <= 0) break;
        const pay = Math.min(left, l.amount - l.repaid_amount);
        left -= pay;
        const total = l.repaid_amount + pay;
        await q.query(
          `UPDATE loans SET repaid_amount = $2::bigint, repaid_at = CASE WHEN $2::bigint >= amount THEN $3::timestamptz END WHERE id = $1`,
          [l.id, total, t.occurred_at],
        );
      }
    }

    // A loan the owner closed that no bank repayment covers (paid in cash, say) stays as the owner left it.
    for (const b of before) {
      await q.query(
        `UPDATE loans SET repaid_amount = $2, repaid_at = $3, repaid_date_unknown = $4, service_cost = $5
          WHERE id = $1 AND repaid_at IS NULL`,
        [b.id, b.repaid_amount, b.repaid_at, b.repaid_date_unknown, b.service_cost],
      );
    }
  }

  /** The kind goes back; what the repayments paid stays, and a manual «Погасил» it undid is not restored. */
  async down(q: QueryRunner): Promise<void> {
    const loans: { id: number; text: string }[] = await q.query(
      `SELECT l.id, ${TEXT} AS text FROM loans l JOIN transactions t ON t.id = l.source_transaction_id WHERE l.kind = 'short'`,
    );
    const ids = loans.filter((l) => DAY_TERM.test(l.text) && !OLD_SHORT.test(l.text)).map((l) => l.id);
    if (ids.length > 0) await q.query(`UPDATE loans SET kind = 'other' WHERE id = ANY($1::int[])`, [ids]);
  }
}
