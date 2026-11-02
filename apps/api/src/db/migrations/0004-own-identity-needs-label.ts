import type { MigrationInterface, QueryRunner } from "typeorm";

// accounts.iban / accounts.title (jar title) let the classifier recognise the owner's own
// accounts and jars; transactions.needs_label records that the owner should be asked.
export class OwnIdentityNeedsLabel1793836800000 implements MigrationInterface {
  name = "OwnIdentityNeedsLabel1793836800000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE accounts ADD COLUMN iban text, ADD COLUMN title text`);
    await q.query(`ALTER TABLE transactions ADD COLUMN needs_label boolean NOT NULL DEFAULT false`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE transactions DROP COLUMN needs_label`);
    await q.query(`ALTER TABLE accounts DROP COLUMN title, DROP COLUMN iban`);
  }
}
