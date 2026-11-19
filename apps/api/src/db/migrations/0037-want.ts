import type { MigrationInterface, QueryRunner } from "typeorm";

// В6: «нужное» and «желаемое». `categories.want` is a category's side: false «нужное», true «желаемое», null for the
// system ones («Возвраты», «Без категории»), which stand on neither side; a check keeps it so. The seeded categories get
// the defaults of domain/want.ts (DEFAULT_WANT); an own category already made gets «нужное», as a new one does.
// `transactions.want_override` is the owner's choice for one operation; null follows its category.
// Existing rows: every category gets a side as above, every operation gets null (follows its category); nothing else
// changes, money included. Down drops both columns.
export class Want1796688000000 implements MigrationInterface {
  name = "Want1796688000000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE categories ADD COLUMN want boolean`);
    await q.query(`UPDATE categories SET want = key IN ('cafe', 'leisure', 'shopping', 'subscriptions') WHERE NOT system`);
    await q.query(`ALTER TABLE categories ADD CONSTRAINT categories_want_side CHECK ((want IS NULL) = system)`);
    await q.query(`ALTER TABLE transactions ADD COLUMN want_override boolean`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE transactions DROP COLUMN want_override`);
    await q.query(`ALTER TABLE categories DROP COLUMN want`);
  }
}
