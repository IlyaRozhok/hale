import type { MigrationInterface, QueryRunner } from "typeorm";

// Loans from before tracking began are history: they must not alert or count as borrowed.
// Short loans (Кредит до завтра, МФО) are repaid by debt_payment rows, tracked in repaid_amount.
export class LoanTracking1794268800000 implements MigrationInterface {
  name = "LoanTracking1794268800000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE settings ADD COLUMN tracking_start date NOT NULL DEFAULT CURRENT_DATE`);
    await q.query(
      `ALTER TABLE loans ADD COLUMN kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('short','other')),
                         ADD COLUMN repaid_amount bigint NOT NULL DEFAULT 0`,
    );
    await q.query(
      `CREATE TABLE loan_repayments (transaction_id integer PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE loan_repayments`);
    await q.query(`ALTER TABLE loans DROP COLUMN repaid_amount, DROP COLUMN kind`);
    await q.query(`ALTER TABLE settings DROP COLUMN tracking_start`);
  }
}
