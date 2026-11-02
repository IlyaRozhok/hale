import type { MigrationInterface, QueryRunner } from "typeorm";

// A foreign-currency transaction imported before any FX rate exists has no UAH value yet.
export class NullableAmountUah1793664000000 implements MigrationInterface {
  name = "NullableAmountUah1793664000000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE transactions ALTER COLUMN amount_uah DROP NOT NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    // Lossy by necessity: unconverted rows fall back to the raw amount.
    await q.query(`UPDATE transactions SET amount_uah = amount WHERE amount_uah IS NULL`);
    await q.query(`ALTER TABLE transactions ALTER COLUMN amount_uah SET NOT NULL`);
  }
}
