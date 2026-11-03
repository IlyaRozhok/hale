import type { MigrationInterface, QueryRunner } from "typeorm";

// What the owner paid on a loan beyond its principal, when marking it repaid.
export class LoanServiceCost1794700800000 implements MigrationInterface {
  name = "LoanServiceCost1794700800000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE loans ADD COLUMN service_cost bigint NOT NULL DEFAULT 0`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE loans DROP COLUMN service_cost`);
  }
}
