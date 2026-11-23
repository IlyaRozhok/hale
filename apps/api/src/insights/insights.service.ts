import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { InsightsMonthDto } from "@hale/contracts";
import { DataSource, type EntityManager } from "typeorm";
import {
  type InsightsRow,
  type OtherPaymentsRow,
  type PlaceRow,
  buildInsights,
  buildOtherPayments,
  buildPlaces,
  insightsWindow,
  paidToPersonSql,
  placesLookbackFrom,
} from "../domain/insights";
import { outOfLimitPaymentSql } from "../domain/ledger";
import { type ChargeRow, type Subscriptions, findSubscriptions, subscriptionsFrom } from "../domain/subscriptions";
import { kyivDate } from "../domain/money";
import { type WantedRow, buildWanted, wantedSql } from "../domain/want";
import { Clock } from "../time/clock";
import { counterKeySql } from "../transactions/counter-key";
import { IN_LIMIT } from "../transactions/day-totals";

/**
 * A row at a place (task В3): from the limit, of type 'spend', off the cash wallet (whose entries carry the owner's
 * note, not a bank's merchant). Person transfers and withdrawals are not purchases, and neither is a transfer to a
 * person the owner made a purchase (Б56): it stays out of the places and, with them, of the subscriptions (В4, В7).
 */
const AT_PLACE = `${IN_LIMIT} AND t.type = 'spend' AND a.kind <> 'cash' AND NOT ${paidToPersonSql("t")}`;

/**
 * Task В4: every purchase at a place between $1 and $2, each named as «Операции» names its place's latest row; what
 * findSubscriptions reads. Task В7 reads the same rows for the subscriptions due before the income; both through
 * subscriptionsAsOf.
 */
const SUBSCRIPTION_CHARGES_SQL = `SELECT key, first_value(name) OVER (PARTITION BY key ORDER BY occurred_at DESC, id DESC) AS name, date, amount
         FROM (SELECT ${counterKeySql("t")} AS key, COALESCE(NULLIF(t.counter_name,''), t.description) AS name,
                      t.local_date::text AS date, (-t.amount_uah)::float8 AS amount, t.occurred_at, t.id
                 FROM transactions t JOIN accounts a ON a.id = t.account_id
                WHERE ${AT_PLACE} AND t.amount_uah < 0 AND t.local_date BETWEEN $1 AND $2) p`;

/**
 * The subscriptions as of the Kyiv day `asOf`, for «Итоги» (В4) and the observation of «Сегодня» (В7) alike: the
 * purchases at places before it, less the places the owner marked «Не подписка» (ЯМ6, table not_subscriptions).
 */
export async function subscriptionsAsOf(m: DataSource | EntityManager, asOf: string): Promise<Subscriptions> {
  const charges = (await m.query(SUBSCRIPTION_CHARGES_SQL, [subscriptionsFrom(asOf), asOf])) as ChargeRow[];
  const marked = (await m.query(`SELECT key FROM not_subscriptions`)) as { key: string }[];
  return findSubscriptions(charges, asOf, new Set(marked.map((r) => r.key)));
}

/**
 * Task В1: a month's spending by category against the same days of the month before. Spending is the limit's one
 * definition (IN_LIMIT, from domain/ledger.ts), signed as spentSql signs it: refunds lower their category's sum.
 * Task В3: the month's largest places over the same stretch, by the counterparty key the rest of the app uses.
 * Task В2а: what the payments outside the limit (outOfLimitPaymentSql) took over the same two stretches.
 * Task В4: the subscriptions as of the month's last counted day, from the purchases at places (AT_PLACE) before it.
 * Task В6: the part of `spent` on «желаемое» (wantedSql, domain/want.ts) over the same two stretches.
 * Task ЯМ6: the owner's «Не подписка» marks, which leave a place out of the subscriptions and nothing else.
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
    // Task В4: the subscriptions as of the month's last counted day, less the places marked «Не подписка» (ЯМ6).
    const subscriptions = await subscriptionsAsOf(this.ds, w.to);
    // Task В6: the part of `spent` on «желаемое» over the same two stretches, signed as `spent` is.
    const wanted = (await this.ds.query(
      `SELECT CASE WHEN t.local_date >= $1::date THEN 'current' ELSE 'previous' END AS period, SUM(-t.amount_uah)::float8 AS spent
         FROM transactions t JOIN accounts a ON a.id = t.account_id
        WHERE ${wantedSql("t", "a")} AND (t.local_date BETWEEN $1 AND $2 OR t.local_date BETWEEN $3 AND $4)
        GROUP BY 1`,
      [w.from, w.to, w.previousFrom, w.previousTo],
    )) as WantedRow[];
    return {
      ...buildInsights(w, rows),
      places: buildPlaces(places, history[0]?.d ?? null, w.month),
      ...buildOtherPayments(other),
      subscriptions,
      ...buildWanted(wanted),
      canMarkNotSubscription: true,
    };
  }

  /** ЯМ6: «Не подписка» on a subscription's place. Idempotent; any counterparty key, a place that charges later included. */
  async markNotSubscription(key: string): Promise<void> {
    await this.ds.query(`INSERT INTO not_subscriptions (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`, [key]);
  }

  /** ЯМ6: «Вернуть». Idempotent. */
  async unmarkNotSubscription(key: string): Promise<void> {
    await this.ds.query(`DELETE FROM not_subscriptions WHERE key = $1`, [key]);
  }
}
