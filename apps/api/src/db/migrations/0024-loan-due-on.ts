import type { MigrationInterface, QueryRunner } from "typeorm";

// Б7: «Вернуть до», the day the owner means to return a loan. A loan with it behaves as a payment on that day;
// one without it keeps its old place in the limit (see domain/loans.ts).
// Existing rows: none are touched; every loan starts with no return date (NULL).
export class LoanDueOn1795564800000 implements MigrationInterface {
  name = "LoanDueOn1795564800000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE loans ADD COLUMN due_on date`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE loans DROP COLUMN due_on`);
  }
}
