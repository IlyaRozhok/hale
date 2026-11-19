import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { ObservationDto, ObservationRef, ObservationTodayDto } from "@hale/contracts";
import { DataSource, type EntityManager } from "typeorm";
import {
  type DismissedRow,
  type Observation,
  type ShownRow,
  type SpanSpendRow,
  findSpike,
  gateObservations,
  observationKey,
  spikeSpans,
  upcomingSubscriptions,
} from "../domain/observations";
import { kyivDate } from "../domain/money";
import { type ChargeRow, findSubscriptions, subscriptionsFrom } from "../domain/subscriptions";
import { SUBSCRIPTION_CHARGES_SQL } from "../insights/insights.service";
import { Clock } from "../time/clock";
import { TodayService } from "../today/today.service";
import { IN_LIMIT } from "../transactions/day-totals";

/**
 * Task В7: today's observation for the phrase of the day. Reads money, never writes it: the spending is the limit's
 * one definition (IN_LIMIT, signed as «Итоги» sign it), the subscriptions are the ones «Итоги» find, and the day's
 * mode and income date are «Сегодня»'s own (TodayService.getToday, which only reads). Its own two tables hold what was
 * shown and what was dismissed.
 */
@Injectable()
export class ObservationsService {
  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(TodayService) private readonly today: TodayService,
  ) {}

  async current(): Promise<ObservationTodayDto> {
    const today = kyivDate(this.clock.now());
    return { observation: await this.pick(this.ds.manager, today) };
  }

  /**
   * The app showed `ref`: today keeps it. It must be today's observation; marking the same one again changes nothing,
   * another one on the same day is refused.
   */
  async shown(ref: ObservationRef): Promise<ObservationTodayDto> {
    const today = kyivDate(this.clock.now());
    return this.ds.transaction(async (m) => {
      // One writer at a time per day: the row for the day is the lock's subject.
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('observations_shown'))`);
      const o = await this.pick(m, today);
      if (!o || observationKey(o.kind, o.category) !== observationKey(ref.kind, ref.category)) {
        throw new ConflictException("not today's observation");
      }
      await m.query(
        `INSERT INTO observations_shown (local_date, kind, category, observation) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (local_date) DO NOTHING`,
        [today, o.kind, o.category, JSON.stringify(o)],
      );
      return { observation: o };
    });
  }

  /** «Не показывать такое»: that category's spike, or the subscriptions kind, is never offered again. */
  async dismiss(ref: ObservationRef): Promise<void> {
    await this.ds.query(
      `INSERT INTO observation_dismissals (kind, category) VALUES ($1,$2) ON CONFLICT (kind, (COALESCE(category, ''))) DO NOTHING`,
      [ref.kind, ref.category],
    );
  }

  private async pick(m: EntityManager, today: string): Promise<ObservationDto | null> {
    const shown = (
      (await m.query(
        `SELECT local_date::text AS date, kind, category, observation FROM observations_shown WHERE local_date > $1::date - 14 ORDER BY local_date`,
        [today],
      )) as ShownRow[]
    );
    const dismissed = (await m.query(`SELECT kind, category FROM observation_dismissals`)) as DismissedRow[];
    const gate = gateObservations(today, shown, dismissed);
    if ("fixed" in gate) return gate.fixed;
    const { state, runway } = await this.today.getToday();
    if (state.mode === "bridge") {
      if (gate.excluded.has(observationKey("subscriptions", null))) return null;
      const charges = (await m.query(SUBSCRIPTION_CHARGES_SQL, [subscriptionsFrom(today), today])) as ChargeRow[];
      return upcomingSubscriptions(findSubscriptions(charges, today).items, today, runway?.incomeOn ?? null);
    }
    return this.spike(m, today, gate.excluded);
  }

  private async spike(m: EntityManager, today: string, excluded: ReadonlySet<string>): Promise<Observation | null> {
    const spans = spikeSpans(today).flatMap((s) => [s.current, ...s.previous].map((span, back) => ({ period: s.period, back, ...span })));
    const rows = (await m.query(
      `SELECT s.period, s.back, t.category, SUM(-t.amount_uah)::float8 AS spent
         FROM unnest($1::text[], $2::int[], $3::date[], $4::date[]) AS s(period, back, f, l)
         JOIN transactions t ON t.local_date BETWEEN s.f AND s.l
         JOIN accounts a ON a.id = t.account_id
        WHERE ${IN_LIMIT}
        GROUP BY 1, 2, 3`,
      [spans.map((s) => s.period), spans.map((s) => s.back), spans.map((s) => s.from), spans.map((s) => s.to)],
    )) as SpanSpendRow[];
    const history = (await m.query(`SELECT MIN(local_date)::text AS d FROM transactions`)) as { d: string | null }[];
    return findSpike(today, rows, history[0]?.d ?? null, excluded);
  }
}
