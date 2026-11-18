import type { MigrationInterface, QueryRunner } from "typeorm";

// Б50: rows on a foreign-currency account stored before Б34 kept the hryvnias of the stored day's rate, even when
// the operation itself was made in hryvnias and the bank gave that side exactly (an exchange to the owner's own
// card). This takes the bank's hryvnias for them once, by the rule of hryvniaLeg() in domain/money.ts (keep the
// two the same): the bank item in `raw` has currencyCode 980, `amount` is not zero and `operationAmount` has its
// sign; then amount_uah = operationAmount and fx_rate = operationAmount / amount, so a later sync that recomputes
// amount × fx_rate lands on the same hryvnias. Rows typed by the owner get the exact hryvnias too; their type is
// not touched here, and the reclassify raised by CLASSIFIER_VERSION 2 does not touch it either. Every other row
// (hryvnia accounts and the cash wallet, operations in another currency, signs that disagree, a zero amount, a row
// without a bank item) is left as it is; so are daily snapshots: fixed past days stay as they were.
// Down is a no-op: the guessed amounts are not kept anywhere, and the exact ones are right for every version.
export class HryvniaLegAmounts1796256000000 implements MigrationInterface {
  name = "HryvniaLegAmounts1796256000000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE transactions t
          SET amount_uah = (t.raw->>'operationAmount')::numeric::bigint,
              fx_rate = (t.raw->>'operationAmount')::numeric / t.amount
         FROM accounts a
        WHERE a.id = t.account_id AND a.currency <> 'UAH'
          AND t.raw->'currencyCode' = '980'::jsonb
          AND jsonb_typeof(t.raw->'operationAmount') = 'number'
          AND t.amount <> 0
          AND sign((t.raw->>'operationAmount')::numeric) = sign(t.amount)`,
    );
  }

  async down(): Promise<void> {
    // Nothing to undo: see above.
  }
}
