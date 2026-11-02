import type { MigrationInterface, QueryRunner } from "typeorm";

// A rule made from an outgoing payment must not retype money coming back, and the other way round.
// NULL keeps the old behaviour (either direction).
export class RuleDirection1794182400000 implements MigrationInterface {
  name = "RuleDirection1794182400000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE rules ADD COLUMN direction text CHECK (direction IN ('in','out'))`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE rules DROP COLUMN direction`);
  }
}
