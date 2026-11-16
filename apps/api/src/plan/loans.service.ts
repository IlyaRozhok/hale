import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { LoanHistoryDto, LoanRepayInput, LoanRowDto } from "@hale/contracts";
import { DataSource } from "typeorm";
import { kyivDate } from "../domain/money";
import { Clock, kyivDaySql, kyivInstantSql } from "../time/clock";
import { LimitService } from "../today/limit.service";
import { LOAN_COST_TEXT } from "./short-loan";

/** Closing, removing and reviewing loans. */
@Injectable()
export class LoansService {
  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LimitService) private readonly limit: LimitService,
  ) {}

  /**
   * The owner repaid a loan. Less than what is owed leaves it open with the rest still owed; more
   * counts the excess as the cost of the loan. The day's limit is fixed afresh at once, as what is owed changed.
   */
  async repay(id: number, { amount, date }: LoanRepayInput): Promise<LoanRowDto> {
    const today = kyivDate(this.clock.now());
    await this.ds.transaction(async (m) => {
      const loan = (
        await m.query(
          `SELECT amount::float8 AS amount, repaid_amount::float8 AS repaid_amount, received_on::text AS received_on, repaid_at
             FROM loans WHERE id=$1 FOR UPDATE`,
          [id],
        )
      )[0] as { amount: number; repaid_amount: number; received_on: string; repaid_at: Date | null } | undefined;
      if (!loan) throw new NotFoundException("loan not found");
      if (loan.repaid_at !== null) throw new ConflictException("loan is already repaid");
      if (date < loan.received_on || date > today) throw new UnprocessableEntityException("repayment date is outside the loan's life");
      const pay = Math.min(amount, loan.amount - loan.repaid_amount);
      const total = loan.repaid_amount + pay;
      await m.query(
        `UPDATE loans SET repaid_amount=$2::bigint, service_cost = service_cost + $3::bigint,
                repaid_at = CASE WHEN $2::bigint >= amount THEN ${kyivInstantSql("($4::date)::timestamp")} END
          WHERE id=$1`,
        [id, total, amount - pay, date],
      );
      await this.limit.invalidate("loan", m);
    });
    return (await this.rows(`l.id=$1`, [id]))[0]!;
  }

  /**
   * The owner knows the loans from before tracking were repaid, not when. They are not in the limit,
   * so the day's limit stays.
   */
  async repayOld(): Promise<{ closed: number }> {
    const rows: unknown[] = await this.ds.query(
      `UPDATE loans SET repaid_amount = amount, repaid_at = now(), repaid_date_unknown = true
        WHERE repaid_at IS NULL AND received_on < (SELECT tracking_start FROM settings WHERE id=1) RETURNING id`,
    );
    // TypeORM returns [rows, count] for an UPDATE on Postgres.
    return { closed: rows[1] as number };
  }

  /** A mistaken manual entry goes away; a loan from a bank row would come back with the next sync. */
  async remove(id: number): Promise<{ deleted: true }> {
    return this.ds.transaction(async (m) => {
      const loan = (await m.query(`SELECT source_transaction_id FROM loans WHERE id=$1 FOR UPDATE`, [id]))[0] as
        | { source_transaction_id: number | null }
        | undefined;
      if (!loan) throw new NotFoundException();
      if (loan.source_transaction_id !== null) throw new ConflictException("loan comes from a bank operation");
      await m.query(`DELETE FROM loans WHERE id=$1`, [id]);
      await this.limit.invalidate("loan", m);
      return { deleted: true as const };
    });
  }

  async history(): Promise<LoanHistoryDto> {
    const rows = await this.rows(`true`, []);
    const start = (await this.ds.query(`SELECT tracking_start::text AS d FROM settings WHERE id=1`))[0].d as string;
    const unpaid = rows.filter((l) => l.repaidOn === null);
    const open = unpaid.filter((l) => l.receivedOn >= start);
    const sum = (list: LoanRowDto[], pick: (l: LoanRowDto) => number) => list.reduce((s, l) => s + pick(l), 0);
    return {
      stats: {
        borrowed: sum(rows, (l) => l.amount),
        repaid: sum(rows, (l) => l.repaidAmount),
        serviceCost: sum(rows, (l) => l.serviceCost) + (await this.bankCost()),
        stillOpen: sum(open, (l) => l.remaining),
      },
      open,
      old: unpaid.filter((l) => l.receivedOn < start),
      repaid: rows.filter((l) => l.repaidOn !== null),
    };
  }

  /**
   * What lender and fee rows took beyond the principal they paid off. A lender repayment the owner
   * marked by hand counts as principal here, so this can only understate the cost, never invent it.
   */
  private async bankCost(): Promise<number> {
    const rows: { amount: number; text: string }[] = await this.ds.query(
      `SELECT ABS(t.amount_uah)::float8 AS amount, concat_ws(' ', t.description, t.comment, t.counter_name) AS text FROM transactions t
        WHERE t.type='debt_payment' AND t.amount < 0 AND t.amount_uah IS NOT NULL`,
    );
    const paid = rows.reduce((s, r) => (LOAN_COST_TEXT.test(r.text) ? s + r.amount : s), 0);
    const [{ principal }] = (await this.ds.query(
      `SELECT COALESCE(SUM(repaid_amount), 0)::float8 AS principal FROM loans WHERE kind='short'`,
    )) as [{ principal: number }];
    return Math.max(0, paid - principal);
  }

  private async rows(where: string, args: unknown[]): Promise<LoanRowDto[]> {
    const rows: (Omit<LoanRowDto, "title"> & { title: string | null })[] = await this.ds.query(
      `SELECT l.id, l.amount::float8 AS amount, (l.amount - l.repaid_amount)::float8 AS remaining, l.received_on::text AS "receivedOn",
              (${kyivDaySql("l.repaid_at")})::text AS "repaidOn", NOT l.repaid_date_unknown AS "repaidDateKnown", l.repaid_amount::float8 AS "repaidAmount",
              l.service_cost::float8 AS "serviceCost", l.source_transaction_id IS NULL AS manual, l.due_on::text AS "dueOn",
              CASE WHEN l.source_transaction_id IS NULL THEN l.note ELSE t.description END AS title
         FROM loans l LEFT JOIN transactions t ON t.id = l.source_transaction_id
        WHERE ${where} ORDER BY l.received_on DESC, l.id DESC`,
      args,
    );
    return rows;
  }
}
