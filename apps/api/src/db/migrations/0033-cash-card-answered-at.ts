import type { MigrationInterface, QueryRunner } from "typeorm";

// Б47.5: when the owner last answered «Снял наличными?» about a card. A card answered yes is asked about again a
// calendar month after that (see TodayService.cashCardQuestions). Cards answered before this migration get the
// migration's time, so the first question asked again comes a month after the deploy; nothing else changes.
export class CashCardAnsweredAt1796342400000 implements MigrationInterface {
  name = "CashCardAnsweredAt1796342400000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE cash_cards ADD COLUMN answered_at timestamptz NOT NULL DEFAULT now()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE cash_cards DROP COLUMN answered_at`);
  }
}
