import type { MigrationInterface, QueryRunner } from "typeorm";

// The cash wallet: an account with no bank statement, the date its records start, and cash
// deposits the owner says came from it. Nothing changes until the owner starts the wallet.
export class CashWallet1794873600000 implements MigrationInterface {
  name = "CashWallet1794873600000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE accounts DROP CONSTRAINT accounts_kind_check`);
    await q.query(`ALTER TABLE accounts ADD CONSTRAINT accounts_kind_check CHECK (kind IN ('black','white','fop','jar','other','cash'))`);
    await q.query(`ALTER TABLE settings ADD COLUMN cash_start date`);
    await q.query(`ALTER TABLE transactions ADD COLUMN from_wallet boolean NOT NULL DEFAULT false`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE transactions DROP COLUMN from_wallet`);
    await q.query(`ALTER TABLE settings DROP COLUMN cash_start`);
    await q.query(`DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE kind='cash')`);
    await q.query(`DELETE FROM accounts WHERE kind='cash'`);
    await q.query(`ALTER TABLE accounts DROP CONSTRAINT accounts_kind_check`);
    await q.query(`ALTER TABLE accounts ADD CONSTRAINT accounts_kind_check CHECK (kind IN ('black','white','fop','jar','other'))`);
  }
}
