import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { InsightsMonthDto } from "@hale/contracts";
import { DataSource } from "typeorm";
import {
  type InsightsRow,
  type OtherPaymentsRow,
  type PlaceRow,
  buildInsights,
  buildOtherPayments,
  buildPlaces,
  insightsWindow,
  placesLookbackFrom,
} from "../domain/insights";
import { outOfLimitPaymentSql } from "../domain/ledger";
import { kyivDate } from "../domain/money";
import { Clock } from "../time/clock";
import { counterKeySql } from "../transactions/counter-key";
import { IN_LIMIT } from "../transactions/day-totals";

/**
 * A row at a place (task В3): from the limit, of type 'spend', off the cash wallet (whose entries carry the owner's
 * note, not a bank's merchant). Person transfers and withdrawals are not purchases.
 */
const AT_PLACE = `${IN_LIMIT} AND t.type = 'spend' AND a.kind <> 'cash'`;

/**
 * Task В1: a month's spending by category against the same days of the month before. Spending is the limit's one
 * definition (IN_LIMIT, from domain/ledger.ts), signed as spentSql signs it: refunds lower their category's sum.
 * Task В3: the month's largest places over the same stretch, by the counterparty key the rest of the app uses.
 * Task В2а: what the payments outside the limit (outOfLimitPaymentSql) took over the same two stretches.
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
    // The name is the latest row's, as «Операции» names it; a purchase in the lookback makes the place a known one.
    const places = (await this.ds.query(
      `WITH cur AS (
         SELECT ${counterKeySql("t")} AS key,
                (array_agg(COALESCE(NULLIF(t.counter_name,''), t.description) ORDER BY t.occurred_at DESC, t.id DESC))[1] AS name,
                SUM(-t.amount_uah)::float8 AS spent, (COUNT(*) FILTER (WHERE t.amount_uah < 0))::int AS visits
           FROM transactions t JOIN accounts a ON a.id = t.account_id
          WHERE ${AT_PLACE} AND t.local_date BETWEEN $1 AND $2
          GROUP BY 1),
       before AS (
         SELECT DISTINCT ${counterKeySql("t")} AS key
           FROM transactions t JOIN accounts a ON a.id = t.account_id
          WHERE ${AT_PLACE} AND t.amount_uah < 0 AND t.local_date >= $3::date AND t.local_date < $1::date)
       SELECT cur.key, cur.name, cur.spent, cur.visits, (before.key IS NOT NULL) AS "seenBefore"
         FROM cur LEFT JOIN before ON before.key = cur.key`,
      [w.from, w.to, placesLookbackFrom(w.month)],
    )) as PlaceRow[];
    const history = (await this.ds.query(`SELECT MIN(local_date)::text AS d FROM transactions`)) as { d: string | null }[];
    // Task В2а: the payments the limit leaves out, over the same two stretches, signed as `spent` is.
    const other = (await this.ds.query(
      `SELECT CASE WHEN t.local_date >= $1::date THEN 'current' ELSE 'previous' END AS period, SUM(-t.amount_uah)::float8 AS spent
         FROM transactions t JOIN accounts a ON a.id = t.account_id
        WHERE ${outOfLimitPaymentSql("t", "a")} AND (t.local_date BETWEEN $1 AND $2 OR t.local_date BETWEEN $3 AND $4)
        GROUP BY 1`,
      [w.from, w.to, w.previousFrom, w.previousTo],
    )) as OtherPaymentsRow[];
    return { ...buildInsights(w, rows), places: buildPlaces(places, history[0]?.d ?? null, w.month), ...buildOtherPayments(other) };
  }
}
