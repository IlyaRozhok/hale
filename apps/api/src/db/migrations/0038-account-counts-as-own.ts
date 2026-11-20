import type { MigrationInterface, QueryRunner } from "typeorm";

// Д2а: the person marks which bank accounts are their own money. `accounts.counts_as_own` is the mark; null follows
// the kind's default (domain/ledger.ts countsAsOwn: every kind but a jar), which is what an account monobank brings
// in later gets. `accounts.name` is the person's own name for the account; null shows the default one.
// Existing rows: every account gets the rule of before written out, so nothing the owner sees moves — the cards, the
// fop account and the wallet (black, white, fop, cash) true, jars and 'other' accounts false; every name null. No
// other row changes. Down drops both columns.
export class AccountCountsAsOwn1796774400000 implements MigrationInterface {
  name = "AccountCountsAsOwn1796774400000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE accounts ADD COLUMN counts_as_own boolean, ADD COLUMN name text`);
    await q.query(`UPDATE accounts SET counts_as_own = kind IN ('black', 'white', 'fop', 'cash')`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE accounts DROP COLUMN name, DROP COLUMN counts_as_own`);
  }
}
