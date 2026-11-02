import type { MigrationInterface, QueryRunner } from "typeorm";

// What the bridge credit plan was computed from (due payments and the income date), so it is
// recomputed only when one of those changes and not after every purchase.
export class BridgePlanBasis1794096000000 implements MigrationInterface {
  name = "BridgePlanBasis1794096000000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE bridge_plans ADD COLUMN basis text NOT NULL DEFAULT ''`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE bridge_plans DROP COLUMN basis`);
  }
}
