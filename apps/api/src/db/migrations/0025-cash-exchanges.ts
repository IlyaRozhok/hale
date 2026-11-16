import type { MigrationInterface, QueryRunner } from "typeorm";

// Б22: USDC exchanged for cash in one action. The wallet row it makes is kept with the dollars given and the
// cents it really took off the Binance balance (never below zero, 0 with no Binance balance), so that changing
// or deleting the exchange gives back exactly them.
// A new, empty table: existing rows are not touched.
export class CashExchanges1795651200000 implements MigrationInterface {
  name = "CashExchanges1795651200000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE cash_exchanges (
      transaction_id integer PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
      usdc_cents bigint NOT NULL CHECK (usdc_cents > 0),
      binance_cents bigint NOT NULL DEFAULT 0 CHECK (binance_cents >= 0),
      created_at timestamptz NOT NULL DEFAULT now())`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE cash_exchanges`);
  }
}
