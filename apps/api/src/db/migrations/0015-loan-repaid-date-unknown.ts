import type { MigrationInterface, QueryRunner } from "typeorm";

// An old loan the owner knows was repaid, though not when.
export class LoanRepaidDateUnknown1794787200000 implements MigrationInterface {
  name = "LoanRepaidDateUnknown1794787200000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE loans ADD COLUMN repaid_date_unknown boolean NOT NULL DEFAULT false`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE loans DROP COLUMN repaid_date_unknown`);
  }
}
