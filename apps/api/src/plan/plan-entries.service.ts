import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ExpectedIncomePatch, InstallmentInput, InstallmentPatch, RecurringPatch } from "@hale/contracts";
import { DataSource } from "typeorm";
import { ExpectedIncome, RecurringPayment } from "../db/entities";
import { LimitService } from "../today/limit.service";
import { PlanService } from "./plan.service";

/** The same day of a later month, or that month's last day. */
function monthsLater(date: string, n: number): string {
  const day = Number(date.slice(8, 10));
  const first = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.toISOString().slice(0, 7)}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/**
 * The owner's changes to the plan. Each reaches the rows already generated from it (what was paid or
 * received stays as it was) and applies at once: the day's limit is fixed afresh before the answer.
 */
@Injectable()
export class PlanEntriesService {
  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(PlanService) private readonly plan: PlanService,
    @Inject(LimitService) private readonly limit: LimitService,
  ) {}

  /** Today's fixed limit no longer holds: the day is fixed afresh now. */
  freshLimit(): Promise<void> {
    return this.limit.invalidate("plan");
  }

  /** Dates for something just added, so that it counts now and not at the next hourly job. */
  async generated(): Promise<void> {
    await this.plan.refresh();
    await this.freshLimit();
  }

  async patchRecurring(id: number, data: RecurringPatch): Promise<RecurringPayment> {
    const repo = this.ds.getRepository(RecurringPayment);
    if (Object.keys(data).length > 0) await repo.update(id, data);
    const row = await repo.findOneBy({ id });
    if (!row) throw new NotFoundException();
    await this.ds.query(
      `UPDATE scheduled_payments SET kind=$2, name=$3, amount=$4, currency=$5, match_hint=$6 WHERE recurring_id=$1 AND paid_at IS NULL`,
      [id, row.kind, row.name, row.amount, row.currency, row.match_hint],
    );
    if (data.day_of_month !== undefined) {
      // Not onto a day of that month a paid row already holds: one payment per day per series.
      await this.ds.query(
        `UPDATE scheduled_payments p SET due_on = d.due
           FROM (SELECT id, make_date(extract(year FROM due_on)::int, extract(month FROM due_on)::int,
                        LEAST($2::int, extract(day FROM (date_trunc('month', due_on) + interval '1 month - 1 day'))::int)) AS due
                   FROM scheduled_payments WHERE recurring_id=$1 AND paid_at IS NULL) d
          WHERE p.id = d.id AND NOT EXISTS (SELECT 1 FROM scheduled_payments o WHERE o.recurring_id=$1 AND o.due_on = d.due AND o.id <> p.id)`,
        [id, data.day_of_month],
      );
    }
    if (data.active === false) await this.ds.query(`DELETE FROM scheduled_payments WHERE recurring_id=$1 AND paid_at IS NULL`, [id]);
    await this.generated();
    return row;
  }

  async removeRecurring(id: number): Promise<{ deleted: true }> {
    const deleted = await this.ds.transaction(async (m) => {
      await m.query(`DELETE FROM scheduled_payments WHERE recurring_id=$1 AND paid_at IS NULL`, [id]);
      return (await m.getRepository(RecurringPayment).delete(id)).affected;
    });
    if (!deleted) throw new NotFoundException();
    await this.freshLimit();
    return { deleted: true };
  }

  async createInstallment(i: InstallmentInput): Promise<{ created: number }> {
    await this.ds.transaction(async (m) => {
      for (let n = 0; n < i.remaining; n++) {
        await m.query(
          `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('installment',$1,$2,$3,$4)`,
          [i.name, i.amount, i.currency, monthsLater(i.first_due, n)],
        );
      }
    });
    await this.freshLimit();
    return { created: i.remaining };
  }

  async patchInstallment(name: string, p: InstallmentPatch): Promise<{ updated: number }> {
    const r = (await this.ds.query(
      `UPDATE scheduled_payments SET name=COALESCE($2, name), amount=COALESCE($3, amount), currency=COALESCE($4, currency)
        WHERE kind='installment' AND name=$1 AND paid_at IS NULL`,
      [name, p.name ?? null, p.amount ?? null, p.currency ?? null],
    )) as [unknown[], number];
    if (r[1] === 0) throw new NotFoundException();
    await this.freshLimit();
    return { updated: r[1] };
  }

  async removeInstallment(name: string): Promise<{ deleted: true }> {
    const r = (await this.ds.query(`DELETE FROM scheduled_payments WHERE kind='installment' AND name=$1 AND paid_at IS NULL`, [name])) as [unknown[], number];
    if (r[1] === 0) throw new NotFoundException();
    await this.freshLimit();
    return { deleted: true };
  }

  async patchExpected(id: number, data: ExpectedIncomePatch): Promise<ExpectedIncome> {
    const repo = this.ds.getRepository(ExpectedIncome);
    if (Object.keys(data).length > 0) await repo.update(id, data);
    const row = await repo.findOneBy({ id });
    if (!row) throw new NotFoundException();
    await this.freshLimit();
    return row;
  }
}
