import type { MigrationInterface, QueryRunner } from "typeorm";

// Б26: how a paid planned payment was closed. True when the operations linked to it through payment_links
// covered it (the «Оплачено» sheet with chosen operations, a tax paid in parts); such a payment opens again
// when it loses an operation and the rest no longer cover it. A payment closed by hand, or through its own
// operation (transaction_id), is false and never reopens this way.
// Existing rows: a paid non-tax payment with no transaction_id and at least one linked operation becomes true
// (before Б9 «Оплачено» with chosen operations always closed it through them); everything else stays false,
// tax rows included (before Б24 a tax closed through its own operation or by hand, as on 14 November).
export class PaymentClosedByLinks1795392000000 implements MigrationInterface {
  name = "PaymentClosedByLinks1795392000000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE scheduled_payments ADD COLUMN closed_by_links boolean NOT NULL DEFAULT false`);
    await q.query(
      `UPDATE scheduled_payments p SET closed_by_links = true
        WHERE p.kind <> 'tax' AND p.paid_at IS NOT NULL AND p.transaction_id IS NULL
          AND EXISTS (SELECT 1 FROM payment_links l WHERE l.payment_id = p.id)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE scheduled_payments DROP COLUMN closed_by_links`);
  }
}
