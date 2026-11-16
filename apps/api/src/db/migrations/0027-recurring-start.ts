import type { MigrationInterface, QueryRunner } from "typeorm";
import { kyivDaySql } from "../../time/clock";

// Б29: a monthly series remembers the day it starts, and generation never makes a payment due before it
// (a series set up after its day of the month no longer gets an overdue row at the next hourly run). A month
// the owner deleted from a series is remembered in `recurring_skips` and never generated again.
// Existing rows: each series starts at its earliest scheduled payment, paid or not, so no payment it already
// has falls before its start; a series with no payments starts on the day of the migration (Kyiv). Payments
// are not touched: an overdue row the old code made cannot be told from a real one and stays. The new table
// is empty. Down drops the table and the column and leaves the payments as they are.
export class RecurringStart1795824000000 implements MigrationInterface {
  name = "RecurringStart1795824000000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE recurring_payments ADD COLUMN starts_on date NOT NULL DEFAULT ${kyivDaySql("now()")}`,
    );
    await q.query(
      `UPDATE recurring_payments r SET starts_on = p.first
         FROM (SELECT recurring_id, min(due_on) AS first FROM scheduled_payments WHERE recurring_id IS NOT NULL GROUP BY recurring_id) p
        WHERE p.recurring_id = r.id`,
    );
    await q.query(`CREATE TABLE recurring_skips (
      recurring_id integer NOT NULL REFERENCES recurring_payments(id) ON DELETE CASCADE,
      due_on date NOT NULL,
      PRIMARY KEY (recurring_id, due_on))`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE recurring_skips`);
    await q.query(`ALTER TABLE recurring_payments DROP COLUMN starts_on`);
  }
}
