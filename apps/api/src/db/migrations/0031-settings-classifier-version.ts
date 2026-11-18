import type { MigrationInterface, QueryRunner } from "typeorm";

// Б49: settings.classifier_version is the CLASSIFIER_VERSION (domain/classify.ts) the stored rows were last
// reclassified with. At start the server compares it with its own and, when it is older, queues one reclassify of
// every row not typed by the owner. Existing row: gets 0, so the first start after this deploy reclassifies once.
// Transactions and every other setting are not touched by the migration. Down drops the column.
export class SettingsClassifierVersion1796169600000 implements MigrationInterface {
  name = "SettingsClassifierVersion1796169600000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE settings ADD COLUMN classifier_version integer NOT NULL DEFAULT 0`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE settings DROP COLUMN classifier_version`);
  }
}
