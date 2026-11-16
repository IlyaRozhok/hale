import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { InsightsMonthDto } from "@hale/contracts";
import { DataSource } from "typeorm";
import { type InsightsRow, buildInsights, insightsWindow } from "../domain/insights";
import { kyivDate } from "../domain/money";
import { Clock } from "../time/clock";
import { IN_LIMIT } from "../transactions/day-totals";

/**
 * Task В1: a month's spending by category against the same days of the month before. Spending is the limit's one
 * definition (IN_LIMIT, from domain/ledger.ts), signed as spentSql signs it: refunds lower their category's sum.
 */
@Injectable()
export class InsightsService {
  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async month(month?: string): Promise<InsightsMonthDto> {
    const today = kyivDate(this.clock.now());
    const w = insightsWindow(month ?? today.slice(0, 7), today);
    if (!w) throw new BadRequestException("month: not started yet");
    const rows = (await this.ds.query(
      `SELECT t.category, CASE WHEN t.local_date >= $1::date THEN 'current' ELSE 'previous' END AS period,
              SUM(-t.amount_uah)::float8 AS spent, COUNT(*)::int AS count
         FROM transactions t JOIN accounts a ON a.id = t.account_id
        WHERE ${IN_LIMIT} AND (t.local_date BETWEEN $1 AND $2 OR t.local_date BETWEEN $3 AND $4)
        GROUP BY 1, 2`,
      [w.from, w.to, w.previousFrom, w.previousTo],
    )) as InsightsRow[];
    return buildInsights(w, rows);
  }
}
