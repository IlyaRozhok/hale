import type { MigrationInterface, QueryRunner } from "typeorm";

// Б40: an answer «Из кошелька» given after the pocket was counted takes the deposit off that count's
// shortfall («Не записано»), so the deposit is not taken off the wallet twice.
// - settings.cash_counted_at: the moment of the last count. Each count row keeps in its `raw` the moment it was
//   made and the moment of the count before it, so «the first count after a deposit» is known even when a count in
//   between found no difference and wrote no row.
// - cash_answers.count_transaction_id / count_absorbed / count_row: which count row the answer reduced, by how many
//   kopecks, and the row as it was when the answer deleted it whole; changing the answer gives that back.
// Existing rows: a started wallet gets cash_counted_at = the moment of the migration, so no deposit made before it is
// matched to any count (count rows written before it carry no marker and are never touched either). Existing answers
// get «absorbed nothing» (NULL, 0, NULL) and change exactly as before. Down drops the columns.
export class CashCountAbsorbed1795996800000 implements MigrationInterface {
  name = "CashCountAbsorbed1795996800000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE settings ADD COLUMN cash_counted_at timestamptz`);
    await q.query(`UPDATE settings SET cash_counted_at = now() WHERE cash_start IS NOT NULL`);
    await q.query(
      `ALTER TABLE cash_answers ADD COLUMN count_transaction_id integer,
                                ADD COLUMN count_absorbed bigint NOT NULL DEFAULT 0,
                                ADD COLUMN count_row jsonb`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE cash_answers DROP COLUMN count_transaction_id, DROP COLUMN count_absorbed, DROP COLUMN count_row`);
    await q.query(`ALTER TABLE settings DROP COLUMN cash_counted_at`);
  }
}
