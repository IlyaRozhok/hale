import type { MigrationInterface, QueryRunner } from "typeorm";

// Д3а: an income is a record with a name, a schedule, the account it comes to and two flags; its old kind (`source`,
// fop or usdc) becomes the flags. `schedule` is monthly (one payment in the window), twice (and a second one on
// `second_day`) or none (nothing expected). `pays_fop_tax`: the fop tax, and the income received by the month's money on
// the fop account. `crypto`: Binance and its questions. The account is one of `account_id` (a bank account, the cash
// wallet's row included), `manual_balance_id` or `to_cash` (the wallet before it has a row), or none. `source` stays for
// an older app, follows the flags, and is null for an income with neither. An income event gets `slot`: 2 for the
// second payment of a month, so a month holds two events of one income.
// Existing rows: the fop income is named «ФОП», pays the fop tax and comes to the fop account (the hryvnia one first);
// the usdc income is named «USDC», comes in crypto and comes to the Binance balance, if there is one. Both stay monthly
// with their windows. Every event is slot 1. No other row changes, so the limit, free money and the tax read the same.
// Down: incomes with neither flag and the second payments of a month are deleted, the rest loses the new columns.
export class IncomeSources1796860800000 implements MigrationInterface {
  name = "IncomeSources1796860800000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE expected_incomes
         ALTER COLUMN source DROP NOT NULL,
         ADD COLUMN name text NOT NULL DEFAULT '',
         ADD COLUMN schedule text NOT NULL DEFAULT 'monthly' CHECK (schedule IN ('monthly', 'twice', 'none')),
         ADD COLUMN second_day smallint CHECK (second_day BETWEEN 1 AND 31),
         ADD COLUMN pays_fop_tax boolean NOT NULL DEFAULT false,
         ADD COLUMN crypto boolean NOT NULL DEFAULT false,
         ADD COLUMN account_id integer REFERENCES accounts(id) ON DELETE SET NULL,
         ADD COLUMN manual_balance_id integer REFERENCES manual_balances(id) ON DELETE SET NULL,
         ADD COLUMN to_cash boolean NOT NULL DEFAULT false,
         ADD CONSTRAINT expected_incomes_second_day CHECK ((schedule = 'twice') = (second_day IS NOT NULL)),
         ADD CONSTRAINT expected_incomes_one_account CHECK (num_nonnulls(account_id, manual_balance_id, NULLIF(to_cash, false)) <= 1)`,
    );
    await q.query(
      `UPDATE expected_incomes SET name = 'ФОП', pays_fop_tax = true,
              account_id = (SELECT id FROM accounts WHERE kind = 'fop' ORDER BY (currency = 'UAH') DESC, id LIMIT 1)
        WHERE source = 'fop'`,
    );
    await q.query(
      `UPDATE expected_incomes SET name = 'USDC', crypto = true,
              manual_balance_id = (SELECT id FROM manual_balances WHERE name = 'Binance')
        WHERE source = 'usdc'`,
    );
    await q.query(
      `ALTER TABLE income_events
         ADD COLUMN slot smallint NOT NULL DEFAULT 1 CHECK (slot IN (1, 2)),
         DROP CONSTRAINT income_events_expected_income_id_period_key,
         ADD CONSTRAINT income_events_expected_income_id_period_slot_key UNIQUE (expected_income_id, period, slot)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM income_events WHERE slot = 2 OR expected_income_id IN (SELECT id FROM expected_incomes WHERE source IS NULL)`);
    await q.query(`DELETE FROM expected_incomes WHERE source IS NULL`);
    await q.query(
      `ALTER TABLE income_events
         DROP CONSTRAINT income_events_expected_income_id_period_slot_key,
         ADD CONSTRAINT income_events_expected_income_id_period_key UNIQUE (expected_income_id, period),
         DROP COLUMN slot`,
    );
    await q.query(
      `ALTER TABLE expected_incomes
         DROP CONSTRAINT expected_incomes_one_account,
         DROP CONSTRAINT expected_incomes_second_day,
         DROP COLUMN to_cash, DROP COLUMN manual_balance_id, DROP COLUMN account_id, DROP COLUMN crypto, DROP COLUMN pays_fop_tax,
         DROP COLUMN second_day, DROP COLUMN schedule, DROP COLUMN name,
         ALTER COLUMN source SET NOT NULL`,
    );
  }
}
