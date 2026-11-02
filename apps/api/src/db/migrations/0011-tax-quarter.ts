import type { MigrationInterface, QueryRunner } from "typeorm";

// Which quarter a tax payment is for, and whether it is the app's own estimate until the owner
// enters the real figures. A monthly recurring tax row belongs to no quarter and stays NULL.
export class TaxQuarter1794441600000 implements MigrationInterface {
  name = "TaxQuarter1794441600000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE scheduled_payments
         ADD COLUMN tax_quarter text CHECK (tax_quarter ~ '^[0-9]{4}-Q[1-4]$'),
         ADD COLUMN is_estimate boolean NOT NULL DEFAULT false`,
    );
    await q.query(
      `UPDATE scheduled_payments SET tax_quarter = to_char(due_on - interval '3 months', 'YYYY"-Q"Q')
        WHERE kind='tax' AND recurring_id IS NULL`,
    );
    await q.query(`CREATE UNIQUE INDEX scheduled_payments_estimate_uq ON scheduled_payments (tax_quarter) WHERE is_estimate`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX scheduled_payments_estimate_uq`);
    await q.query(`DELETE FROM scheduled_payments WHERE is_estimate`);
    await q.query(`ALTER TABLE scheduled_payments DROP COLUMN is_estimate, DROP COLUMN tax_quarter`);
  }
}
