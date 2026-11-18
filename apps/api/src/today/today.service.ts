import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { BridgePreviewDto, CalendarDto, OwnMoneyItemDto, SettingsPreviewDto, TodayDto } from "@hale/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { currentStreak, dayStatus } from "../domain/calendar";
import { leftForGoalsMonthly } from "../domain/goals";
import { lastIncomeBoundary, loanReserve, type ReceivedIncome } from "../domain/loans";
import { type DailyInput, type DailyState, type DayMark, computeDaily, dayMark, dueWindowEnd, sumDue } from "../domain/daily";
import { spentByDaySql, spentSql } from "../domain/ledger";
import { runway } from "../domain/runway";
import { CURRENCY_ALPHA, type Rates, addDays, kyivDate, toUah } from "../domain/money";
import { quarterLabel, quarterOf } from "../domain/quarter";
import { runOutDate } from "../domain/run-out";
import { taxReserve } from "../domain/tax";
import { usdcMatchRows } from "../domain/usdc-match";
import { PAID_QUESTION_WINDOW_DAYS, type PayableTx, type Payment, paidQuestions } from "../domain/recurring-match";
import { BINANCE } from "../plan/plan.service";
import { cardTail, isCounterpartyName, transfersWord, unnamedTransferQuestion } from "../domain/counterparty";
import { TRANSFER_MCCS } from "../domain/merchants";
import { counterKeySql } from "../transactions/counter-key";
import { paymentCandidateIds } from "../cash/candidates";
import { cardTransferSql, walletBalance } from "../cash/wallet";
import { Clock, KYIV_TZ, kyivDaySql } from "../time/clock";
import { quarterTaxFacts } from "./tax-facts";

const STALE_SYNC_MS = 6 * 3_600_000;
const AVG_DAYS = 7;
const HORIZON_DAYS = 30;
/** Design §5.2 default: ₴100,000 a month, used until the owner sets one. */
const DEFAULT_LIFESTYLE_CAP = 10_000_000;
/** Design §5.3: about ₴450 a day, used while the owner has not set a food floor (0 would mean a ₴0 bridge limit). */
const DEFAULT_FOOD_FLOOR = 45_000;
const MAX_RECIPIENT_QUESTIONS = 3;
/** What the owner calls each bank account in the list of own money (task Б25). */
const ACCOUNT_NAMES = { black: "Чёрная карта", white: "Белая карта", fop: "Счёт ФОП" } as const;
/** The row of the day the shortage mode came on. */
const START: DayMark = "bridge_start";
/** Older transfers are history: asking about them now changes nothing. */
const QUESTION_WINDOW_DAYS = 30;


const CODE_BY_ALPHA = new Map(Object.entries(CURRENCY_ALPHA).map(([code, alpha]) => [alpha, Number(code)]));

interface Plan {
  id: number;
  dailyAmount: number;
  creditPlan: number;
  basis: string;
}

/** An open loan inside the tracked period; `remaining` is what is still owed. */
interface Loan {
  id: number;
  amount: number;
  remaining: number;
  received_on: string;
  due_on: string | null;
  kind: "short" | "other";
  manual: boolean;
}

interface Facts {
  date: string;
  input: Omit<DailyInput, "spentToday" | "bridgeDaily" | "creditPlan" | "cardsMoney"> & { cardsMoney: number };
  spentToday: number;
  avgDailySpend: number;
  credit: number;
  usdRate: number;
  rateStale: boolean;
  slots: { own: number; fop: number; binance: number; cash: number; items: OwnMoneyItemDto[] };
  upcoming: TodayDto["upcoming"];
  /** Where the stretch to the next income ends: its day, or the horizon's end. */
  end: string;
  /** The open loans that lower free money now (task Б7). */
  loans: Loan[];
  loansDue: NonNullable<TodayDto["loansDue"]>;
  basis: string;
  plan: Plan | null;
  trackingStart: string;
  cashStart: string | null;
  syncedAt: Date | null;
  limitVisual: "mercury" | "ring";
  goals: TodayDto["goals"];
  now: Date;
}

/**
 * What the day's facts say should be on record, decided once for the reader and the writer alike
 * (task Б3, invariant 8 of the audit): the writer persists it, the reader answers from it without saving.
 */
interface Resolved {
  /** The plan in force after today's decisions: null once it has ended. */
  plan: Plan | null;
  state: DailyState;
  /** The limit the day starts with: today's spending added back, nothing of the day counted yet. */
  morning: DailyState;
  mark: DayMark;
  /** The open plan whose shortage is over: it is closed and the day fixed afresh. */
  closePlan: Plan | null;
  /** The open plan's payments or income date changed: its credit need is recomputed once. */
  replan: { id: number; creditPlan: number; basis: string } | null;
}

const fmt = (kopecks: number) => `₴${Math.round(kopecks / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

const fmtDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

/**
 * The second line of «Это оплата?» (task Б45): the operation, its day and the payment's due date, so the
 * owner sees which month is asked about. Each variant is one whole string, to be translated later.
 */
function paidDetail(description: string, day: string, due: string): string {
  const who = description.trim();
  return who ? `${who} · ${day} · срок платежа ${due}` : `${day} · срок платежа ${due}`;
}

/** Calm tail for a bad case: when the money runs out at the current pace, if that is known. */
function runOutText(runOutOn: string | null, today: string): string {
  if (runOutOn === null) return "";
  return runOutOn <= today ? " Свободных денег уже нет." : ` При текущем темпе деньги закончатся ${fmtDay(runOutOn)}.`;
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
  @Cron("5 0 * * *", { timeZone: KYIV_TZ })
  async snapshotJob(): Promise<void> {
    try {
      await this.ensureSnapshot();
    } catch (e) {
      this.log.warn(`daily snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * The one place the day's row is written (task Б3). Writes the row once (concurrent calls share it) and keeps
   * its `mode` current: that is how the day the shortage came on is known, today and later. An existing row's
   * limit is never rewritten here: only choosing a bridge plan, closing one (by hand or because the shortage is
   * over), or a change by the person's own hand through `LimitService.invalidate` (task Б4) replaces it
   * (design §5.2). Called by the 15-minute job, the night jobs, and after a plan is confirmed or cancelled;
   * a read never calls it.
   */
  async ensureSnapshot(): Promise<void> {
    await this.ds.transaction((m) => this.fixDay(m, false));
  }

  /**
   * The day fixed afresh from the current facts, because the person changed something the limit is made of
   * (task Б4): the row is replaced in one statement, so there is never a moment without it, and inside the
   * caller's transaction when it gives its manager, so the change and the new limit are seen together or not
   * at all. Only `LimitService` calls this.
   */
  async refix(m?: EntityManager): Promise<void> {
    if (m) await this.fixDay(m, true);
    else await this.ds.transaction((t) => this.fixDay(t, true));
  }

  private async fixDay(m: EntityManager, fresh: boolean): Promise<void> {
    const now = this.clock.now();
    const f = await this.load(kyivDate(now), now, m);
    const r = await this.resolve(m, f);
    if (r.closePlan) {
      await m.query(`UPDATE bridge_plans SET closed_on=$1 WHERE id=$2 AND closed_on IS NULL`, [f.date, r.closePlan.id]);
    } else if (r.replan) {
      await m.query(`UPDATE bridge_plans SET credit_plan=$2, basis=$3 WHERE id=$1`, [r.replan.id, r.replan.creditPlan, r.replan.basis]);
    }
    if (fresh || r.closePlan) {
      // The facts changed by the person's hand, or the bridge limit no longer applies: the day gets its fresh limit.
      await m.query(
        `INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ($1,$2,$3)
         ON CONFLICT (local_date) DO UPDATE SET daily_limit=EXCLUDED.daily_limit, mode=EXCLUDED.mode`,
        [f.date, r.morning.dailyLimit, r.mark],
      );
      return;
    }
    await m.query(
      `INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ($1,$2,$3) ON CONFLICT (local_date) DO NOTHING`,
      [f.date, r.morning.dailyLimit, r.mark],
    );
    await m.query(`UPDATE daily_snapshots SET mode=$2 WHERE local_date=$1 AND mode<>$2`, [f.date, r.mark]);
  }

  /**
   * Reads only: no row of `daily_snapshots` or `bridge_plans` is written here. With the day's row present the
   * limit is the fixed one; without it (the first request after midnight, before any writer ran) the figures are
   * the ones `ensureSnapshot` will persist from the same facts, computed the same way and not saved.
   */
  async getToday(): Promise<TodayDto> {
    const now = this.clock.now();
    const f = await this.load(kyivDate(now), now);
    const r = await this.resolve(this.ds.manager, f);
    // A plan that has ended takes the day's row with it when the writer runs: until then the row does not count.
    const row = r.closePlan ? null : await this.storedLimit(this.ds.manager, f.date);
    const limit = row ?? r.morning.dailyLimit;
    // In the shortage mode the engine's limit is the one a new day starts with: the plan's, or the recommended one.
    // While the day still runs on another limit, that one is named as tomorrow's; otherwise it is already in force.
    const shortageStart =
      r.mark === "bridge_start" ? (r.state.dailyLimit !== limit ? { nextLimit: r.state.dailyLimit } : {}) : undefined;
    const leftToday = limit - f.spentToday;
    const state: DailyState = {
      ...r.state,
      dailyLimit: limit,
      leftToday,
      level: limit > 0 ? Math.min(1, Math.max(0, leftToday / limit)) : 0,
    };
    return this.dto(f, state, r.plan, shortageStart);
  }

  /** Today's decisions from the facts, the same for the reader and the writer; writes nothing. */
  private async resolve(m: EntityManager, f: Facts): Promise<Resolved> {
    let plan = f.plan;
    let closePlan: Plan | null = null;
    let replan: Resolved["replan"] = null;

    let state = this.compute(f, plan);
    if (plan && state.mode === "normal") {
      closePlan = plan;
      plan = null;
    } else if (plan && state.mode === "bridge" && plan.basis !== f.basis) {
      // Payments or the income date changed: the plan is recomputed once, then fixed again.
      const needed = this.compute(f, { ...plan, creditPlan: 0 }, null).bridge!.creditNeeded;
      replan = { id: plan.id, creditPlan: needed, basis: f.basis };
      plan = { ...plan, creditPlan: needed, basis: f.basis };
      state = this.compute(f, plan);
    }

    const morning = this.compute(f, plan, 0, f.spentToday);
    // The row's mode follows the day. A plan that has ended takes the day's row with it, so its mark is not stored.
    const stored = await this.storedMarks(m, f.date);
    // The shortage marks the day only when it changes the day's limit (Б47 (3)): the same test as `nextLimit` below.
    const mark = dayMark({
      live: state.mode,
      ...(closePlan ? { ...stored, stored: null, storedLimit: null } : stored),
      limit: state.dailyLimit,
    });
    return { plan, state, morning, mark, closePlan, replan };
  }

  async previewBridge(dailyAmount: number): Promise<BridgePreviewDto> {
    const now = this.clock.now();
    const f = await this.load(kyivDate(now), now);
    const b = this.compute(f, f.plan, null, undefined, dailyAmount).bridge;
    return { dailyAmount, creditNeeded: b?.creditNeeded ?? 0, shortfall: b?.shortfall ?? 0 };
  }

  /** The day's limit under another lifestyle cap (nothing is saved) and what that leaves for goals each month. */
  async previewCap(lifestyleCap: number): Promise<SettingsPreviewDto> {
    const now = this.clock.now();
    const f = await this.load(kyivDate(now), now);
    const input = { ...f.input, lifestyleCapMonthly: lifestyleCap > 0 ? lifestyleCap : DEFAULT_LIFESTYLE_CAP };
    const dailyLimit = this.compute({ ...f, input }, f.plan, 0, f.spentToday).dailyLimit;

    const m = this.ds.manager;
    const rates = await this.rates(m);
    const nowIso = now.toISOString();
    let rateStale = false;
    /** A foreign amount with no rate counts as 0 but marks the figure as possibly inaccurate. */
    const uah = (amount: number, alpha: string): number => {
      if (alpha === "UAH") return amount;
      const code = CODE_BY_ALPHA.get(alpha);
      if (code === undefined || !rates[alpha]) {
        rateStale = true;
        return 0;
      }
      const r = toUah(amount, code, rates, nowIso);
      rateStale ||= r.stale;
      return r.uah;
    };
    type Row = { amount: number; currency: string };
    const sum = (rows: Row[]) => rows.reduce((t, r) => t + uah(r.amount, r.currency), 0);
    const month = kyivDate(now).slice(0, 7);

    // This month's expected income: each source's event (received or pending), else its template.
    const incomes: (Row & { source: string })[] = await m.query(
      `SELECT x.source, x.amount::float8 AS amount, x.currency FROM expected_incomes x
        WHERE EXISTS (SELECT 1 FROM income_events e WHERE e.expected_income_id = x.id AND e.period = $1)
           OR NOT EXISTS (SELECT 1 FROM income_events e WHERE e.expected_income_id = x.id)`,
      [month],
    );
    const settings = (await m.query(`SELECT tax_rate_bp, esv_quarter::float8 AS esv_quarter FROM settings WHERE id=1`))[0] as {
      tax_rate_bp: number;
      esv_quarter: number;
    };
    const recurring: Row[] = await m.query(`SELECT amount::float8 AS amount, currency FROM recurring_payments WHERE active AND kind <> 'tax'`);
    const installments: Row[] = await m.query(
      `SELECT amount::float8 AS amount, currency FROM scheduled_payments
        WHERE kind='installment' AND to_char(due_on, 'YYYY-MM') = $1`,
      [month],
    );
    return {
      dailyLimit,
      leftForGoalsMonthly: leftForGoalsMonthly({
        income: sum(incomes),
        fopIncome: sum(incomes.filter((i) => i.source === "fop")),
        taxRateBp: settings.tax_rate_bp,
        esvQuarter: settings.esv_quarter,
        recurring: sum(recurring),
        installments: sum(installments),
        lifestyleCap,
      }),
      rateStale,
    };
  }

  /** The month's days up to today, against the limits fixed for them. */
  async calendar(month: string): Promise<CalendarDto> {
    const today = kyivDate(this.clock.now());
    const m = this.ds.manager;
    const first = `${month}-01`;
    const [y, mo] = month.split("-").map(Number) as [number, number];
    const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    const fixed = new Map(
      ((await m.query(`SELECT local_date::text AS date, daily_limit::float8 AS "limit", mode FROM daily_snapshots WHERE local_date BETWEEN $1 AND $2`, [first, last])) as { date: string; limit: number; mode: string }[]).map(
        (r) => [r.date, r],
      ),
    );
    const spent = await this.spentByDay(m, first, last);
    const days: CalendarDto["days"] = [];
    for (let date = first; date <= last && date <= today; date = addDays(date, 1)) {
      const row = fixed.get(date);
      const start = row?.mode === START;
      const isToday = date === today;
      // A past day on which the shortage came on goes without its limit: an older app then shows it as a day without one.
      const limit = start && !isToday ? null : (row?.limit ?? null);
      const amount = spent.get(date) ?? 0;
      days.push({ date, limit, spent: amount, status: isToday ? "today" : dayStatus(limit, amount, start), ...(start ? { shortageStart: true as const } : {}) });
    }
    return { month, today, streak: await this.streak(m, today), days };
  }

  /** Every fixed day is read: a streak can reach back any distance, and there is one row a day. */
  private async streak(m: EntityManager, today: string): Promise<number> {
    const rows = (await m.query(`SELECT local_date::text AS date, daily_limit::float8 AS "limit", mode FROM daily_snapshots WHERE local_date < $1`, [today])) as { date: string; limit: number; mode: string }[];
    if (rows.length === 0) return 0;
    const spent = await this.spentByDay(m, rows.reduce((a, r) => (r.date < a ? r.date : a), today), today);
    return currentStreak(rows.map((r) => ({ date: r.date, limit: r.limit, spent: spent.get(r.date) ?? 0, shortageStart: r.mode === START })), today);
  }

  private async spentByDay(m: EntityManager, from: string, to: string): Promise<Map<string, number>> {
    // The one query for spent per day (domain/ledger.ts), which the ledger check runs too.
    const rows = (await m.query(spentByDaySql("$1", "$2"), [from, to])) as { date: string; spent: number }[];
    return new Map(rows.map((r) => [r.date, r.spent]));
  }

  private async rates(m: EntityManager): Promise<Rates> {
    const rows: { currency: string; rate: number; fetched_at: Date }[] = await m.query(
      `SELECT DISTINCT ON (currency) currency, rate::float8 AS rate, fetched_at FROM fx_rates ORDER BY currency, fetched_at DESC`,
    );
    return Object.fromEntries(rows.map((r) => [r.currency, { rate: r.rate, fetchedAt: r.fetched_at.toISOString() }]));
  }

  async chooseBridge(dailyAmount: number): Promise<TodayDto> {
    const now = this.clock.now();
    const f = await this.load(kyivDate(now), now);
    const b = this.compute(f, f.plan, null, undefined, dailyAmount).bridge;
    if (!b) throw new ConflictException("bridge mode is not active: free money is not negative");
    // A plan the credit limit does not cover is confirmed too (owner's decision, task А22): the day still
    // gets its limit, and the app says how much is missing. `shortfall` stays in the state for that.
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
      // The plan changes the day's limit, not what the day is: the day the shortage came on stays that day.
      // A day that crossed into shortage on the limit it had becomes that day once the plan changes the limit.
      const mark = dayMark({ live: "bridge", ...(await this.storedMarks(m, f.date)), limit: dailyAmount });
      await m.query(
        `INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ($1,$2,$3)
         ON CONFLICT (local_date) DO UPDATE SET daily_limit=EXCLUDED.daily_limit, mode=EXCLUDED.mode`,
        [f.date, dailyAmount, mark],
      );
    });
    // The plan is on record: the writer fixes the day on it before the answer is read.
    await this.ensureSnapshot();
    return this.getToday();
  }

  /** Closes the open plan, if any; the day then gets a fresh limit, as when a plan ends by itself. */
  async cancelBridge(): Promise<TodayDto> {
    const date = kyivDate(this.clock.now());
    await this.ds.transaction(async (m) => {
      const closed: unknown[] = await m.query(
        `UPDATE bridge_plans SET closed_on=$1 WHERE closed_on IS NULL RETURNING id`,
        [date],
      );
      // TypeORM returns [rows, count] for an UPDATE on Postgres. The day is fixed afresh in the same transaction.
      if ((closed[1] as number) > 0) await this.fixDay(m, true);
    });
    await this.ensureSnapshot();
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

  /** What today's row and the last fixed day before it say, for `dayMark`. */
  private async storedMarks(
    m: EntityManager,
    date: string,
  ): Promise<{ stored: string | null; previous: string | null; storedLimit: number | null }> {
    const rows: { date: string; mode: string; daily_limit: number }[] = await m.query(
      `SELECT local_date::text AS date, mode, daily_limit::float8 AS daily_limit FROM daily_snapshots
        WHERE local_date <= $1 ORDER BY local_date DESC LIMIT 2`,
      [date],
    );
    const own = rows.find((r) => r.date === date);
    return { stored: own?.mode ?? null, previous: rows.find((r) => r.date < date)?.mode ?? null, storedLimit: own?.daily_limit ?? null };
  }

  /** The limit fixed for the day, if its row is there. */
  private async storedLimit(m: EntityManager, date: string): Promise<number | null> {
    const row = (await m.query(`SELECT daily_limit::float8 AS daily_limit FROM daily_snapshots WHERE local_date=$1`, [date]))[0] as
      | { daily_limit: number }
      | undefined;
    return row?.daily_limit ?? null;
  }

  // --- reading the database ---------------------------------------------------
  private async load(date: string, now: Date, m: EntityManager = this.ds.manager): Promise<Facts> {
    const nowIso = now.toISOString();
    const q = quarterOf(date);

    const settings = (
      await m.query(
        `SELECT lifestyle_cap::float8 AS lifestyle_cap, food_floor::float8 AS food_floor, tax_rate_bp,
                esv_quarter::float8 AS esv_quarter, limit_visual, GREATEST(last_sync_at, last_contact_at) AS last_contact,
                tracking_start::text AS tracking_start FROM settings WHERE id=1`,
      )
    )[0] as {
      lifestyle_cap: number; food_floor: number; tax_rate_bp: number; esv_quarter: number;
      limit_visual: "mercury" | "ring"; last_contact: Date | null; tracking_start: string;
    };

    const rates = await this.rates(m);
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

    // own money, and the places it lies: the items add up exactly to it (task Б25)
    const items: OwnMoneyItemDto[] = [];
    const accounts: { kind: "black" | "white" | "fop"; currency: string; balance: number; credit_limit: number }[] = await m.query(
      `SELECT kind, currency, balance::float8 AS balance, credit_limit::float8 AS credit_limit FROM accounts
        WHERE kind IN ('black','white','fop') ORDER BY id`,
    );
    let cards = 0, fop = 0, credit = 0;
    for (const a of accounts) {
      const native = a.balance - a.credit_limit;
      const own = uah(native, a.currency);
      const item: OwnMoneyItemDto = { kind: a.kind, name: ACCOUNT_NAMES[a.kind], own };
      // A currency account shows its own amount under the hryvnias, like Binance.
      if (a.currency !== "UAH") {
        item.currency = a.currency;
        item.amount = native;
      }
      if (a.kind === "fop") fop += own;
      else {
        cards += own;
        const limit = uah(a.credit_limit, a.currency);
        credit += limit;
        if (limit > 0) item.creditLimit = limit;
      }
      // monobank opens one account per currency; an empty one without a credit limit is not a place money lies.
      if (native === 0 && a.credit_limit <= 0) continue;
      items.push(item);
    }
    // The Binance balance and any other manual balance that counts as own money share one slot.
    const manual: { name: string; amount: number; currency: string }[] = await m.query(
      `SELECT name, amount::float8 AS amount, currency FROM manual_balances WHERE counts_as_own ORDER BY id`,
    );
    const manualItems: OwnMoneyItemDto[] = manual.map((b) => ({
      kind: b.name === BINANCE ? "binance" : "manual",
      name: b.name,
      own: uah(b.amount, b.currency),
      currency: b.currency,
      amount: b.amount,
    }));
    const binance = manualItems.reduce((s, b) => s + b.own, 0);
    // The cash wallet is spendable own money, like the cards.
    const wallet = await walletBalance(m);
    cards += wallet.balance;
    if (wallet.start !== null) items.push({ kind: "cash", name: "Наличные", own: wallet.balance });
    items.push(...manualItems);

    // income dates and loans
    const next = (await m.query(`SELECT min(expected_on)::text AS d FROM income_events WHERE status <> 'received'`))[0].d as string | null;
    // A small fop income marks its month received but does not end the loan cycle (Б33): see lastIncomeBoundary.
    const received: ReceivedIncome[] = await m.query(
      `SELECT x.source, (${kyivDaySql("e.received_at")})::text AS "receivedOn", e.amount_uah::float8 AS "amountUah",
              x.amount::float8 AS "expectedAmount", x.currency, e.matched_transaction_id IS NOT NULL AS "byBank"
         FROM income_events e JOIN expected_incomes x ON x.id = e.expected_income_id WHERE e.status = 'received'`,
    );
    const lastIncome = lastIncomeBoundary(received, Object.fromEntries(Object.entries(rates).map(([c, r]) => [c, r.rate])));
    // Open loans within the tracked period (earlier ones are history), less what repayments already covered.
    // Which of them lower free money, and how, is the rule of task Б7 in domain/loans.
    const open: Loan[] = await m.query(
      `SELECT id, amount::float8 AS amount, (amount - repaid_amount)::float8 AS remaining, received_on::text AS received_on,
              due_on::text AS due_on, kind, source_transaction_id IS NULL AS manual FROM loans
        WHERE repaid_at IS NULL AND received_on >= $1::date ORDER BY received_on, id`,
      [settings.tracking_start],
    );
    const loanRule = loanReserve({
      loans: open.map((l) => ({ id: l.id, remaining: l.remaining, receivedOn: l.received_on, dueOn: l.due_on, kind: l.kind, manual: l.manual })),
      today: date,
      trackingStart: settings.tracking_start,
      lastIncomeOn: lastIncome,
      nextIncomeOn: next,
    });
    const counted = new Set(loanRule.counted.map((l) => l.id));
    const loans = open.filter((l) => counted.has(l.id));
    const loansDue = loanRule.dueNow.map((l) => ({ id: l.id, amount: l.remaining, dueOn: l.dueOn! }));

    // payments: unpaid ones feed the limit; the window's payments (paid or not, native amounts) define the bridge basis
    const end = next && next >= date ? next : addDays(date, HORIZON_DAYS);
    // `end` is only where the runway stops; it is not a window for payments. Every payment and tax row "before the
    // next income" is picked by `dueEnd`: due before `end`, or on the income day itself (reserved in advance, Б47 (1)).
    const dueEnd = dueWindowEnd(date, next);
    const pays: {
      id: number; name: string; kind: string; amount: number; currency: string; due_on: string; paid: boolean;
      tax_quarter: string | null; is_estimate: boolean; linked: number;
    }[] =
      await m.query(
        `SELECT id, name, kind, amount::float8 AS amount, currency, due_on::text AS due_on, (paid_at IS NOT NULL) AS paid,
                tax_quarter, is_estimate,
                (SELECT COALESCE(SUM(-COALESCE(x.amount_uah, x.amount)), 0) FROM payment_links l
                   JOIN transactions x ON x.id = l.transaction_id WHERE l.payment_id = scheduled_payments.id)::float8 AS linked
           FROM scheduled_payments WHERE due_on < $1 OR paid_at IS NULL ORDER BY due_on, id`,
        [dueEnd],
      );
    const unpaid = pays.filter((p) => !p.paid);
    // A loan with a return date is reserved as a payment on that date (task Б7).
    const obligationsDue =
      sumDue(
        unpaid.filter((p) => p.kind !== "tax").map((p) => ({ dueOn: p.due_on, amount: uah(p.amount, p.currency), paid: false })),
        date,
        next,
      ) + loanRule.due;
    const unpaidScheduled = unpaid.filter((p) => p.kind === "tax").reduce((s, p) => s + uah(p.amount, p.currency), 0);
    const basis =
      pays
        .filter((p) => p.due_on < dueEnd)
        .map((p) => `${p.due_on}:${p.amount}:${p.currency}`)
        .sort()
        .join(",") + `|${next ?? ""}`;
    const upcoming = unpaid
      .filter((p) => p.due_on < dueEnd)
      // `paid`: what operations linked to the open payment already paid (task Б9); its whole amount stays reserved.
      .map((p) => ({ id: String(p.id), name: p.name, amount: uah(p.amount, p.currency), dueOn: p.due_on, kind: p.kind, currency: p.currency, paid: p.linked }));

    // tax reserve
    const { fopIncome, paidUnmatched: paidTax } = await quarterTaxFacts(m, q.start, q.end);
    const thisQuarter = quarterLabel(date);
    const realRows = await m.query(
      `SELECT 1 FROM scheduled_payments WHERE kind='tax' AND tax_quarter=$1 AND NOT is_estimate LIMIT 1`,
      [thisQuarter],
    );
    const taxInput = {
      fopIncomeQuarter: fopIncome,
      rateBp: settings.tax_rate_bp,
      esvQuarter: settings.esv_quarter,
      dayOfQuarter: q.dayOf,
      daysInQuarter: q.daysIn,
      paidAgainstCurrentQuarter: paidTax,
      currentQuarterHasRows: realRows.length > 0,
    };
    const reserve = taxReserve({ ...taxInput, unpaidScheduled });
    const accrued = taxReserve({ ...taxInput, unpaidScheduled: 0 });
    // Rows standing in for an accrual (an estimate, or this quarter entered early) are still not cash
    // needed before the next income, or a bridge plan would jump at the rollover.
    const deferred = unpaid
      .filter((p) => p.kind === "tax" && p.due_on >= dueEnd && (p.is_estimate || p.tax_quarter === thisQuarter))
      .reduce((s, p) => s + uah(p.amount, p.currency), 0);

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
        taxAccruedNotDue: Math.min(accrued + deferred, reserve),
        obligationsDue,
        goalDue: 0,
        borrowed: loanRule.borrowed,
        nextIncomeOn: next,
        lifestyleCapMonthly: settings.lifestyle_cap > 0 ? settings.lifestyle_cap : DEFAULT_LIFESTYLE_CAP,
        foodFloor: settings.food_floor > 0 ? settings.food_floor : DEFAULT_FOOD_FLOOR,
      },
      spentToday,
      avgDailySpend,
      credit,
      usdRate: usd?.rate ?? 0,
      rateStale: stale || usdStale,
      slots: { own: cards + fop + binance, fop, binance, cash: wallet.balance, items },
      cashStart: wallet.start,
      loans,
      loansDue,
      basis,
      upcoming,
      end,
      plan: planRow
        ? { id: planRow.id, dailyAmount: planRow.daily_amount, creditPlan: planRow.credit_plan, basis: planRow.basis }
        : null,
      trackingStart: settings.tracking_start,
      syncedAt: settings.last_contact,
      limitVisual: settings.limit_visual,
      goals: await m.query(
        `SELECT id, name, saved_cents::float8 AS saved, target_cents::float8 AS target FROM goals ORDER BY sort, id`,
      ),
    };
  }

  /** What counted against the limit between two dates: spend (refunds reduce it), cash out and person transfers. */
  private async spent(m: EntityManager, from: string, to: string): Promise<number> {
    // What counts is the one rule of domain/ledger.ts (spend, refunds reducing it, person transfers, cash out until
    // the wallet starts; nothing on a jar or without a hryvnia amount); the ledger check runs this query too.
    const r = await m.query(spentSql("$1", "$2"), [from, to]);
    return r[0].s;
  }

  /** Money withdrawn from Binance lands as an ordinary credit and counts twice until the owner says what it is. */
  private async usdcMatchQuestions(m: EntityManager, f: Facts): Promise<TodayDto["questions"]> {
    if (f.usdRate <= 0) return []; // the balance cannot be lowered without a rate
    const event = (
      await m.query(
        `SELECT e.id, e.period FROM income_events e JOIN expected_incomes x ON x.id = e.expected_income_id
          WHERE x.source='usdc' AND e.status='received' ORDER BY e.received_at DESC NULLS LAST, e.id DESC LIMIT 1`,
      )
    )[0] as { id: number; period: string } | undefined;
    if (!event) return [];
    const balance = (await m.query(`SELECT amount::float8 AS amount FROM manual_balances WHERE name=$1`, [BINANCE]))[0] as
      | { amount: number }
      | undefined;
    const rows: { id: number; type: string | null; account_kind: string; amount_uah: number | null; local_date: string; usdc_checked: boolean }[] =
      await m.query(
        `SELECT t.id, t.type, a.kind AS account_kind, t.amount_uah::float8 AS amount_uah, t.local_date::text AS local_date, t.usdc_checked
           FROM transactions t JOIN accounts a ON a.id = t.account_id
          WHERE t.amount > 0 AND NOT t.usdc_checked AND t.type IN ('person_in','cash_in') AND t.local_date >= GREATEST($1::date, $2::date)
            AND NOT (t.type = 'cash_in' AND $3::date IS NOT NULL AND t.local_date >= $3::date)
          ORDER BY t.occurred_at, t.id`,
        [`${event.period}-01`, f.trackingStart, f.cashStart],
      );
    return usdcMatchRows({
      rows: rows.map((r) => ({
        id: r.id, type: r.type, accountKind: r.account_kind, amountUah: r.amount_uah, localDate: r.local_date, usdcChecked: r.usdc_checked,
      })),
      binanceBalance: balance?.amount ?? 0,
      receivedPeriod: event.period,
      trackingStart: f.trackingStart,
    }).map((r) => ({
      id: `usdc_match:${event.id}:${r.id}`,
      kind: "usdc_match" as const,
      text: `Пришло ${fmt(r.amountUah!)} (${fmtDay(r.localDate)}). Это вывод с Binance?`,
    }));
  }

  /**
   * A cash deposit at a terminal once the wallet keeps records: the cash came from the wallet, from
   * Binance, or from elsewhere. The id carries the USDC event Binance would be matched to, 0 if none.
   */
  private async cashSourceQuestions(m: EntityManager, f: Facts): Promise<TodayDto["questions"]> {
    if (f.cashStart === null) return [];
    const event = f.usdRate > 0
      ? ((
          await m.query(
            `SELECT e.id FROM income_events e JOIN expected_incomes x ON x.id = e.expected_income_id
              WHERE x.source='usdc' AND e.status='received' ORDER BY e.received_at DESC NULLS LAST, e.id DESC LIMIT 1`,
          )
        )[0] as { id: number } | undefined)
      : undefined;
    const rows: { id: number; amount_uah: number; local_date: string }[] = await m.query(
      `SELECT t.id, t.amount_uah::float8 AS amount_uah, t.local_date::text AS local_date
         FROM transactions t JOIN accounts a ON a.id = t.account_id
        WHERE t.type = 'cash_in' AND t.amount > 0 AND NOT t.usdc_checked AND a.kind NOT IN ('jar','cash')
          AND t.local_date >= $1::date AND t.local_date > $2::date - ${QUESTION_WINDOW_DAYS}
        ORDER BY t.occurred_at, t.id`,
      [f.cashStart, f.date],
    );
    return rows.map((r) => ({
      id: `cash_source:${r.id}:${event?.id ?? 0}`,
      kind: "cash_source" as const,
      text: `Внесено ${fmt(r.amount_uah)} (${fmtDay(r.local_date)}). Откуда наличные?`,
    }));
  }

  /**
   * A transfer to the owner's card at another bank since the wallet start, about a card with no
   * answer yet: was it taken out there as cash?
   */
  private async cashCardQuestions(m: EntityManager, f: Facts): Promise<TodayDto["questions"]> {
    if (f.cashStart === null) return [];
    const rows: { id: number; amount_uah: number; local_date: string; target: string }[] = await m.query(
      `SELECT t.id, t.amount_uah::float8 AS amount_uah, t.local_date::text AS local_date,
              COALESCE(NULLIF(btrim(t.counter_name), ''), t.description) AS target
         FROM transactions t JOIN accounts a ON a.id = t.account_id
        WHERE ${cardTransferSql()} AND t.cash_amount IS NULL AND t.amount_uah IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM cash_cards c WHERE c.counter_key = ${counterKeySql("t")})
          AND t.local_date > $1::date - ${QUESTION_WINDOW_DAYS}
        ORDER BY t.occurred_at, t.id`,
      [f.date],
    );
    return rows.map((r) => ({
      id: `cash_card:${r.id}`,
      kind: "cash_card" as const,
      text: `Перевод ${fmt(-r.amount_uah)} на ${r.target} (${fmtDay(r.local_date)}). Снял наличными?`,
    }));
  }

  /**
   * «Это оплата?» (task Б8): a payment long overdue while an operation of its amount sits unlinked, or
   * (task Б31) one due within days of an operation near its amount. Every open payment due by today plus
   * PAID_QUESTION_WINDOW_DAYS is looked at: an operation is never later than today, so one due later
   * cannot have an operation near its due date. The operations are the ones the «Оплачено» sheet offers
   * for the payment; paidQuestions narrows them.
   */
  private async paymentPaidQuestions(m: EntityManager, f: Facts): Promise<TodayDto["questions"]> {
    const payments: Payment[] = await m.query(
      `SELECT id, kind, name, amount::float8 AS amount, currency, due_on::text AS due_on, paid_at, transaction_id, match_hint
         FROM scheduled_payments
        WHERE paid_at IS NULL AND transaction_id IS NULL AND kind <> 'tax' AND due_on <= $1::date + ${PAID_QUESTION_WINDOW_DAYS}
          AND NOT EXISTS (SELECT 1 FROM payment_links l WHERE l.payment_id = scheduled_payments.id)
        ORDER BY due_on, id`,
      [f.date],
    );
    if (payments.length === 0) return [];
    const candidates = new Map<number, PayableTx[]>();
    const texts = new Map<number, string>();
    for (const p of payments) {
      const ids = await paymentCandidateIds(m, p.id, f.date);
      if (ids.length === 0) continue;
      const rows: (PayableTx & { description: string })[] = await m.query(
        `SELECT t.id, t.type, t.amount::float8 AS amount, a.currency, t.amount_uah::float8 AS "amountUah", t.local_date::text AS "localDate",
                '' AS text, t.description
           FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id = ANY($1::int[])`,
        [ids],
      );
      for (const r of rows) texts.set(r.id, r.description);
      candidates.set(p.id, rows);
    }
    const dismissed: { pair: string }[] = await m.query(
      `SELECT payment_id || ':' || transaction_id AS pair FROM payment_dismissals WHERE payment_id = ANY($1::int[])`,
      [payments.map((p) => p.id)],
    );
    // A foreign payment is asked about at the latest rate (task Б44), the rate its candidates were picked by.
    const rates = Object.fromEntries(Object.entries(await this.rates(m)).map(([c, r]) => [c, r.rate]));
    return paidQuestions(payments, candidates, new Set(dismissed.map((d) => d.pair)), f.date, rates).map(({ payment, tx }) => ({
      id: `payment_paid:${payment.id}:${tx.id}`,
      kind: "payment_paid" as const,
      // A foreign payment is named by what left the card, in hryvnias.
      text: `Это оплата «${payment.name}» ${fmt(payment.currency === "UAH" ? payment.amount : Math.abs(tx.amountUah ?? tx.amount))}?`,
      detail: paidDetail(texts.get(tx.id) ?? "", fmtDay(tx.localDate), fmtDay(payment.due_on)),
    }));
  }

  // --- the response -------------------------------------------------------------
  private async dto(f: Facts, state: DailyState, plan: Plan | null, shortageStart?: { nextLimit?: number }): Promise<TodayDto> {
    const m = this.ds.manager;
    const questions: TodayDto["questions"] = [];
    const usdc: { id: number; expected_amount: number }[] = await m.query(
      `SELECT e.id, x.amount::float8 AS expected_amount FROM income_events e JOIN expected_incomes x ON x.id = e.expected_income_id
        WHERE x.source='usdc' AND e.status <> 'received' AND e.period=$1
          AND $2::int BETWEEN x.window_start_day AND x.window_end_day ORDER BY e.id`,
      [f.date.slice(0, 7), Number(f.date.slice(8, 10))],
    );
    for (const e of usdc) {
      questions.push({ id: `usdc_arrived:${e.id}`, kind: "usdc_arrived", text: "Пришло на Binance?", expectedAmount: e.expected_amount });
    }
    for (const q of await this.usdcMatchQuestions(m, f)) questions.push(q);
    for (const q of await this.cashSourceQuestions(m, f)) questions.push(q);
    for (const q of await this.cashCardQuestions(m, f)) questions.push(q);
    for (const q of await this.paymentPaidQuestions(m, f)) questions.push(q);
    if (state.needsIncomeDate) {
      const ev = (await m.query(`SELECT id FROM income_events WHERE status <> 'received' ORDER BY expected_on, id LIMIT 1`))[0] as
        | { id: number }
        | undefined;
      // With no expected income there is no date to answer: the limit simply runs on 30 days.
      if (ev) questions.push({ id: `income_date:${ev.id}`, kind: "income_date", text: "Когда ожидается следующий доход?" });
    }
    const people: { key: string; labels: string[]; count: number; total: number; last_on: string; transfer: boolean; iban: boolean }[] = await m.query(
      `SELECT ck AS key, array_agg(label ORDER BY occurred_at DESC, id DESC) AS labels, COUNT(*)::int AS count,
              COALESCE(SUM(ABS(amount_uah)), 0)::float8 AS total, MAX(local_date)::text AS last_on, bool_or(transfer) AS transfer,
              bool_or(iban) AS iban
         FROM (
           SELECT ${counterKeySql("t")} AS ck, COALESCE(NULLIF(t.counter_name,''), t.description) AS label, t.id, t.occurred_at, t.amount_uah, t.local_date,
                  (t.amount < 0 AND t.mcc IN (${[...TRANSFER_MCCS].join(",")})) AS transfer, NULLIF(t.counter_iban, '') IS NOT NULL AS iban
             FROM transactions t JOIN accounts a ON a.id=t.account_id
            WHERE t.needs_label AND t.type='person_transfer' AND a.kind <> 'jar'
              AND t.local_date > $1::date - ${QUESTION_WINDOW_DAYS}
         ) s GROUP BY ck ORDER BY MAX(occurred_at) DESC, MAX(id) DESC`,
      [f.date],
    );
    // One IBAN can have named and generic rows: the group is asked about under its latest real name.
    // With no name at all it is asked about only if it holds an outgoing transfer (Б10), which may be the
    // owner's own card at another bank spending the limit in silence, and only if its key is one
    // destination (an account number, a card number): a key made of a bank template alone would carry
    // one answer to every such transfer. The same rule as needs_label in classify().
    const asked = people.flatMap((p) => {
      const label = p.labels.find((l) => isCounterpartyName(l));
      if (label) {
        return [{ key: p.key, subject: label, text: `${label}: ${p.count} ${transfersWord(p.count)}, ${fmt(p.total)}, последний ${fmtDay(p.last_on)}` }];
      }
      const latest = p.labels[0];
      const destination = p.iban || (latest !== undefined && cardTail(latest) !== null);
      return p.transfer && destination && latest ? [{ key: p.key, ...unnamedTransferQuestion(latest, p.count, fmt(p.total), fmtDay(p.last_on)) }] : [];
    });
    for (const p of asked.slice(0, MAX_RECIPIENT_QUESTIONS)) {
      questions.push({ id: `recipient_label:${p.key}`, kind: "recipient_label", subject: p.subject, text: p.text });
    }

    const badCases: TodayDto["badCases"] = [];
    const runOutOn = runOutDate({ free: state.free, avgDailySpend: f.avgDailySpend, today: f.date });
    for (const l of f.loans) {
      const fact = `Займ ${fmt(l.amount)} от ${fmtDay(l.received_on)}${l.remaining < l.amount ? `, осталось ${fmt(l.remaining)}` : ""}`;
      const repayLoan = { id: l.id, remaining: l.remaining, receivedOn: l.received_on };
      badCases.push(
        l.manual
          ? { id: `loan:${l.id}`, text: fact, removableLoanId: l.id, repayLoan }
          : { id: `loan:${l.id}`, text: `${fact}${runOutOn ? `.${runOutText(runOutOn, f.date)}` : ""}`, repayLoan },
      );
    }
    if (state.bridge?.overPlan && plan) {
      const over = -(f.input.cardsMoney + f.input.fopMoney + f.input.binanceMoney) - plan.creditPlan;
      badCases.push({
        id: `bridge_over_plan:${plan.id}`,
        text: `Минус вышел за план моста на ${fmt(over)}.${runOutText(runOutOn, f.date)}`,
      });
    }

    // Taxes are covered by the reserve, which is already out of `free`: they are not steps here.
    const events = f.upcoming
      .filter((p) => p.kind !== "tax")
      .map((p) => ({ id: p.id, date: p.dueOn < f.date ? f.date : p.dueOn, name: p.name, amount: p.amount }));
    const run = runway({
      today: f.date,
      endOn: f.end,
      free: state.free,
      dailyLimit: state.dailyLimit,
      // On the day the shortage came on, the days after today run on the limit the screen names for tomorrow.
      ...(shortageStart?.nextLimit !== undefined ? { laterLimit: shortageStart.nextLimit } : {}),
      leftToday: state.leftToday,
      payments: events,
    });

    return {
      date: f.date,
      state: { ...state, bridge: state.bridge ? { ...state.bridge, confirmed: plan !== null } : null, ...(shortageStart ? { shortageStart } : {}) },
      runway: { endOn: f.end, incomeOn: f.end === f.input.nextIncomeOn ? f.end : null, ...run, events },
      usdRate: f.usdRate,
      rateStale: f.rateStale,
      accounts: { own: f.slots.own, credit: f.credit, fop: f.slots.fop, binance: f.slots.binance, cash: f.slots.cash, items: f.slots.items },
      upcoming: f.upcoming,
      questions,
      badCases,
      loansDue: f.loansDue,
      runOutOn,
      syncedAt: f.syncedAt ? f.syncedAt.toISOString() : null,
      syncStale: !f.syncedAt || f.now.getTime() - f.syncedAt.getTime() > STALE_SYNC_MS,
      limitVisual: f.limitVisual,
      goals: f.goals,
      streak: await this.streak(m, f.date),
    };
  }
}
