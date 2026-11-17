import type { MigrationInterface, QueryRunner } from "typeorm";
import { kyivInstantSql } from "../../time/clock";

// Б39: the cash wallet starts at a moment, not only on a day. A card withdrawal, or cash from a transfer to the
// owner's card at another bank, feeds the wallet only when it happened at or after `cash_started_at`: cash taken
// earlier on the start day is already inside the opening balance.
// Existing rows: a started wallet gets the beginning of the Kyiv day of its `cash_start`, which is exactly the
// day-based rule it had, so no balance changes. A wallet not started keeps NULL. `cash_start` stays as it is.
// Down drops the column.
export class CashStartedAt1795910400000 implements MigrationInterface {
  name = "CashStartedAt1795910400000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE settings ADD COLUMN cash_started_at timestamptz`);
    await q.query(`UPDATE settings SET cash_started_at = ${kyivInstantSql("cash_start::timestamp")} WHERE cash_start IS NOT NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE settings DROP COLUMN cash_started_at`);
  }
}
