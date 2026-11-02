import type { MigrationInterface, QueryRunner } from "typeorm";

// When the last webhook item or daily reconcile succeeded; the app reads it for `syncStale`.
export class SettingsLastSync1793750400000 implements MigrationInterface {
  name = "SettingsLastSync1793750400000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE settings ADD COLUMN last_sync_at timestamptz`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE settings DROP COLUMN last_sync_at`);
  }
}
