import type { MigrationInterface, QueryRunner } from "typeorm";

// Б21: the answer to «Откуда наличные?» (and «Это вывод с Binance?») about an incoming row, with what it
// did, so that changing it undoes exactly that: the cents it really took off the Binance balance, the income
// it was matched to and the status that income had if this answer marked it received, and the row as it was.
// A new, empty table: existing rows are not touched; rows answered before it are read from the row itself.
export class CashAnswers1795305600000 implements MigrationInterface {
  name = "CashAnswers1795305600000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE cash_answers (
      transaction_id integer PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
      answer text NOT NULL CHECK (answer IN ('wallet','binance','other')),
      binance_cents bigint NOT NULL DEFAULT 0,
      income_event_id integer REFERENCES income_events(id) ON DELETE SET NULL,
      event_status_before text,
      type_before text,
      category_before text,
      type_source_before text,
      needs_label_before boolean NOT NULL,
      usdc_checked_before boolean NOT NULL,
      answered_at timestamptz NOT NULL DEFAULT now())`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE cash_answers`);
  }
}
