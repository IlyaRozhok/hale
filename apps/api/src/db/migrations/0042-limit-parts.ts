import type { MigrationInterface, QueryRunner } from "typeorm";

// ЧЛ2 (the owner's decision of 24 November, «А: хранить»): what the day's limit is made of — own money, each reserve,
// free money, the days, the share, the rule — is kept with the limit, written wherever the limit is written and from the
// computation that gave it, so «Как посчитан лимит» always explains the figure on the screen.
// Existing rows: nothing changes; `parts` stays NULL for every day fixed before this, and such a day is answered
// without the parts. No limit, mode or other sum moves.
// Down: the column is dropped; limits and modes stay as they were.
export class LimitParts1797120000000 implements MigrationInterface {
  name = "LimitParts1797120000000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE daily_snapshots ADD COLUMN parts jsonb`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE daily_snapshots DROP COLUMN parts`);
  }
}
