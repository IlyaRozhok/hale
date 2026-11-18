import type { MigrationInterface, QueryRunner } from "typeorm";

// Б36: deleting a rule gives back to automatic recognition only the rows the owner changed through that rule.
// transactions.owner_rule_id says, for a row the owner typed (type_source 'owner'), how it was typed:
// - NULL: by the owner's hand on this row alone (or through a path that knows no rule), never given back;
// - a rule id: through that rule (an edit with «apply to similar», a recipient answer), given back with it;
// - -1: before this was recorded, so unknown; given back by a matching rule of its type, as before.
// Existing rows: every row with type_source 'owner' gets -1, so old rules still undo what they did; every other row
// gets NULL. Types, categories and sources are not touched. Down drops the column.
export class OwnerRuleMark1796083200000 implements MigrationInterface {
  name = "OwnerRuleMark1796083200000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE transactions ADD COLUMN owner_rule_id integer`);
    await q.query(`UPDATE transactions SET owner_rule_id = -1 WHERE type_source = 'owner'`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE transactions DROP COLUMN owner_rule_id`);
  }
}
