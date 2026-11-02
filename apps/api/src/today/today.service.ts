import { ConflictException, Inject, Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { BridgePreviewDto, TodayDto } from "@tablo/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { type DailyInput, type DailyState, computeDaily, sumDue } from "../domain/daily";
import { CURRENCY_ALPHA, type Rates, addDays, daysBetween, kyivDate, toUah } from "../domain/money";
import { runOutDate } from "../domain/run-out";
import { taxReserve } from "../domain/tax";
import { Clock } from "./clock";

const STALE_SYNC_MS = 6 * 3_600_000;
const AVG_DAYS = 7;
const HORIZON_DAYS = 30;
/** Design §5.2 default: ₴100,000 a month, used until the owner sets one. */
const DEFAULT_LIFESTYLE_CAP = 10_000_000;
const MAX_RECIPIENT_QUESTIONS = 3;

const CODE_BY_ALPHA = new Map(Object.entries(CURRENCY_ALPHA).map(([code, alpha]) => [alpha, Number(code)]));

interface Plan {
  id: number;
  dailyAmount: number;
  creditPlan: number;
  basis: string;
}

interface Facts {
  date: string;
  input: Omit<DailyInput, "spentToday" | "bridgeDaily" | "creditPlan" | "cardsMoney"> & { cardsMoney: number };
  spentToday: number;
  avgDailySpend: number;
  credit: number;
  usdRate: number;
  rateStale: boolean;
  slots: { own: number; fop: number; binance: number };
  basis: string;
  plan: Plan | null;
  syncedAt: Date | null;
  limitVisual: "mercury" | "ring";
  now: Date;
}

const fmt = (kopecks: number) => `₴${Math.round(kopecks / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;

function quarterOf(date: string): { start: string; end: string; daysIn: number; dayOf: number } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  const start = `${y}-${String(qm).padStart(2, "0")}-01`;
  const ny = qm + 3 > 12 ? y + 1 : y;
  const nm = ((qm + 2) % 12) + 1;
  const next = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return { start, end: addDays(next, -1), daysIn: daysBetween(start, next), dayOf: daysBetween(start, date) + 1 };
}

/** Assembles the main screen from the database and the pure money engine; computes nothing itself. */
@Injectable()
export class TodayService {
  private readonly log = new Logger(TodayService.name);

  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** Fixes the day's limit even if the app is not opened. */
  @Cron("5 0 * * *", { timeZone: "Europe/Kyiv" })
  async snapshotJob(): Promise<void> {
    try {
      await this.getToday();
    } catch (e) {
      this.log.warn(`daily snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async getToday(): Promise<TodayDto> {
    const now = this.clock.now();
    const f = await this.load(kyivDate(now), now);
    let plan = f.plan;

    let state = this.compute(f, plan);
    if (plan && state.mode === "normal") {
      await this.ds.query(`UPDATE bridge_plans SET closed_on=$1 WHERE id=$2 AND closed_on IS NULL`, [f.date, plan.id]);
      plan = null;
    } else if (plan && state.mode === "bridge" && plan.basis !== f.basis) {
      // Payments or the income date changed: the plan is recomputed once, then fixed again.
      const needed = this.compute(f, { ...plan, creditPlan: 0 }, null).bridge!.creditNeeded;
      await this.ds.query(`UPDATE bridge_plans SET credit_plan=$2, basis=$3 WHERE id=$1`, [plan.id, needed, f.basis]);
      plan = { ...plan, creditPlan: needed, basis: f.basis };
      state = this.compute(f, plan);
    }

    const morning = this.compute(f, plan, 0, f.spentToday);
    const limit = await this.snapshot(f.date, morning);
    const leftToday = limit - f.spentToday;
    state = {
      ...state,
      dailyLimit: limit,
      leftToday,
      level: limit > 0 ? Math.min(1, Math.max(0, leftToday / limit)) : 0,
    };
    return this.dto(f, state);
  }

  async previewBridge(dailyAmount: number): Promise<BridgePreviewDto> {
    const now = this.clock.now();
    const f = await this.load(kyivDate(now), now);
    const b = this.compute(f, f.plan, null, undefined, dailyAmount).bridge;
    return { dailyAmount, creditNeeded: b?.creditNeeded ?? 0, shortfall: b?.shortfall ?? 0 };
  }

  async chooseBridge(dailyAmount: number): Promise<TodayDto> {
    const now = this.clock.now();
    const f = await this.load(kyivDate(now), now);
    const b = this.compute(f, f.plan, null, undefined, dailyAmount).bridge;
    if (!b) throw new ConflictException("bridge mode is not active: free money is not negative");
    if (b.shortfall > 0) {
      throw new UnprocessableEntityException(`the plan exceeds the credit limit by ${b.shortfall}`);
    }
    await this.ds.transaction(async (m) => {
      const open = await m.query(`SELECT id FROM bridge_plans WHERE closed_on IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`);
      if (open[0]) {
        await m.query(`UPDATE bridge_plans SET daily_amount=$2, credit_plan=$3, basis=$4 WHERE id=$1`, [
          open[0].id, dailyAmount, b.creditNeeded, f.basis,
        ]);
      } else {
        await m.query(`INSERT INTO bridge_plans (daily_amount, credit_plan, created_on, basis) VALUES ($1,$2,$3,$4)`, [
          dailyAmount, b.creditNeeded, f.date, f.basis,
        ]);
      }
      await m.query(
        `INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ($1,$2,'bridge')
         ON CONFLICT (local_date) DO UPDATE SET daily_limit=EXCLUDED.daily_limit, mode='bridge'`,
        [f.date, dailyAmount],
      );
    });
    return this.getToday();
  }

  // --- engine call ------------------------------------------------------------
  private compute(
    f: Facts,
    plan: Plan | null,
    creditPlan: number | null | undefined = plan?.creditPlan ?? null,
    addBack = 0,
    bridgeDaily: number | null = plan?.dailyAmount ?? null,
  ): DailyState {
    return computeDaily({
      ...f.input,
      cardsMoney: f.input.cardsMoney + addBack,
      spentToday: addBack > 0 ? 0 : f.spentToday,
      bridgeDaily,
      creditPlan: creditPlan ?? null,
    });
  }

  /** Writes the day's row once (concurrent first requests share it) and returns its limit. */
  private async snapshot(date: string, morning: DailyState): Promise<number> {
    return this.ds.transaction(async (m) => {
      await m.query(
        `INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ($1,$2,$3) ON CONFLICT (local_date) DO NOTHING`,
        [date, morning.dailyLimit, morning.mode],
      );
      const row = (
        await m.query(`SELECT daily_limit::float8 AS daily_limit, mode FROM daily_snapshots WHERE local_date=$1`, [date])
      )[0] as { daily_limit: number; mode: string };
      if (row.mode !== morning.mode) {
        await m.query(`UPDATE daily_snapshots SET daily_limit=$2, mode=$3 WHERE local_date=$1`, [
          date, morning.dailyLimit, morning.mode,
        ]);
        return morning.dailyLimit;
      }
      return row.daily_limit;
    });
  }

  // --- reading the database ---------------------------------------------------
  private async load(date: string, now: Date): Promise<Facts> {
    const m = this.ds.manager;
    const nowIso = now.toISOString();
    const q = quarterOf(date);

    const settings = (
      await m.query(
        `SELECT lifestyle_cap::float8 AS lifestyle_cap, food_floor::float8 AS food_floor, tax_rate_bp,
                esv_quarter::float8 AS esv_quarter, limit_visual, last_sync_at FROM settings WHERE id=1`,
      )
    )[0] as {
      lifestyle_cap: number; food_floor: number; tax_rate_bp: number; esv_quarter: number;
      limit_visual: "mercury" | "ring"; last_sync_at: Date | null;
    };

    const rateRows: { currency: string; rate: number; fetched_at: Date }[] = await m.query(
      `SELECT DISTINCT ON (currency) currency, rate::float8 AS rate, fetched_at FROM fx_rates ORDER BY currency, fetched_at DESC`,
    );
    const rates: Rates = Object.fromEntries(
      rateRows.map((r) => [r.currency, { rate: r.rate, fetchedAt: r.fetched_at.toISOString() }]),
    );
    let stale = false;
    /** Converts to hryvnias; a missing rate counts as 0 and marks the rate stale rather than failing the screen. */
    const uah = (amount: number, alpha: string): number => {
      if (alpha === "UAH") return amount;
      const code = CODE_BY_ALPHA.get(alpha);
      if (code === undefined || !rates[alpha]) {
        stale = true;
        return 0;
      }
      const r = toUah(amount, code, rates, nowIso);
      stale ||= r.stale;
      return r.uah;
    };

    // own money
    const accounts: { kind: string; currency: string; balance: number; credit_limit: number }[] = await m.query(
      `SELECT kind, currency, balance::float8 AS balance, credit_limit::float8 AS credit_limit FROM accounts WHERE kind IN ('black','white','fop')`,
    );
    let cards = 0, fop = 0, credit = 0;
    for (const a of accounts) {
      const own = uah(a.balance - a.credit_limit, a.currency);
      if (a.kind === "fop") fop += own;
      else {
        cards += own;
        credit += uah(a.credit_limit, a.currency);
      }
    }
    // The Binance balance and any other manual balance that counts as own money share one slot.
    const manual: { name: string; amount: number; currency: string }[] = await m.query(
      `SELECT name, amount::float8 AS amount, currency FROM manual_balances WHERE counts_as_own ORDER BY id`,
    );
    const binance = manual.reduce((s, b) => s + uah(b.amount, b.currency), 0);

    // income dates and loans
    const next = (await m.query(`SELECT min(expected_on)::text AS d FROM income_events WHERE status <> 'received'`))[0].d as string | null;
    const lastIncome = (
      await m.query(`SELECT ((max(received_at) AT TIME ZONE 'Europe/Kyiv')::date)::text AS d FROM income_events WHERE status = 'received'`)
    )[0].d as string | null;
    const loans: { amount: number }[] = await m.query(
      `SELECT amount::float8 AS amount FROM loans WHERE repaid_at IS NULL AND ($1::date IS NULL OR received_on >= $1::date)`,
      [lastIncome],
    );
    const borrowed = loans.reduce((s, l) => s + l.amount, 0);

    // payments
    const pays: { kind: string; amount: number; currency: string; due_on: string; paid: boolean }[] = await m.query(
      `SELECT kind, amount::float8 AS amount, currency, due_on::text AS due_on, (paid_at IS NOT NULL) AS paid
         FROM scheduled_payments WHERE paid_at IS NULL`,
    );
    const obligationsDue = sumDue(
      pays.filter((p) => p.kind !== "tax").map((p) => ({ dueOn: p.due_on, amount: uah(p.amount, p.currency), paid: p.paid })),
      date,
      next,
    );
    const unpaidScheduled = pays.filter((p) => p.kind === "tax").reduce((s, p) => s + uah(p.amount, p.currency), 0);

    // tax reserve
    const fopIncome = (
      await m.query(
        `SELECT COALESCE(SUM(t.amount_uah),0)::float8 AS s FROM transactions t JOIN accounts a ON a.id=t.account_id
          WHERE a.kind='fop' AND t.type='income' AND t.local_date BETWEEN $1 AND $2`,
        [q.start, q.end],
      )
    )[0].s as number;
    const paidTax = (
      await m.query(
        `SELECT COALESCE(SUM(-t.amount_uah),0)::float8 AS s FROM transactions t
          WHERE t.type='tax' AND t.amount < 0 AND t.local_date BETWEEN $1 AND $2
            AND NOT EXISTS (SELECT 1 FROM scheduled_payments p WHERE p.transaction_id = t.id)`,
        [q.start, q.end],
      )
    )[0].s as number;
    const reserve = taxReserve({
      fopIncomeQuarter: fopIncome,
      rateBp: settings.tax_rate_bp,
      esvQuarter: settings.esv_quarter,
      dayOfQuarter: q.dayOf,
      daysInQuarter: q.daysIn,
      paidAgainstCurrentQuarter: paidTax,
      unpaidScheduled,
    });

    const spentToday = await this.spent(m, date, date);
    const avgDailySpend = Math.max(0, Math.round((await this.spent(m, addDays(date, -AVG_DAYS), addDays(date, -1))) / AVG_DAYS));

    const planRow = (
      await m.query(
        `SELECT id, daily_amount::float8 AS daily_amount, credit_plan::float8 AS credit_plan, basis
           FROM bridge_plans WHERE closed_on IS NULL ORDER BY id DESC LIMIT 1`,
      )
    )[0] as { id: number; daily_amount: number; credit_plan: number; basis: string } | undefined;

    const usd = rates.USD;
    const usdStale = !usd || Date.parse(nowIso) - Date.parse(usd.fetchedAt) > 48 * 3_600_000;

    return {
      date,
      now,
      input: {
        today: date,
        cardsMoney: cards,
        fopMoney: fop,
        binanceMoney: binance,
        creditLimit: credit,
        taxReserve: reserve,
        obligationsDue,
        goalDue: 0,
        borrowed,
        nextIncomeOn: next,
        lifestyleCapMonthly: settings.lifestyle_cap > 0 ? settings.lifestyle_cap : DEFAULT_LIFESTYLE_CAP,
        foodFloor: settings.food_floor,
      },
      spentToday,
      avgDailySpend,
      credit,
      usdRate: usd?.rate ?? 0,
      rateStale: stale || usdStale,
      slots: { own: cards + fop + binance, fop, binance },
      basis: `${obligationsDue}|${unpaidScheduled}|${next ?? ""}`,
      plan: planRow
        ? { id: planRow.id, dailyAmount: planRow.daily_amount, creditPlan: planRow.credit_plan, basis: planRow.basis }
        : null,
      syncedAt: settings.last_sync_at,
      limitVisual: settings.limit_visual,
    };
  }

  /** What counted against the limit between two dates: spend (refunds reduce it), cash out and person transfers. */
  private async spent(m: EntityManager, from: string, to: string): Promise<number> {
    const r = await m.query(
      `SELECT COALESCE(SUM(-t.amount_uah),0)::float8 AS s FROM transactions t JOIN accounts a ON a.id=t.account_id
        WHERE a.kind <> 'jar' AND t.amount_uah IS NOT NULL AND t.local_date BETWEEN $1 AND $2
          AND t.type IN ('spend','cash_out','person_transfer')`,
      [from, to],
    );
    return r[0].s;
  }

  // --- the response -------------------------------------------------------------
  private async dto(f: Facts, state: DailyState): Promise<TodayDto> {
    const m = this.ds.manager;
    const horizon = f.input.nextIncomeOn && f.input.nextIncomeOn >= f.date ? f.input.nextIncomeOn : addDays(f.date, HORIZON_DAYS);

    const upRows: { id: number; name: string; amount: number; currency: string; due_on: string; kind: string }[] = await m.query(
      `SELECT id, name, amount::float8 AS amount, currency, due_on::text AS due_on, kind FROM scheduled_payments
        WHERE paid_at IS NULL AND due_on < $1 ORDER BY due_on, id`,
      [horizon],
    );
    const rates = await this.rateMap();
    const upcoming = upRows.map((p) => ({
      id: String(p.id),
      name: p.name,
      amount: p.currency === "UAH" ? p.amount : Math.round(p.amount * (rates[p.currency] ?? 0)),
      dueOn: p.due_on,
      kind: p.kind,
    }));

    const questions: TodayDto["questions"] = [];
    const usdc: { id: number }[] = await m.query(
      `SELECT e.id FROM income_events e JOIN expected_incomes x ON x.id = e.expected_income_id
        WHERE x.source='usdc' AND e.status <> 'received' AND e.period=$1
          AND $2::int BETWEEN x.window_start_day AND x.window_end_day ORDER BY e.id`,
      [f.date.slice(0, 7), Number(f.date.slice(8, 10))],
    );
    for (const e of usdc) questions.push({ id: `usdc_arrived:${e.id}`, kind: "usdc_arrived", text: "Пришло на Binance?" });
    if (state.needsIncomeDate) {
      const ev = (await m.query(`SELECT id FROM income_events WHERE status <> 'received' ORDER BY expected_on, id LIMIT 1`))[0] as
        | { id: number }
        | undefined;
      questions.push({
        id: ev ? `income_date:${ev.id}` : "income_date",
        kind: "income_date",
        text: "Когда ожидается следующий доход?",
      });
    }
    const people: { key: string; id: number }[] = await m.query(
      `SELECT key, id FROM (
         SELECT DISTINCT ON (key) key, id, occurred_at FROM (
           SELECT COALESCE(NULLIF(t.counter_name,''), t.description) AS key, t.id, t.occurred_at
             FROM transactions t JOIN accounts a ON a.id=t.account_id
            WHERE t.needs_label AND t.type='person_transfer' AND a.kind <> 'jar'
         ) s ORDER BY key, occurred_at DESC, id DESC
       ) d ORDER BY occurred_at DESC, id DESC LIMIT $1`,
      [MAX_RECIPIENT_QUESTIONS],
    );
    for (const p of people) {
      questions.push({ id: `recipient_label:${p.id}`, kind: "recipient_label", text: `Кто это: ${p.key}?` });
    }

    const badCases: TodayDto["badCases"] = [];
    const loans: { id: number; amount: number; received_on: string }[] = await m.query(
      `SELECT id, amount::float8 AS amount, received_on::text AS received_on FROM loans WHERE repaid_at IS NULL ORDER BY received_on, id`,
    );
    for (const l of loans) {
      badCases.push({ id: `loan:${l.id}`, text: `Займ ${fmt(l.amount)} от ${l.received_on} ещё не погашен.` });
    }
    if (state.bridge?.overPlan) {
      badCases.push({ id: "bridge_over_plan", text: "Минус вышел за план моста. Деньги на планируемый срок не хватят." });
    }

    return {
      date: f.date,
      state,
      usdRate: f.usdRate,
      rateStale: f.rateStale,
      accounts: { own: f.slots.own, credit: f.credit, fop: f.slots.fop, binance: f.slots.binance },
      upcoming,
      questions,
      badCases,
      runOutOn: runOutDate({ free: state.free, avgDailySpend: f.avgDailySpend, today: f.date }),
      syncedAt: f.syncedAt ? f.syncedAt.toISOString() : null,
      syncStale: !f.syncedAt || f.now.getTime() - f.syncedAt.getTime() > STALE_SYNC_MS,
      limitVisual: f.limitVisual,
    };
  }

  private async rateMap(): Promise<Record<string, number>> {
    const rows: { currency: string; rate: number }[] = await this.ds.query(
      `SELECT DISTINCT ON (currency) currency, rate::float8 AS rate FROM fx_rates ORDER BY currency, fetched_at DESC`,
    );
    return Object.fromEntries(rows.map((r) => [r.currency, r.rate]));
  }
}
