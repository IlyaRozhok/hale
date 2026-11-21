import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { InstallmentInput, InstallmentPatch, RecurringInput, RecurringPatch } from "@hale/contracts";
import { DataSource } from "typeorm";
import { ExpectedIncome, RecurringPayment } from "../db/entities";
import type { IncomeRow } from "../domain/incomes";
import { kyivDate } from "../domain/money";
import { windowEndDate } from "../domain/recurring-match";
import { Clock } from "../time/clock";
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
    @Inject(Clock) private readonly clock: Clock,
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

  /** A new series starts today: no payment of it falls due earlier (Б29). */
  async createRecurring(data: RecurringInput): Promise<RecurringPayment> {
    const repo = this.ds.getRepository(RecurringPayment);
    const row = await repo.save(repo.create({ ...data, starts_on: kyivDate(this.clock.now()) }));
    await this.generated();
    return row;
  }

  /**
   * A planned payment deleted. A month deleted from a monthly series is remembered, so that the next
   * generation does not bring it back (Б29).
   */
  async removePayment(id: number): Promise<{ deleted: true }> {
    const deleted = await this.ds.transaction(async (m) => {
      const [rows] = (await m.query(`DELETE FROM scheduled_payments WHERE id=$1 RETURNING recurring_id, due_on::text AS due_on`, [id])) as [
        { recurring_id: number | null; due_on: string }[],
        number,
      ];
      const r = rows[0];
      if (r?.recurring_id != null) {
        await m.query(`INSERT INTO recurring_skips (recurring_id, due_on) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [r.recurring_id, r.due_on]);
      }
      return rows.length;
    });
    if (!deleted) throw new NotFoundException();
    await this.freshLimit();
    return { deleted: true };
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

  /**
   * The income as it now is (`next`, already checked). Its events still expected follow it; what was received stays.
   * Б28: they move to the window's new end, or a second payment to its new day, except a date the owner set himself.
   * Д3а: without a schedule nothing is expected any more, so they go; leaving «Два раза в месяц» takes the second
   * payments; a schedule that starts expecting gets its events at once.
   */
  async patchExpected(id: number, cur: IncomeRow, next: IncomeRow): Promise<ExpectedIncome> {
    const row = await this.ds.transaction(async (m) => {
      const repo = m.getRepository(ExpectedIncome);
      const { source, name, amount, currency, window_start_day, window_end_day, schedule, second_day } = next;
      const { pays_fop_tax, crypto, account_id, manual_balance_id, to_cash } = next;
      await repo.update(id, {
        source, name, amount, currency, window_start_day, window_end_day, schedule, second_day, pays_fop_tax, crypto, account_id, manual_balance_id, to_cash,
      });
      const r = await repo.findOneBy({ id });
      if (!r) throw new NotFoundException();
      const waiting = `expected_income_id=$1 AND status <> 'received'`;
      if (r.schedule === "none") await m.query(`DELETE FROM income_events WHERE ${waiting}`, [id]);
      else if (r.schedule !== "twice") await m.query(`DELETE FROM income_events WHERE ${waiting} AND slot = 2`, [id]);
      // Only a day that changed moves its events: a date left as it was stays where it is.
      const moved = [r.window_end_day !== cur.window_end_day ? 1 : null, r.second_day !== cur.second_day ? 2 : null].filter((s) => s !== null);
      const events = (await m.query(
        `SELECT id, period, slot FROM income_events WHERE ${waiting} AND NOT date_set_by_hand AND slot = ANY($2::int[])`,
        [id, moved],
      )) as { id: number; period: string; slot: number }[];
      for (const e of events) {
        const day = e.slot === 2 ? r.second_day! : r.window_end_day;
        await m.query(`UPDATE income_events SET expected_on=$2 WHERE id=$1`, [e.id, windowEndDate(e.period, day)]);
      }
      return r;
    });
    await this.generated();
    return row;
  }
}
