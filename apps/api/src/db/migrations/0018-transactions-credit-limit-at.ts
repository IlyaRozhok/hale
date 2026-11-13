import type { MigrationInterface, QueryRunner } from "typeorm";

// A16: the balance right after an operation and the account's credit limit at that moment, so the
// operation card can say how much of a spend came from the credit limit. Existing rows keep NULL in
// both columns and are never marked: their limit at the time is not known.
export class TransactionsCreditLimitAt1795046400000 implements MigrationInterface {
  name = "TransactionsCreditLimitAt1795046400000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE transactions ADD COLUMN balance_after bigint, ADD COLUMN credit_limit_at bigint`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE transactions DROP COLUMN credit_limit_at, DROP COLUMN balance_after`);
  }
}
