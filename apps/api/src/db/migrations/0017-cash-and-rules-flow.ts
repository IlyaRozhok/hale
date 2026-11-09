import type { MigrationInterface, QueryRunner } from "typeorm";

// Paying a planned payment with chosen rows, and cash taken from the owner's card at another bank.
// Nothing changes until the owner links rows or answers about a card.
export class CashAndRulesFlow1794960000000 implements MigrationInterface {
  name = "CashAndRulesFlow1794960000000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE payment_links (
      payment_id integer NOT NULL REFERENCES scheduled_payments(id) ON DELETE CASCADE,
      transaction_id integer NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
      PRIMARY KEY (payment_id, transaction_id))`);
    await q.query(`ALTER TABLE transactions ADD COLUMN cash_amount bigint`);
    await q.query(`CREATE TABLE cash_cards (counter_key text PRIMARY KEY, withdraws boolean NOT NULL)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE cash_cards`);
    await q.query(`ALTER TABLE transactions DROP COLUMN cash_amount`);
    await q.query(`DROP TABLE payment_links`);
  }
}
