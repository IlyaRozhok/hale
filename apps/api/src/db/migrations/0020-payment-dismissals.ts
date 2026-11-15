import type { MigrationInterface, QueryRunner } from "typeorm";

// Б8: the owner said this operation did not pay this planned payment, so «Это оплата?» is not asked
// about the pair again. A new, empty table: existing rows are not touched.
export class PaymentDismissals1795219200000 implements MigrationInterface {
  name = "PaymentDismissals1795219200000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE payment_dismissals (
      payment_id integer NOT NULL REFERENCES scheduled_payments(id) ON DELETE CASCADE,
      transaction_id integer NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      PRIMARY KEY (payment_id, transaction_id))`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE payment_dismissals`);
  }
}
