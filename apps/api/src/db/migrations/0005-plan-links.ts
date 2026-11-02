import type { MigrationInterface, QueryRunner } from "typeorm";

// Links that make planned-data matching idempotent: a transaction pays at most one payment and
// seeds at most one loan, an income event remembers the row it was matched with, and the manual
// balance "Binance" is looked up by name.
export class PlanLinks1793923200000 implements MigrationInterface {
  name = "PlanLinks1793923200000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE income_events ADD COLUMN matched_transaction_id integer REFERENCES transactions(id) ON DELETE SET NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX scheduled_payments_transaction_uq ON scheduled_payments (transaction_id) WHERE transaction_id IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX loans_source_transaction_uq ON loans (source_transaction_id) WHERE source_transaction_id IS NOT NULL`,
    );
    await q.query(`CREATE UNIQUE INDEX manual_balances_name_uq ON manual_balances (name)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX manual_balances_name_uq`);
    await q.query(`DROP INDEX loans_source_transaction_uq`);
    await q.query(`DROP INDEX scheduled_payments_transaction_uq`);
    await q.query(`ALTER TABLE income_events DROP COLUMN matched_transaction_id`);
  }
}
