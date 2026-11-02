import type { MigrationInterface, QueryRunner } from "typeorm";

// The owner has answered whether this incoming row is a withdrawal from Binance.
export class TransactionsUsdcChecked1794528000000 implements MigrationInterface {
  name = "TransactionsUsdcChecked1794528000000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE transactions ADD COLUMN usdc_checked boolean NOT NULL DEFAULT false`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE transactions DROP COLUMN usdc_checked`);
  }
}
