import type { MigrationInterface, QueryRunner } from "typeorm";

// ЯМ5: a goal is kept in a place from «Отложено» — a bank account (a jar, a currency account) or a balance kept by hand
// (Binance, a deposit) — and its progress is that place's balance, read when asked; nothing is copied. `currency` is the
// goal's target's currency, the place's own; minor units as before (`target_cents`, `saved_cents`). `saved_cents` stays
// what was entered by hand and counts only for a goal without a place. A place that goes leaves the goal without one.
// Goals do not touch the limit or any other sum; nothing here moves money.
// Existing rows: every goal gets currency USD (what they were in) and no place, and keeps its target and saved amount as
// they were. No other table changes.
// Down: a goal in another currency than dollars cannot be read by the code before 0041 (it reads every goal in dollars)
// and is deleted; the rest lose the place and the currency and stay as they were.
export class GoalPlace1797033600000 implements MigrationInterface {
  name = "GoalPlace1797033600000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE goals
         ADD COLUMN currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
         ADD COLUMN account_id integer REFERENCES accounts(id) ON DELETE SET NULL,
         ADD COLUMN manual_balance_id integer REFERENCES manual_balances(id) ON DELETE SET NULL,
         ADD CONSTRAINT goals_one_place CHECK (num_nonnulls(account_id, manual_balance_id) <= 1)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM goals WHERE currency <> 'USD'`);
    await q.query(
      `ALTER TABLE goals DROP CONSTRAINT goals_one_place, DROP COLUMN manual_balance_id, DROP COLUMN account_id, DROP COLUMN currency`,
    );
  }
}
