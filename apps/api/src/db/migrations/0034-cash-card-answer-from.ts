import type { MigrationInterface, QueryRunner } from "typeorm";

// Б47.6: an answer to «Снял наличными?» about a card covers the card's transfers from the one it was given about
// on (from_at, that transfer's time), not earlier ones, so a card can now hold several answers. A card's first
// answer covers everything before it too ('-infinity'), and so does every answer given before this migration:
// its transfers keep the meaning they had, and nothing in the wallet changes. Down keeps each card's latest answer.
export class CashCardAnswerFrom1796428800000 implements MigrationInterface {
  name = "CashCardAnswerFrom1796428800000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE cash_cards ADD COLUMN from_at timestamptz NOT NULL DEFAULT '-infinity'`);
    await q.query(`ALTER TABLE cash_cards DROP CONSTRAINT cash_cards_pkey`);
    await q.query(`ALTER TABLE cash_cards ADD PRIMARY KEY (counter_key, from_at)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM cash_cards c WHERE EXISTS (SELECT 1 FROM cash_cards n WHERE n.counter_key = c.counter_key AND n.from_at > c.from_at)`,
    );
    await q.query(`ALTER TABLE cash_cards DROP CONSTRAINT cash_cards_pkey`);
    await q.query(`ALTER TABLE cash_cards ADD PRIMARY KEY (counter_key)`);
    await q.query(`ALTER TABLE cash_cards DROP COLUMN from_at`);
  }
}
