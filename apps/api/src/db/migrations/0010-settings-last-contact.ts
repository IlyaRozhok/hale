import type { MigrationInterface, QueryRunner } from "typeorm";

// The last time monobank answered at all. A quiet day has no webhook items, but the bank is still in touch.
export class SettingsLastContact1794355200000 implements MigrationInterface {
  name = "SettingsLastContact1794355200000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE settings ADD COLUMN last_contact_at timestamptz`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE settings DROP COLUMN last_contact_at`);
  }
}
