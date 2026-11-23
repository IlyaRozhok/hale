import type { MigrationInterface, QueryRunner } from "typeorm";

// ЯМ6: places the owner marked «Не подписка» in «Итоги» → «Подписки». `key` is the place's counterparty key, the one
// subscriptions and «Операции» use (counterKeySql: 16 hex characters); one row a place. A marked place is never found
// as a subscription again, in «Итоги» or in the observation of «Сегодня»; «Вернуть» deletes its row. Nothing else reads
// it: the limit and every other sum stay as they were.
// Existing rows: one new empty table; nothing else is touched. Down drops it, and every mark with it.
export class NotSubscriptions1796947200000 implements MigrationInterface {
  name = "NotSubscriptions1796947200000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE not_subscriptions (
      key text PRIMARY KEY CHECK (key ~ '^[0-9a-f]{16}$'),
      created_at timestamptz NOT NULL DEFAULT now())`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE not_subscriptions`);
  }
}
