import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DataSource, type EntityManager } from "typeorm";
import { ruleMatches } from "../domain/classify";
import { type Payment, matchPayment, matchTaxPayment, monthlyDueDates, monthlyEvents } from "../domain/recurring-match";
import { kyivDate } from "../domain/money";
import { estimateDueOn, precedingQuarter, quarterBounds, quarterOf } from "../domain/quarter";
import { taxReserve } from "../domain/tax";
import { Clock } from "../today/clock";
import { LimitService } from "../today/limit.service";
import { quarterTaxFacts } from "../today/tax-facts";
import { INTEREST_TEXT, SHORT_LOAN_TEXT } from "./short-loan";
import { ScheduledPayment, type IncomeEvent } from "../db/entities";

export const BINANCE = "Binance";
const MATCH_DAYS = 3;
const PLANNED_RECIPIENT_LABELS = ["close_regular", "shared_budget"];

/** Today's date in Kyiv, YYYY-MM-DD. */
export function kyivToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

interface TxRow {
  id: number;
  type: string | null;
  amount: number;
  currency: string;
  amount_uah: number | null;
  local_date: string;
  occurred_at: Date;
  text: string;
  account_kind: string;
}

/** Planned payments, expected incomes and how bank rows settle them. */
@Injectable()
export class PlanService implements OnApplicationBootstrap {
  private readonly log = new Logger(PlanService.name);

  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LimitService) private readonly limit: LimitService,
  ) {}

  /** Catch up after downtime; the unique key makes this safe to repeat. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.generate();
      await this.ensureTaxEstimate();
    } catch (e) {
      this.log.warn(`event generation failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Hourly, so that a seed or a new template reaches the limit the same day. */
  @Cron("0 * * * *", { timeZone: "Europe/Kyiv" })
  async hourlyJob(): Promise<void> {
    try {
      await this.generate();
    } catch (e) {
      this.log.warn(`event generation failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Generation, safe to repeat. A template that gets its first rows here (just seeded, say) was not in
   * the day's limit if a job fixed it in the meantime, so the limit is fixed afresh. Later months' rows
   * leave the fixed limit alone.
   */
  private async generate(fixLimit = true): Promise<void> {
    const today = kyivDate(this.clock.now());
    const [{ fresh }] = (await this.ds.query(
      `SELECT EXISTS (SELECT 1 FROM expected_incomes x WHERE NOT EXISTS (SELECT 1 FROM income_events e WHERE e.expected_income_id = x.id))
           OR EXISTS (SELECT 1 FROM recurring_payments r WHERE r.active AND NOT EXISTS (SELECT 1 FROM scheduled_payments p WHERE p.recurring_id = r.id)) AS fresh`,
    )) as [{ fresh: boolean }];
    await this.generateEvents(today);
    await this.generateRecurring(today);
    await this.linkTaxTransactions();
    if (fresh && fixLimit) await this.limit.invalidate("plan");
  }

  /** The owner just added something to the plan: its dates are needed now. The caller fixes the limit afterwards. */
  refresh(): Promise<void> {
    return this.generate(false);
  }

  /** Just after midnight on the first day of a quarter this is what keeps the reserve in place. */
  @Cron("1 0 * * *", { timeZone: "Europe/Kyiv" })
  async dailyTaxEstimateJob(): Promise<void> {
    try {
      await this.ensureTaxEstimate();
    } catch (e) {
      this.log.warn(`tax estimate failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * The quarter that just ended, if the owner has entered no tax rows for it, gets one estimated row
   * with its accrual: the money stays reserved over the rollover. Safe to repeat. Returns true when a
   * row was created; the day's limit may already have been fixed without it, so it is fixed afresh.
   */
  async ensureTaxEstimate(today: string = kyivDate(this.clock.now())): Promise<boolean> {
    const label = precedingQuarter(today);
    const has = await this.ds.query(`SELECT 1 FROM scheduled_payments WHERE kind='tax' AND tax_quarter=$1 LIMIT 1`, [label]);
    if (has.length > 0) return false;
    const { start, end } = quarterBounds(label);
    const days = quarterOf(end).daysIn;
    const s = (await this.ds.query(`SELECT tax_rate_bp, esv_quarter::float8 AS esv_quarter FROM settings WHERE id=1`))[0] as {
      tax_rate_bp: number;
      esv_quarter: number;
    };
    const facts = await quarterTaxFacts(this.ds.manager, start, end);
    const amount = taxReserve({
      fopIncomeQuarter: facts.fopIncome,
      rateBp: s.tax_rate_bp,
      esvQuarter: s.esv_quarter,
      dayOfQuarter: days,
      daysInQuarter: days,
      paidAgainstCurrentQuarter: facts.paidUnmatched,
      unpaidScheduled: 0,
      currentQuarterHasRows: false,
    });
    if (amount <= 0) return false;
    const made: unknown[] = await this.ds.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, tax_quarter, is_estimate)
       VALUES ('tax',$1,$2,'UAH',$3,$4,true)
       ON CONFLICT (tax_quarter) WHERE is_estimate DO NOTHING RETURNING id`,
      [`Налог за ${label.slice(6)} кв. ${label.slice(0, 4)} (оценка)`, amount, estimateDueOn(label), label],
    );
    if (made.length === 0) return false;
    await this.limit.invalidate("tax_estimate");
    return true;
  }

  /** A new payment. A tax row names its quarter (by default the one before its due date) and replaces that quarter's estimate. */
  async createPayment(input: Partial<ScheduledPayment> & Pick<ScheduledPayment, "kind" | "due_on">): Promise<ScheduledPayment> {
    const taxQuarter = input.kind === "tax" && input.tax_quarter === undefined ? precedingQuarter(input.due_on) : input.tax_quarter;
    return this.ds.transaction(async (m) => {
      const repo = m.getRepository(ScheduledPayment);
      const row = await repo.save(repo.create({ ...input, tax_quarter: taxQuarter ?? null }));
      await this.dropEstimate(m, row);
      return row;
    });
  }

  /** Real figures for a quarter replace the app's estimate for it. */
  async dropEstimate(m: EntityManager, row: Pick<ScheduledPayment, "kind" | "tax_quarter" | "is_estimate">): Promise<void> {
    if (row.kind !== "tax" || !row.tax_quarter || row.is_estimate) return;
    await m.query(`DELETE FROM scheduled_payments WHERE is_estimate AND tax_quarter=$1`, [row.tax_quarter]);
  }

  /**
   * Bank rows can arrive before the tax row that claims them (history is imported first, the owner's
   * rows are seeded later), so unclaimed tax payments are tried again. Newest first: a row goes to its
   * latest fitting payment. Safe to repeat.
   */
  async linkTaxTransactions(): Promise<void> {
    const rows: { id: number }[] = await this.ds.query(
      `SELECT t.id FROM transactions t
        WHERE t.type='tax' AND t.amount < 0
          AND NOT EXISTS (SELECT 1 FROM scheduled_payments p WHERE p.transaction_id = t.id)
          AND EXISTS (SELECT 1 FROM scheduled_payments p WHERE p.kind='tax' AND p.transaction_id IS NULL)
        ORDER BY t.occurred_at DESC, t.id DESC`,
    );
    for (const r of rows) await this.onClassified(r.id, "tax");
  }

  /** Creates this and next month's payment for every active recurring series. Returns new rows. */
  async generateRecurring(today: string = kyivToday()): Promise<number> {
    const series: { id: number; kind: string; name: string; amount: number; currency: string; day_of_month: number; match_hint: string | null }[] =
      await this.ds.query(
        `SELECT id, kind, name, amount::float8 AS amount, currency, day_of_month, match_hint
           FROM recurring_payments WHERE active ORDER BY id`,
      );
    let created = 0;
    for (const r of series) {
      // A series being created now has no history: a day already past this month was paid (or not
      // tracked) before setup, and would show up as overdue.
      const fresh = (await this.ds.query(`SELECT 1 FROM scheduled_payments WHERE recurring_id=$1 LIMIT 1`, [r.id])).length === 0;
      for (const due of monthlyDueDates(r.day_of_month, today)) {
        if (fresh && due < today) continue;
        const out: unknown[] = await this.ds.query(
          `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, match_hint, recurring_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (recurring_id, due_on) DO NOTHING RETURNING id`,
          [r.kind, r.name, r.amount, r.currency, due, r.match_hint, r.id],
        );
        created += out.length;
      }
    }
    return created;
  }

  /** Creates this and next month's events. Returns how many were new. */
  async generateEvents(today: string = kyivToday()): Promise<number> {
    const expected: { id: number; source: "fop" | "usdc"; window_start_day: number; window_end_day: number }[] =
      await this.ds.query(`SELECT id, source, window_start_day, window_end_day FROM expected_incomes ORDER BY id`);
    let created = 0;
    for (const e of monthlyEvents(expected, today)) {
      const r: unknown[] = await this.ds.query(
        `INSERT INTO income_events (expected_income_id, period, expected_on, status) VALUES ($1,$2,$3,$4)
         ON CONFLICT (expected_income_id, period) DO NOTHING RETURNING id`,
        [e.expected_income_id, e.period, e.expected_on, e.status],
      );
      created += r.length;
    }
    return created;
  }

  listEvents(): Promise<IncomeEvent[]> {
    return this.ds.query(
      `SELECT id, expected_income_id, period, expected_on::text AS expected_on, received_at, amount_uah::float8 AS amount_uah,
              status, matched_transaction_id
         FROM income_events ORDER BY period, expected_income_id, id`,
    );
  }

  async setEventDate(id: number, date: string): Promise<IncomeEvent> {
    const found = await this.ds.query(`SELECT 1 FROM income_events WHERE id=$1`, [id]);
    if (found.length === 0) throw new NotFoundException("income event not found");
    await this.ds.query(`UPDATE income_events SET expected_on=$2 WHERE id=$1`, [id, date]);
    // A new date is used at once (design §5.2).
    await this.limit.invalidate("income");
    return this.eventView(this.ds.manager, id);
  }

  /**
   * "It arrived": marks the event received and, for USDC, adds the amount that arrived (`amount`, in the
   * income's minor units; the expected amount when the app did not say) to the Binance manual balance.
   * The money counts in the day's limit at once. A second call changes nothing.
   */
  async confirmEvent(id: number, amount?: number): Promise<IncomeEvent> {
    return this.ds.transaction(async (m) => {
      const ev = await this.lockEvent(m, id);
      if (ev.status !== "received") {
        const received = amount ?? ev.expected_amount;
        const balanceDelta = ev.source === "usdc" ? received : 0;
        await this.markReceived(m, { ...ev, expected_amount: received }, null);
        if (balanceDelta > 0) {
          await m.query(
            `INSERT INTO manual_balances (name, amount, currency, counts_as_own) VALUES ($1,$2,'USD',true)
             ON CONFLICT (name) DO UPDATE SET amount = manual_balances.amount + EXCLUDED.amount`,
            [BINANCE, balanceDelta],
          );
        }
        await this.limit.invalidate("income", m);
      }
      return this.eventView(m, id);
    });
  }

  /**
   * A card credit or cash deposit that is the USDC arriving by another way: lowers the Binance
   * balance by its hryvnia amount at the current USD rate and retypes the row as an own transfer.
   * One event can take several rows: withdrawing in parts just lowers the balance each time, and each
   * row counts once. An event not yet confirmed is confirmed by this match (the money was never on Binance in the
   * app's books, so the balance is left alone).
   */
  async matchTransaction(eventId: number, transactionId: number): Promise<IncomeEvent> {
    return this.ds.transaction(async (m) => {
      const ev = await this.lockEvent(m, eventId);
      if (ev.source !== "usdc") throw new UnprocessableEntityException("only USDC events can be matched");
      const tx = (
        await m.query(
          `SELECT t.id, t.type, t.amount::float8 AS amount, t.amount_uah::float8 AS amount_uah, t.usdc_checked, a.kind AS account_kind
             FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id=$1 FOR UPDATE OF t`,
          [transactionId],
        )
      )[0] as { id: number; type: string | null; amount: number; amount_uah: number | null; usdc_checked: boolean; account_kind: string } | undefined;
      if (!tx) throw new NotFoundException("transaction not found");
      if (ev.matched_transaction_id === tx.id) return this.eventView(m, eventId);
      const taken = await m.query(`SELECT 1 FROM income_events WHERE matched_transaction_id=$1`, [tx.id]);
      if (taken.length > 0) throw new ConflictException("transaction is already matched to another event");
      if (tx.usdc_checked && tx.type === "own_transfer") return this.eventView(m, eventId); // already taken off the balance
      const creditOnCard = tx.amount > 0 && (tx.account_kind === "black" || tx.account_kind === "white");
      if (!(tx.amount > 0 && (tx.type === "cash_in" || creditOnCard))) {
        throw new UnprocessableEntityException("only a cash deposit or a card credit can be matched");
      }
      if (tx.amount_uah === null) throw new UnprocessableEntityException("transaction has no hryvnia amount");

      if (ev.status === "received") {
        const rate = await this.usdRate(m);
        if (rate === null) throw new UnprocessableEntityException("no USD rate available");
        const cents = Math.round(tx.amount_uah / rate);
        await m.query(
          `UPDATE manual_balances SET amount = GREATEST(amount - $2, 0) WHERE name=$1`,
          [BINANCE, cents],
        );
      } else {
        await this.markReceived(m, ev, tx.amount_uah);
      }
      await m.query(`UPDATE income_events SET matched_transaction_id=COALESCE(matched_transaction_id, $2) WHERE id=$1`, [eventId, tx.id]);
      await m.query(
        `UPDATE transactions SET type='own_transfer', category='own', type_source='owner', needs_label=false, usdc_checked=true WHERE id=$1`,
        [tx.id],
      );
      // The money counted twice until now: the day's limit drops at once.
      await this.limit.invalidate("income", m);
      return this.eventView(m, eventId);
    });
  }

  /** The owner says this incoming row is not a Binance withdrawal: it is not asked about again. */
  async dismissUsdcMatch(transactionId: number): Promise<{ usdc_checked: true }> {
    const r: [unknown[], number] = await this.ds.query(`UPDATE transactions SET usdc_checked=true WHERE id=$1`, [transactionId]);
    if (r[1] === 0) throw new NotFoundException("transaction not found");
    return { usdc_checked: true };
  }

  /** Manual path: the owner says it was paid, and its money is free in the day's limit at once. Idempotent. */
  async markPaid(id: number): Promise<ScheduledPayment> {
    const paid = (await this.ds.query(`UPDATE scheduled_payments SET paid_at = now() WHERE id=$1 AND paid_at IS NULL`, [id])) as [unknown[], number];
    // TypeORM returns [rows, count] for an UPDATE on Postgres.
    if (paid[1] > 0) await this.limit.invalidate("payment_paid");
    const rows: ScheduledPayment[] = await this.ds.query(
      `SELECT id, kind, name, amount::float8 AS amount, currency, due_on::text AS due_on, paid_at,
              transaction_id, match_hint, overpayment FROM scheduled_payments WHERE id=$1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException("payment not found");
    return rows[0];
  }

  /**
   * Runs after a row has been given its type. Settles a planned payment, records a new loan or
   * marks the fop income event received. Safe to call again for the same row.
   */
  async onClassified(txId: number, typeHint?: string): Promise<void> {
    if (typeHint === "spend") {
      // Most rows are plain spend: only open a transaction if an installment could be involved.
      const maybe = await this.ds.query(
        `SELECT 1 FROM transactions t JOIN scheduled_payments p ON p.kind='installment'
            AND (p.transaction_id = t.id OR (p.paid_at IS NULL AND p.transaction_id IS NULL
                 AND abs(p.due_on - t.local_date) <= $2))
          WHERE t.id=$1 AND t.amount < 0 LIMIT 1`,
        [txId, MATCH_DAYS],
      );
      if (maybe.length === 0) return;
    }
    if (typeHint === "person_transfer" && !(await this.isPlannedRecipient(txId))) return;
    await this.ds.transaction(async (m) => {
      const t = (
        await m.query(
          `SELECT t.id, t.type, t.type_source, t.amount::float8 AS amount, a.currency, t.amount_uah::float8 AS amount_uah,
                  t.local_date::text AS local_date, t.occurred_at, a.kind AS account_kind,
                  concat_ws(' ', t.description, t.comment, t.counter_name) AS text
             FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id=$1`,
          [txId],
        )
      )[0] as (TxRow & { type_source: string | null }) | undefined;
      if (!t?.type) return;

      if (t.type === "loan_in") {
        await m.query(
          `INSERT INTO loans (amount, received_on, source_transaction_id, note, kind)
           SELECT $2, $3, $1, 'loan_in', $4 WHERE NOT EXISTS (SELECT 1 FROM loans WHERE source_transaction_id=$1)
           ON CONFLICT DO NOTHING`,
          [t.id, Math.abs(t.amount_uah ?? t.amount), t.local_date, SHORT_LOAN_TEXT.test(t.text) ? "short" : "other"],
        );
      } else if (t.type === "income" && t.account_kind === "fop") {
        await this.markFopEvents(m, t);
      } else if (t.type === "person_transfer") {
        if (typeHint !== "person_transfer" && !(await this.isPlannedRecipient(txId))) return;
        await this.settleFromPlannedRecipient(m, t);
      } else if (t.type === "obligation" || t.type === "debt_payment" || t.type === "tax" || t.type === "spend") {
        if (t.type === "debt_payment") await this.repayShortLoans(m, t);
        const linked = await m.query(`SELECT 1 FROM scheduled_payments WHERE transaction_id=$1`, [t.id]);
        if (linked.length > 0) {
          if (t.type === "spend") await this.retypeAsDebt(m, t.id);
          return;
        }
        // Tax rows stay candidates after the owner marked them paid: they can still claim their bank row.
        const open: Payment[] = await m.query(
          `SELECT id, kind, name, amount::float8 AS amount, currency, due_on::text AS due_on, paid_at,
                  transaction_id, match_hint, tax_quarter
             FROM scheduled_payments WHERE transaction_id IS NULL AND (paid_at IS NULL OR kind='tax')
            ORDER BY due_on, id FOR UPDATE`,
        );
        if (t.type === "spend" && t.type_source === "owner") return;
        const payable = { id: t.id, type: t.type, amount: t.amount, currency: t.currency, amountUah: t.amount_uah, localDate: t.local_date, text: t.text };
        const hit = matchTaxPayment(payable, open) ?? matchPayment(payable, open, await this.rates(m));
        if (hit) {
          await m.query(
            `UPDATE scheduled_payments SET paid_at=COALESCE(paid_at, $2), transaction_id=$3 WHERE id=$1`,
            [hit.id, t.occurred_at, t.id],
          );
          if (t.type === "spend") await this.retypeAsDebt(m, t.id);
        }
      }
    });
  }

  /** The owner said this recipient is a close person, sent money regularly. */
  private async isPlannedRecipient(txId: number): Promise<boolean> {
    const tx = (
      await this.ds.query(
        `SELECT amount::float8 AS amount, description, counter_iban AS "counterIban", counter_name AS "counterName" FROM transactions WHERE id=$1`,
        [txId],
      )
    )[0] as { amount: number; description: string; counterIban: string | null; counterName: string | null } | undefined;
    if (!tx || tx.amount >= 0) return false;
    const rules: { matchKind: "merchant" | "iban" | "recipient"; matchValue: string; direction: "in" | "out" | null }[] = await this.ds.query(
      `SELECT match_kind AS "matchKind", match_value AS "matchValue", direction FROM rules WHERE label = ANY($1::text[])`,
      [PLANNED_RECIPIENT_LABELS],
    );
    return rules.some((r) => ruleMatches(r, tx));
  }

  /**
   * Money to a close person counts against the day, except what the plan already set aside: a transfer
   * that settles a planned payment becomes that payment, so it is not counted twice.
   */
  private async settleFromPlannedRecipient(m: EntityManager, t: TxRow): Promise<void> {
    const linked = await m.query(`SELECT 1 FROM scheduled_payments WHERE transaction_id=$1`, [t.id]);
    let settled = linked.length > 0;
    if (!settled) {
      const open: Payment[] = await m.query(
        `SELECT id, kind, name, amount::float8 AS amount, currency, due_on::text AS due_on, paid_at, transaction_id, match_hint
           FROM scheduled_payments WHERE kind='obligation' AND transaction_id IS NULL AND paid_at IS NULL ORDER BY due_on, id FOR UPDATE`,
      );
      const hit = matchPayment(
        { id: t.id, type: "obligation", amount: t.amount, currency: t.currency, amountUah: t.amount_uah, localDate: t.local_date, text: t.text },
        open,
        await this.rates(m),
      );
      if (hit) {
        await m.query(`UPDATE scheduled_payments SET paid_at=$2, transaction_id=$3 WHERE id=$1`, [hit.id, t.occurred_at, t.id]);
        settled = true;
      }
    }
    if (settled) await m.query(`UPDATE transactions SET type='obligation', category='transfer' WHERE id=$1`, [t.id]);
  }

  /**
   * A repayment of a short loan (Кредит до завтра, МФО) pays the oldest open short loans first, up to
   * its amount; a loan stays open (with `repaid_amount` growing) until fully covered. Applied once per row.
   */
  private async repayShortLoans(m: EntityManager, t: TxRow): Promise<void> {
    if (t.amount >= 0 || !SHORT_LOAN_TEXT.test(t.text) || INTEREST_TEXT.test(t.text)) return;
    const fresh = await m.query(
      `INSERT INTO loan_repayments (transaction_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING transaction_id`,
      [t.id],
    );
    if (fresh.length === 0) return;
    let left = Math.abs(t.amount_uah ?? t.amount);
    const loans: { id: number; amount: number; repaid_amount: number }[] = await m.query(
      `SELECT id, amount::float8 AS amount, repaid_amount::float8 AS repaid_amount FROM loans
        WHERE kind='short' AND repaid_at IS NULL AND received_on <= $1 ORDER BY received_on, id FOR UPDATE`,
      [t.local_date],
    );
    for (const l of loans) {
      if (left <= 0) break;
      const pay = Math.min(left, l.amount - l.repaid_amount);
      left -= pay;
      const total = l.repaid_amount + pay;
      await m.query(`UPDATE loans SET repaid_amount=$2::bigint, repaid_at = CASE WHEN $2::bigint >= amount THEN $3::timestamptz END WHERE id=$1`, [
        l.id, total, t.occurred_at,
      ]);
    }
  }

  /** A store installment that classify() saw as spend is a debt payment; owner rows stay as they are. */
  private async retypeAsDebt(m: EntityManager, txId: number): Promise<void> {
    await m.query(
      `UPDATE transactions SET type='debt_payment', category='debt', type_source='rule'
        WHERE id=$1 AND type_source IS DISTINCT FROM 'owner'`,
      [txId],
    );
  }

  /**
   * Marks the month's fop event received once the incomes on the fop account in that month reach
   * half the expected amount, compared in hryvnias at the current rate. Without a rate it waits.
   */
  private async markFopEvents(m: EntityManager, t: TxRow): Promise<void> {
    const period = t.local_date.slice(0, 7);
    const events: { id: number; amount: number; currency: string }[] = await m.query(
      `SELECT e.id, x.amount::float8 AS amount, x.currency FROM income_events e
         JOIN expected_incomes x ON x.id = e.expected_income_id
        WHERE x.source='fop' AND e.period=$1 AND e.status <> 'received' FOR UPDATE OF e`,
      [period],
    );
    if (events.length === 0) return;
    const rates = await this.rates(m);
    const sum: number = (
      await m.query(
        `SELECT COALESCE(SUM(t.amount_uah),0)::float8 AS s FROM transactions t JOIN accounts a ON a.id = t.account_id
          WHERE a.kind='fop' AND t.type='income' AND t.amount_uah IS NOT NULL AND to_char(t.local_date,'YYYY-MM')=$1`,
        [period],
      )
    )[0].s;
    for (const e of events) {
      const rate = e.currency === "UAH" ? 1 : rates[e.currency];
      if (!rate || sum < (e.amount * rate) / 2) continue;
      await m.query(
        `UPDATE income_events SET status='received', received_at=$2, amount_uah=$3, matched_transaction_id=$4 WHERE id=$1`,
        [e.id, t.occurred_at, sum, t.id],
      );
    }
  }

  private async rates(m: EntityManager): Promise<Record<string, number>> {
    const rows: { currency: string; rate: number }[] = await m.query(
      `SELECT DISTINCT ON (currency) currency, rate::float8 AS rate FROM fx_rates ORDER BY currency, fetched_at DESC`,
    );
    return Object.fromEntries(rows.map((r) => [r.currency, r.rate]));
  }

  // --- helpers --------------------------------------------------------------
  private async lockEvent(m: EntityManager, id: number) {
    const ev = (
      await m.query(
        `SELECT e.id, e.status, e.matched_transaction_id, x.source, x.amount::float8 AS expected_amount, x.currency
           FROM income_events e JOIN expected_incomes x ON x.id = e.expected_income_id
          WHERE e.id=$1 FOR UPDATE OF e`,
        [id],
      )
    )[0] as
      | { id: number; status: string; matched_transaction_id: number | null; source: "fop" | "usdc"; expected_amount: number; currency: string }
      | undefined;
    if (!ev) throw new NotFoundException("income event not found");
    return ev;
  }

  /** Marks the event received; without `amountUah`, a USD income is recorded as `ev.expected_amount` at today's rate. */
  private async markReceived(
    m: EntityManager,
    ev: { id: number; expected_amount: number; currency: string },
    amountUah: number | null,
  ): Promise<void> {
    let uah = amountUah;
    if (uah === null && ev.currency === "USD") {
      const rate = await this.usdRate(m);
      if (rate !== null) uah = Math.round(ev.expected_amount * rate);
    }
    await m.query(`UPDATE income_events SET status='received', received_at=now(), amount_uah=$2 WHERE id=$1`, [ev.id, uah]);
  }

  private async usdRate(m: EntityManager): Promise<number | null> {
    const r = (await m.query(`SELECT rate::float8 AS rate FROM fx_rates WHERE currency='USD' ORDER BY fetched_at DESC LIMIT 1`))[0] as
      | { rate: number }
      | undefined;
    return r && r.rate > 0 ? r.rate : null;
  }

  private async eventView(m: EntityManager, id: number): Promise<IncomeEvent> {
    return (
      await m.query(
        `SELECT id, expected_income_id, period, expected_on::text AS expected_on, received_at, amount_uah::float8 AS amount_uah,
                status, matched_transaction_id FROM income_events WHERE id=$1`,
        [id],
      )
    )[0];
  }
}
