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
import { reopensOnUnlink } from "../domain/payment-cover";
import {
  type ExpectedForEvents,
  type HeldTaxLink,
  type PayableTx,
  type Payment,
  type PaymentKind,
  matchPayment,
  matchTaxPayment,
  matchTaxShare,
  monthlyDueDates,
  monthlyEvents,
  paymentUah,
  repairTaxLinks,
} from "../domain/recurring-match";
import {
  type FopIncome,
  type FopMonthIncome,
  fopIncomeByPeriod,
  receivedByLastMonthsMoney,
  waitsForLateIncome,
} from "../domain/fop-income";
import { previousMonth } from "../domain/insights";
import { kyivDate } from "../domain/money";
import { estimateDueOn, precedingQuarter, quarterBounds, quarterOf } from "../domain/quarter";
import { taxReserve } from "../domain/tax";
import { Clock, KYIV_TZ } from "../time/clock";
import { LimitService, type LimitReason } from "../today/limit.service";
import { quarterTaxFacts } from "../today/tax-facts";
import { INTEREST_TEXT, SHORT_LOAN_TEXT } from "./short-loan";
import { ScheduledPayment, type IncomeEvent } from "../db/entities";
import { answerOther, keepAnswer, rowBefore, undoAnswer } from "../cash/cash-answer";
import { BINANCE } from "./binance";

export { BINANCE } from "./binance";
const MATCH_DAYS = 3;
const PLANNED_RECIPIENT_LABELS = ["close_regular", "shared_budget"];
/** Types whose rows can settle a planned payment; a row retyped to anything else frees it. */
const SETTLING_TYPES: ReadonlySet<string> = new Set(["obligation", "debt_payment", "tax"]);
/** Fop income rows with a hryvnia amount, in order of arrival; which month each is, is domain/fop-income's rule. */
const FOP_INCOMES = `SELECT t.id, t.local_date::text AS "localDate", t.occurred_at AS "occurredAt", t.amount_uah::float8 AS "amountUah"
  FROM transactions t JOIN accounts a ON a.id = t.account_id
  WHERE a.kind='fop' AND t.type='income' AND t.amount > 0 AND t.amount_uah IS NOT NULL ORDER BY t.occurred_at, t.id`;

interface FopEventIncome {
  id: number;
  period: string;
  received: boolean;
  byBank: boolean;
  matchedId: number | null;
  amountUah: number | null;
  /** The income given to the event's month; undefined when none. */
  income: FopMonthIncome | undefined;
  /** The month each fop income row goes to for this event's expected income. */
  periodOf: Map<number, string>;
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
  @Cron("0 * * * *", { timeZone: KYIV_TZ })
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
   * leave the fixed limit alone, and so does a series that stays without rows because the owner deleted
   * its months (Б29).
   */
  private async generate(fixLimit = true): Promise<void> {
    const today = kyivDate(this.clock.now());
    const [{ fresh }] = (await this.ds.query(
      `SELECT EXISTS (SELECT 1 FROM expected_incomes x WHERE NOT EXISTS (SELECT 1 FROM income_events e WHERE e.expected_income_id = x.id)) AS fresh`,
    )) as [{ fresh: boolean }];
    await this.generateEvents(today);
    // Events the old rule left waiting after a small fop income are received now (Б33).
    await this.receiveFopEvents(this.ds.manager);
    const { firstRows } = await this.recurringRows(today);
    await this.linkTaxTransactions();
    if ((fresh || firstRows) && fixLimit) await this.limit.invalidate("plan");
  }

  /** The owner just added something to the plan: its dates are needed now. The caller fixes the limit afterwards. */
  refresh(): Promise<void> {
    return this.generate(false);
  }

  /** Just after midnight on the first day of a quarter this is what keeps the reserve in place. */
  @Cron("1 0 * * *", { timeZone: KYIV_TZ })
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
   * rows are seeded later), so unclaimed tax payments are tried again, on start and hourly. This is also
   * how payments read under an older rule reach their quarter (Б30), a top-up of a row its own operation
   * paid exactly among them (Б43). Newest first: a row goes to its latest fitting payment. Safe to repeat.
   */
  async linkTaxTransactions(): Promise<void> {
    const rows: { id: number }[] = await this.ds.query(
      `SELECT t.id FROM transactions t
        WHERE t.type='tax' AND t.amount < 0
          AND NOT EXISTS (SELECT 1 FROM scheduled_payments p WHERE p.transaction_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM payment_links l WHERE l.transaction_id = t.id)
          AND EXISTS (SELECT 1 FROM scheduled_payments p WHERE p.kind='tax')
        ORDER BY t.occurred_at DESC, t.id DESC`,
    );
    for (const r of rows) await this.onClassified(r.id, "tax");
    await this.takeBackTaxLinks();
  }

  /**
   * Task Б42, for links made before the rule: an open tax row with a part of its own takes back the one
   * payment a hand-closed row holds that completes it (repairTaxLinks), and closes. One move per transaction,
   * each fixing the day afresh; the hand-closed row keeps its mark. Safe to repeat: every move closes a row.
   */
  private async takeBackTaxLinks(): Promise<void> {
    for (let moved = true; moved; ) {
      moved = await this.ds.transaction(async (m) => {
        const payments = await this.lockTaxRows(m);
        const move = repairTaxLinks(payments, await this.heldTaxLinks(m));
        if (!move) return false;
        await m.query(`UPDATE payment_links SET payment_id=$1 WHERE transaction_id=$2`, [move.payment.id, move.txId]);
        await m.query(
          `UPDATE scheduled_payments SET closed_by_links = true,
                  paid_at = (SELECT max(t.occurred_at) FROM payment_links l JOIN transactions t ON t.id = l.transaction_id
                              WHERE l.payment_id = $1) WHERE id=$1 AND paid_at IS NULL`,
          [move.payment.id],
        );
        await this.limit.invalidate("payment_paid", m);
        return true;
      });
    }
  }

  /** Tax rows not settled through their own operation, locked, with what payment_links already paid on each. */
  private lockTaxRows(m: EntityManager): Promise<Payment[]> {
    return m.query(
      `SELECT p.id, p.kind, p.name, p.amount::float8 AS amount, p.currency, p.due_on::text AS due_on, p.paid_at,
              p.transaction_id, p.match_hint, p.tax_quarter, p.is_estimate, p.closed_by_links,
              (SELECT COALESCE(SUM(-COALESCE(x.amount_uah, x.amount)), 0) FROM payment_links l
                 JOIN transactions x ON x.id = l.transaction_id WHERE l.payment_id = p.id)::float8 AS linked
         FROM scheduled_payments p WHERE p.kind='tax' AND p.transaction_id IS NULL ORDER BY p.due_on, p.id FOR UPDATE OF p`,
    );
  }

  /**
   * Tax payments linked to tax rows the owner closed by hand (Б42). payment_links keeps no source; the matcher
   * links only tax-typed rows, and the «Оплачено» sheet retypes what the owner chose to obligation, so only
   * the matcher's links are here.
   */
  private async heldTaxLinks(m: EntityManager): Promise<HeldTaxLink[]> {
    const rows: (PayableTx & { paymentId: number })[] = await m.query(
      `SELECT l.payment_id AS "paymentId", t.id, t.type, t.amount::float8 AS amount, a.currency,
              t.amount_uah::float8 AS "amountUah", t.local_date::text AS "localDate", '' AS text
         FROM payment_links l JOIN scheduled_payments p ON p.id = l.payment_id
         JOIN transactions t ON t.id = l.transaction_id JOIN accounts a ON a.id = t.account_id
        WHERE p.kind='tax' AND p.paid_at IS NOT NULL AND NOT p.closed_by_links AND t.type='tax' AND t.amount < 0
        ORDER BY t.id`,
    );
    return rows.map(({ paymentId, ...tx }) => ({ paymentId, tx }));
  }

  /**
   * Creates this and next month's payment for every active recurring series. Returns new rows. Never a
   * day before the series started (a day already past when it was set up was paid, or not tracked,
   * before setup, and would show up as overdue), nor a month the owner deleted from it (Б29).
   */
  async generateRecurring(today: string = kyivDate(this.clock.now())): Promise<number> {
    return (await this.recurringRows(today)).created;
  }

  /** `firstRows`: some series that had no rows got its first ones here. */
  private async recurringRows(today: string): Promise<{ created: number; firstRows: boolean }> {
    const series: {
      id: number;
      kind: string;
      name: string;
      amount: number;
      currency: string;
      day_of_month: number;
      match_hint: string | null;
      starts_on: string;
    }[] = await this.ds.query(
      `SELECT id, kind, name, amount::float8 AS amount, currency, day_of_month, match_hint, starts_on::text AS starts_on
         FROM recurring_payments WHERE active ORDER BY id`,
    );
    let created = 0;
    let firstRows = false;
    for (const r of series) {
      // A series with no rows yet (set up long ago while paused, say) gets nothing already past either.
      const fresh = (await this.ds.query(`SELECT 1 FROM scheduled_payments WHERE recurring_id=$1 LIMIT 1`, [r.id])).length === 0;
      for (const due of monthlyDueDates(r.day_of_month, today)) {
        if (due < r.starts_on || (fresh && due < today)) continue;
        const out: unknown[] = await this.ds.query(
          `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, match_hint, recurring_id)
           SELECT $1,$2,$3,$4,$5::date,$6,$7
            WHERE NOT EXISTS (SELECT 1 FROM recurring_skips s
                               WHERE s.recurring_id = $7 AND date_trunc('month', s.due_on) = date_trunc('month', $5::date))
           ON CONFLICT (recurring_id, due_on) DO NOTHING RETURNING id`,
          [r.kind, r.name, r.amount, r.currency, due, r.match_hint, r.id],
        );
        created += out.length;
        if (fresh && out.length > 0) firstRows = true;
      }
    }
    return { created, firstRows };
  }

  /** Creates this and next month's events. Returns how many were new. */
  async generateEvents(today: string = kyivDate(this.clock.now())): Promise<number> {
    const expected: ExpectedForEvents[] = await this.ds.query(
      `SELECT id, window_start_day, window_end_day, schedule, second_day FROM expected_incomes ORDER BY id`,
    );
    let created = 0;
    for (const e of monthlyEvents(expected, today)) {
      const r: unknown[] = await this.ds.query(
        `INSERT INTO income_events (expected_income_id, period, expected_on, status, slot) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (expected_income_id, period, slot) DO NOTHING RETURNING id`,
        [e.expected_income_id, e.period, e.expected_on, e.status, e.slot],
      );
      created += r.length;
    }
    return created;
  }

  listEvents(): Promise<IncomeEvent[]> {
    return this.ds.query(
      `SELECT id, expected_income_id, period, expected_on::text AS expected_on, received_at, amount_uah::float8 AS amount_uah,
              status, matched_transaction_id, slot
         FROM income_events ORDER BY period, expected_income_id, id`,
    );
  }

  async setEventDate(id: number, date: string): Promise<IncomeEvent> {
    const found = await this.ds.query(`SELECT 1 FROM income_events WHERE id=$1`, [id]);
    if (found.length === 0) throw new NotFoundException("income event not found");
    // The owner's own date: a later change of the window leaves it where he put it (task Б28).
    await this.ds.query(`UPDATE income_events SET expected_on=$2, date_set_by_hand=true WHERE id=$1`, [id, date]);
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
        const balanceDelta = ev.crypto ? received : 0;
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
   * A card credit or cash deposit that is the USDC arriving by another way: see answerBinance. Asking
   * again about a row already matched, or already an own transfer from Binance or the wallet, changes nothing.
   */
  async matchTransaction(eventId: number, transactionId: number): Promise<IncomeEvent> {
    return this.ds.transaction(async (m) => {
      const ev = await this.lockEvent(m, eventId);
      if (!ev.crypto) throw new UnprocessableEntityException("only USDC events can be matched");
      const tx = (await m.query(`SELECT id, type, usdc_checked FROM transactions WHERE id=$1 FOR UPDATE`, [transactionId]))[0] as
        | { id: number; type: string | null; usdc_checked: boolean }
        | undefined;
      if (!tx) throw new NotFoundException("transaction not found");
      if (ev.matched_transaction_id === tx.id) return this.eventView(m, eventId);
      const taken = await m.query(`SELECT 1 FROM income_events WHERE matched_transaction_id=$1`, [tx.id]);
      if (taken.length > 0) throw new ConflictException("transaction is already matched to another event");
      if (tx.usdc_checked && tx.type === "own_transfer") return this.eventView(m, eventId); // already taken off the balance
      await this.answerBinance(m, eventId, tx.id);
      // The money counted twice until now: the day's limit drops at once.
      await this.limit.invalidate("income", m);
      return this.eventView(m, eventId);
    });
  }

  /**
   * «Вывод с Binance» about this row, in the caller's transaction (the caller fixes the limit afresh): lowers
   * the Binance balance by its hryvnia amount at the current USD rate, never below zero, and retypes the row
   * as an own transfer. One event can take several rows: withdrawing in parts just lowers the balance each
   * time, and each row counts once. An event not yet confirmed is confirmed by this match (the money was never
   * on Binance in the app's books, so the balance is left alone). The answer is kept with the cents really
   * taken and the event's earlier status, so that changing it undoes exactly this (task Б21).
   */
  async answerBinance(m: EntityManager, eventId: number, transactionId: number): Promise<void> {
    const ev = await this.lockEvent(m, eventId);
    if (!ev.crypto) throw new UnprocessableEntityException("only USDC events can be matched");
    const tx = (
      await m.query(
        `SELECT t.id, t.type, t.amount::float8 AS amount, t.amount_uah::float8 AS amount_uah, a.kind AS account_kind
           FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id=$1 FOR UPDATE OF t`,
        [transactionId],
      )
    )[0] as { id: number; type: string | null; amount: number; amount_uah: number | null; account_kind: string } | undefined;
    if (!tx) throw new NotFoundException("transaction not found");
    const creditOnCard = tx.amount > 0 && (tx.account_kind === "black" || tx.account_kind === "white");
    if (!(tx.amount > 0 && (tx.type === "cash_in" || creditOnCard))) {
      throw new UnprocessableEntityException("only a cash deposit or a card credit can be matched");
    }
    if (tx.amount_uah === null) throw new UnprocessableEntityException("transaction has no hryvnia amount");

    // An earlier «Другое» about the row gives way to this answer.
    await undoAnswer(m, tx.id);
    const before = await rowBefore(m, tx.id);
    let taken = 0;
    let statusBefore: string | null = null;
    if (ev.status === "received") {
      const rate = await this.usdRate(m);
      if (rate === null) throw new UnprocessableEntityException("no USD rate available");
      const cents = Math.round(tx.amount_uah / rate);
      const b = (await m.query(`SELECT amount::float8 AS amount FROM manual_balances WHERE name=$1 FOR UPDATE`, [BINANCE]))[0] as
        | { amount: number }
        | undefined;
      if (b) {
        const next = Math.max(b.amount - cents, 0);
        await m.query(`UPDATE manual_balances SET amount=$2 WHERE name=$1`, [BINANCE, next]);
        taken = b.amount - next;
      }
    } else {
      statusBefore = ev.status;
      await this.markReceived(m, ev, tx.amount_uah);
    }
    await m.query(`UPDATE income_events SET matched_transaction_id=COALESCE(matched_transaction_id, $2) WHERE id=$1`, [eventId, tx.id]);
    await m.query(
      `UPDATE transactions SET type='own_transfer', category='own', type_source='owner', needs_label=false, usdc_checked=true WHERE id=$1`,
      [tx.id],
    );
    await keepAnswer(m, tx.id, "binance", before, { binanceCents: taken, eventId, eventStatusBefore: statusBefore });
  }

  /** The owner says this incoming row is not a Binance withdrawal: it is not asked about again. The answer is kept (Б21). */
  async dismissUsdcMatch(transactionId: number): Promise<{ usdc_checked: true }> {
    return this.ds.transaction(async (m) => {
      const t = (await m.query(`SELECT usdc_checked FROM transactions WHERE id=$1 FOR UPDATE`, [transactionId]))[0] as
        | { usdc_checked: boolean }
        | undefined;
      if (!t) throw new NotFoundException("transaction not found");
      if (!t.usdc_checked) await answerOther(m, transactionId);
      return { usdc_checked: true as const };
    });
  }

  /**
   * «Это оплата?» answered no (task Б8): this operation did not pay this payment, and the pair is not
   * asked about again. Nothing about money changes. Idempotent.
   */
  async dismissPaymentMatch(paymentId: number, transactionId: number): Promise<{ dismissed: true }> {
    const found: { payment: boolean; tx: boolean }[] = await this.ds.query(
      `SELECT EXISTS (SELECT 1 FROM scheduled_payments WHERE id=$1) AS payment, EXISTS (SELECT 1 FROM transactions WHERE id=$2) AS tx`,
      [paymentId, transactionId],
    );
    if (!found[0]!.payment) throw new NotFoundException("payment not found");
    if (!found[0]!.tx) throw new NotFoundException("transaction not found");
    await this.ds.query(`INSERT INTO payment_dismissals (payment_id, transaction_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [paymentId, transactionId]);
    return { dismissed: true };
  }

  /** Manual path: the owner says it was paid, and its money is free in the day's limit at once. Idempotent. */
  async markPaid(id: number): Promise<ScheduledPayment> {
    // Closed by hand: losing a linked operation later does not open it again (task Б26).
    const paid = (await this.ds.query(
      `UPDATE scheduled_payments SET paid_at = now(), closed_by_links = false WHERE id=$1 AND paid_at IS NULL`,
      [id],
    )) as [unknown[], number];
    // TypeORM returns [rows, count] for an UPDATE on Postgres.
    if (paid[1] > 0) await this.limit.invalidate("payment_paid");
    const rows: ScheduledPayment[] = await this.ds.query(
      `SELECT id, kind, name, amount::float8 AS amount, currency, due_on::text AS due_on, paid_at,
              transaction_id, match_hint, overpayment FROM scheduled_payments WHERE id=$1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException("payment not found");
    // A tax closed by hand takes payments off its figure now (Б30): link them at once, not at the next hour.
    if (paid[1] > 0 && rows[0].kind === "tax") await this.linkTaxTransactions();
    return rows[0];
  }

  /**
   * Runs after a row has been given its type. Settles a planned payment, records a new loan or
   * marks the fop income event received. Safe to call again for the same row.
   *
   * `byOwner`: the type was given by the owner's hand (an edit, an answer about a recipient), so a loan
   * recorded, a payment closed or a short loan repaid here fixes the day afresh in the same transaction
   * (task Б35). Automatic classification leaves it false: money that arrives on its own keeps the day's limit.
   */
  async onClassified(txId: number, typeHint?: string, byOwner = false): Promise<void> {
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
      const changed = await this.classifyRow(m, t, typeHint);
      if (byOwner && changed) await this.limit.invalidate(changed, m);
    });
  }

  /**
   * onClassified's work on one row, in its transaction. Returns what it changed in money that the day's limit
   * has not seen yet (a loan recorded or repaid, a payment closed); null when nothing changed, or when the
   * change already fixed the day afresh here (a tax).
   */
  private async classifyRow(m: EntityManager, t: TxRow & { type_source: string | null }, typeHint?: string): Promise<LimitReason | null> {
    if (t.type === "loan_in") {
      const made: unknown[] = await m.query(
        `INSERT INTO loans (amount, received_on, source_transaction_id, note, kind)
         SELECT $2, $3, $1, 'loan_in', $4 WHERE NOT EXISTS (SELECT 1 FROM loans WHERE source_transaction_id=$1)
         ON CONFLICT DO NOTHING RETURNING id`,
        [t.id, Math.abs(t.amount_uah ?? t.amount), t.local_date, SHORT_LOAN_TEXT.test(t.text) ? "short" : "other"],
      );
      return made.length > 0 ? "loan" : null;
    } else if (t.type === "income" && t.account_kind === "fop") {
      await this.markFopEvents(m, t);
    } else if (t.type === "person_transfer") {
      if (typeHint !== "person_transfer" && !(await this.isPlannedRecipient(t.id))) return null;
      return (await this.settleFromPlannedRecipient(m, t)) ? "payment_paid" : null;
    } else if (t.type === "obligation" || t.type === "debt_payment" || t.type === "tax" || t.type === "spend") {
      const repaid = t.type === "debt_payment" && (await this.repayShortLoans(m, t));
      const loanReason: LimitReason | null = repaid ? "loan" : null;
      const linked = await m.query(
        `SELECT 1 FROM scheduled_payments WHERE transaction_id=$1 UNION ALL SELECT 1 FROM payment_links WHERE transaction_id=$1`,
        [t.id],
      );
      if (linked.length > 0) {
        if (t.type === "spend") await this.retypeAsDebt(m, t.id);
        return loanReason;
      }
      // Tax rows stay candidates after the owner marked them paid: they can still claim their bank row. Tax
      // rows paid through their own operation come too, with its hryvnia (`matched`): they take a top-up (Б43);
      // the exact matchers skip them.
      const open: Payment[] = await m.query(
        `SELECT p.id, p.kind, p.name, p.amount::float8 AS amount, p.currency, p.due_on::text AS due_on, p.paid_at,
                p.transaction_id, p.match_hint, p.tax_quarter, p.is_estimate, p.closed_by_links,
                (SELECT COALESCE(SUM(-COALESCE(x.amount_uah, x.amount)), 0) FROM payment_links l
                   JOIN transactions x ON x.id = l.transaction_id WHERE l.payment_id = p.id)::float8 AS linked,
                (SELECT -COALESCE(x.amount_uah, x.amount) FROM transactions x WHERE x.id = p.transaction_id)::float8 AS matched
           FROM scheduled_payments p WHERE p.kind='tax' OR (p.transaction_id IS NULL AND p.paid_at IS NULL)
          ORDER BY p.due_on, p.id FOR UPDATE OF p`,
      );
      if (t.type === "spend" && t.type_source === "owner") return loanReason;
      const payable = { id: t.id, type: t.type, amount: t.amount, currency: t.currency, amountUah: t.amount_uah, localDate: t.local_date, text: t.text };
      const hit = matchTaxPayment(payable, open) ?? matchPayment(payable, open, await this.rates(m));
      if (hit) {
        await m.query(
          `UPDATE scheduled_payments SET paid_at=COALESCE(paid_at, $2), transaction_id=$3 WHERE id=$1`,
          [hit.id, t.occurred_at, t.id],
        );
        if (t.type === "spend") await this.retypeAsDebt(m, t.id);
        // A tax row claiming its payment moves it off this quarter's accrual, closed or not: the day is fixed afresh.
        if (hit.kind === "tax") {
          await this.limit.invalidate("payment_paid", m);
          return null;
        }
        return "payment_paid";
      } else if (t.type === "tax") {
        // A share that links fixes the day afresh itself.
        await this.settleTaxShare(m, payable, t.occurred_at, open);
        return null;
      }
      return loanReason;
    }
    return null;
  }

  /**
   * A tax paid in parts, or off its row by a little (tasks Б24, Б30): the operations are linked to the row
   * through payment_links, and an open row is closed once they add up to it; a row closed by hand keeps its
   * mark. A link takes the payment off this quarter's accrual, so every link fixes the day afresh. See
   * matchTaxShare.
   */
  private async settleTaxShare(m: EntityManager, tx: PayableTx, occurredAt: Date, open: readonly Payment[]): Promise<void> {
    const others: PayableTx[] = await m.query(
      `SELECT t.id, t.type, t.amount::float8 AS amount, a.currency, t.amount_uah::float8 AS "amountUah",
              t.local_date::text AS "localDate", '' AS text
         FROM transactions t JOIN accounts a ON a.id = t.account_id
        WHERE t.type='tax' AND t.amount < 0 AND t.id <> $1
          AND NOT EXISTS (SELECT 1 FROM scheduled_payments p WHERE p.transaction_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM payment_links l WHERE l.transaction_id = t.id)`,
      [tx.id],
    );
    const share = matchTaxShare(tx, open, others, await this.heldTaxLinks(m));
    if (!share) return;
    if (share.release) await m.query(`DELETE FROM payment_links WHERE payment_id=$1`, [share.payment.id]);
    // A payment taken back from a hand-closed row leaves it; that row keeps its mark (Б42).
    if (share.moved) await m.query(`DELETE FROM payment_links WHERE transaction_id = ANY($1::int[])`, [share.moved]);
    await m.query(`INSERT INTO payment_links (payment_id, transaction_id) SELECT $1, unnest($2::int[])`, [share.payment.id, share.ids]);
    if (share.closes) {
      // Closed by its links: it opens again if it loses one and the rest no longer cover it (task Б26).
      await m.query(`UPDATE scheduled_payments SET paid_at=COALESCE(paid_at, $2), closed_by_links = true WHERE id=$1`, [share.payment.id, occurredAt]);
    }
    await this.limit.invalidate("payment_paid", m);
  }

  /**
   * These payments have just lost linked operations (task Б26). Those their links closed open again when what
   * is still linked no longer covers them (reopensOnUnlink); one closed by hand stays closed. True when any
   * opened: the caller fixes the day afresh in the same transaction.
   */
  async reopenUncovered(m: EntityManager, paymentIds: readonly number[]): Promise<boolean> {
    if (paymentIds.length === 0) return false;
    const rows: {
      id: number; kind: PaymentKind; amount: number; currency: string; is_estimate: boolean; paid: boolean; closed_by_links: boolean; linked: number;
    }[] =
      await m.query(
        `SELECT p.id, p.kind, p.amount::float8 AS amount, p.currency, p.is_estimate, p.paid_at IS NOT NULL AS paid, p.closed_by_links,
                (SELECT COALESCE(SUM(-COALESCE(x.amount_uah, x.amount)), 0) FROM payment_links l
                   JOIN transactions x ON x.id = l.transaction_id WHERE l.payment_id = p.id)::float8 AS linked
           FROM scheduled_payments p WHERE p.id = ANY($1::int[]) ORDER BY p.id FOR UPDATE OF p`,
        [[...new Set(paymentIds)]],
      );
    // What is linked is in hryvnias: a foreign payment is compared at the latest rate, as payWith closed it (task Б44).
    // With no rate its amount is unknown, and it stays closed: it is not opened on a guess.
    const rates = rows.some((r) => r.currency !== "UAH") ? await this.rates(m) : {};
    const reopen = rows
      .filter((r) => {
        const amount = paymentUah(r, rates);
        if (amount === null) return false;
        return reopensOnUnlink({ kind: r.kind, amount, isEstimate: r.is_estimate, paid: r.paid, closedByLinks: r.closed_by_links }, r.linked);
      })
      .map((r) => r.id);
    if (reopen.length === 0) return false;
    await m.query(`UPDATE scheduled_payments SET paid_at = NULL, closed_by_links = false WHERE id = ANY($1::int[])`, [reopen]);
    return true;
  }

  /**
   * Rows retyped to a type that settles nothing free their planned payments, in the retype's transaction: by the
   * owner's hand or by a reclassify (task Б52). A payment closed through the row itself (transaction_id) opens
   * again. A row linked through payment_links is unlinked, and its payment opens again only if those links closed
   * it and the rest no longer cover it (task Б26); a payment marked paid by hand stays paid. Rows retyped away
   * from loan_in take their loan with them, while nothing was repaid on it (task Б35). Returns what changed, for
   * the caller to fix the day afresh with, or null.
   */
  async unsettle(m: EntityManager, ids: readonly number[], type: string): Promise<LimitReason | null> {
    if (ids.length === 0) return null;
    const reopenedIncome = type === "income" ? false : await this.releaseFopIncome(m, ids);
    const dropped = type === "loan_in" ? false : await this.dropLoans(m, ids);
    if (SETTLING_TYPES.has(type)) return dropped ? "loan" : reopenedIncome ? "income" : null;
    const unlinked: { payment_id: number }[] = await m.query(
      `WITH d AS (DELETE FROM payment_links WHERE transaction_id = ANY($1::int[]) RETURNING payment_id) SELECT DISTINCT payment_id FROM d`,
      [ids],
    );
    const freed = (await m.query(
      `UPDATE scheduled_payments SET transaction_id = NULL, paid_at = NULL, closed_by_links = false WHERE transaction_id = ANY($1::int[])`,
      [ids],
    )) as [unknown[], number];
    const reopened = await this.reopenUncovered(m, unlinked.map((u) => u.payment_id));
    if (freed[1] > 0 || reopened) return "payment_paid";
    return dropped ? "loan" : reopenedIncome ? "income" : null;
  }

  /**
   * Rows that stopped being income (already retyped in this transaction) give back the fop income they brought
   * (task Б49; a transfer to oneself typed income before Б38). An event the bank received with one of them is
   * opened and then given its month's income afresh by domain/fop-income's rule, as the hourly job does: income
   * that is still there receives it again with its own first row, time and sum, and with none left it waits again,
   * its date (`expected_on`, `date_set_by_hand`) untouched. A received event whose sum counted one of them keeps
   * its first row and gets the smaller sum. Events confirmed by hand (no row) and USDC events are not touched.
   * True when any fop event received before waits again, the rows' own or another month the same pass opened
   * (task Б53): the next income date moved, and the day is fixed afresh.
   */
  private async releaseFopIncome(m: EntityManager, ids: readonly number[]): Promise<boolean> {
    const taken: { id: number }[] = await m.query(
      `SELECT e.id FROM income_events e JOIN expected_incomes x ON x.id = e.expected_income_id AND x.pays_fop_tax
        WHERE e.status='received' AND e.matched_transaction_id = ANY($1::int[]) FOR UPDATE OF e`,
      [ids],
    );
    // The months a fop credit among the rows could have counted in: its own, or the one before (Б46).
    const months: { month: string }[] = await m.query(
      `SELECT DISTINCT to_char(t.local_date, 'YYYY-MM') AS month FROM transactions t JOIN accounts a ON a.id = t.account_id
        WHERE t.id = ANY($1::int[]) AND a.kind='fop' AND t.amount > 0`,
      [ids],
    );
    if (taken.length === 0 && months.length === 0) return false;
    // What was received before, so that any event the pass leaves waiting is seen, not only the rows' own (Б53).
    const received: { id: number }[] = await m.query(
      `SELECT e.id FROM income_events e JOIN expected_incomes x ON x.id = e.expected_income_id AND x.pays_fop_tax WHERE e.status='received'`,
    );
    const takenIds = taken.map((e) => e.id);
    if (takenIds.length > 0) {
      await m.query(
        `UPDATE income_events SET status='expected', received_at=NULL, amount_uah=NULL, matched_transaction_id=NULL WHERE id = ANY($1::int[])`,
        [takenIds],
      );
      await this.receiveFopEvents(m);
    }
    const periods = new Set(months.flatMap((r) => [r.month, previousMonth(r.month)]));
    for (const e of await this.fopEventIncome(m)) {
      if (!periods.has(e.period) || !e.received || !e.byBank || !e.income || e.amountUah === e.income.sum) continue;
      await m.query(`UPDATE income_events SET amount_uah=$2 WHERE id=$1 AND status='received' AND matched_transaction_id IS NOT NULL`, [
        e.id,
        e.income.sum,
      ]);
    }
    if (received.length === 0) return false;
    const waiting: unknown[] = await m.query(`SELECT 1 FROM income_events WHERE id = ANY($1::int[]) AND status <> 'received' LIMIT 1`, [
      received.map((e) => e.id),
    ]);
    return waiting.length > 0;
  }

  /**
   * A reclassify gave this row another type (task Б52): what it settled under the old one is freed as by the
   * owner's hand (unsettle), and a payment that opens or a loan that goes fixes the day afresh in the same
   * transaction. Unlike money that arrives on its own, this takes back what the day already counted as paid.
   */
  async onRetyped(m: EntityManager, txId: number, from: string, to: string): Promise<void> {
    if (await this.keepsOwnRetype(m, txId, from, to)) return;
    const changed = await this.unsettle(m, [txId], to);
    if (changed) await this.limit.invalidate(changed, m);
  }

  /**
   * The plan itself retypes some rows after classification, and onClassified does it again on every pass while
   * the row holds its payment: a store installment classified as spend is stored as debt_payment (retypeAsDebt),
   * and a transfer to a planned recipient as obligation (settleFromPlannedRecipient). classify() gives such a row
   * its raw type back each time; that is no change of type, and what it settled stays settled (task Б52).
   * The conditions are onClassified's own for putting the type back.
   */
  private async keepsOwnRetype(m: EntityManager, txId: number, from: string, to: string): Promise<boolean> {
    if (from === "debt_payment" && to === "spend") {
      const held = await m.query(
        `SELECT 1 FROM transactions t JOIN scheduled_payments p ON p.kind='installment' AND p.transaction_id = t.id
          WHERE t.id=$1 AND t.amount < 0 LIMIT 1`,
        [txId],
      );
      return held.length > 0;
    }
    if (from === "obligation" && to === "person_transfer") {
      const held = await m.query(`SELECT 1 FROM scheduled_payments WHERE transaction_id=$1 LIMIT 1`, [txId]);
      return held.length > 0 && (await this.isPlannedRecipient(txId));
    }
    return false;
  }

  /**
   * The loans these rows recorded as loan_in. One with anything repaid stays: its repayments are the owner's
   * record, and what to do with them is not decided (task Б35). True when one went.
   */
  private async dropLoans(m: EntityManager, ids: readonly number[]): Promise<boolean> {
    const gone = (await m.query(
      `DELETE FROM loans WHERE source_transaction_id = ANY($1::int[]) AND repaid_amount = 0 AND repaid_at IS NULL`,
      [ids],
    )) as [unknown[], number];
    return gone[1] > 0;
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
   * that settles a planned payment becomes that payment, so it is not counted twice. True when it closed a
   * payment just now.
   */
  private async settleFromPlannedRecipient(m: EntityManager, t: TxRow): Promise<boolean> {
    const linked = await m.query(`SELECT 1 FROM scheduled_payments WHERE transaction_id=$1`, [t.id]);
    let settled = linked.length > 0;
    let closed = false;
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
        closed = true;
      }
    }
    if (settled) await m.query(`UPDATE transactions SET type='obligation', category='transfer' WHERE id=$1`, [t.id]);
    return closed;
  }

  /**
   * A repayment of a short loan (Кредит до завтра, МФО) pays the oldest open short loans first, up to
   * its amount; a loan stays open (with `repaid_amount` growing) until fully covered. Applied once per row,
   * and only once there is a loan to pay: a repayment seen before its loan waits for the next pass. True when
   * it paid a loan just now.
   */
  private async repayShortLoans(m: EntityManager, t: TxRow): Promise<boolean> {
    if (t.amount >= 0 || !SHORT_LOAN_TEXT.test(t.text) || INTEREST_TEXT.test(t.text)) return false;
    // A loan taken after the repayment (a rollover later that day) is not what it repaid.
    const loans: { id: number; amount: number; repaid_amount: number }[] = await m.query(
      `SELECT l.id, l.amount::float8 AS amount, l.repaid_amount::float8 AS repaid_amount
         FROM loans l LEFT JOIN transactions s ON s.id = l.source_transaction_id
        WHERE l.kind='short' AND l.repaid_at IS NULL AND l.received_on <= $1 AND (s.id IS NULL OR s.occurred_at <= $2)
        ORDER BY l.received_on, l.id FOR UPDATE OF l`,
      [t.local_date, t.occurred_at],
    );
    if (loans.length === 0) return false;
    const fresh = await m.query(
      `INSERT INTO loan_repayments (transaction_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING transaction_id`,
      [t.id],
    );
    if (fresh.length === 0) return false;
    let left = Math.abs(t.amount_uah ?? t.amount);
    for (const l of loans) {
      if (left <= 0) break;
      const pay = Math.min(left, l.amount - l.repaid_amount);
      left -= pay;
      const total = l.repaid_amount + pay;
      await m.query(`UPDATE loans SET repaid_amount=$2::bigint, repaid_at = CASE WHEN $2::bigint >= amount THEN $3::timestamptz END WHERE id=$1`, [
        l.id, total, t.occurred_at,
      ]);
    }
    return true;
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
   * Any income on the fop account in a month, whatever its size, is that month's fop income (task Б33, the
   * owner's decision of 16 November): the month's fop event is received at the first such income, with the
   * month's sum in hryvnias. More income later that month raises the sum and keeps the first arrival's time, so
   * the next income date moves on to next month at once and never hangs on a month whose money came. A row
   * without a hryvnia amount waits. Refunds to the fop account are not income (Б5) and do not count.
   *
   * Which month an income is follows domain/fop-income (task Б46): last month's money that comes early next month,
   * before next month's window, receives last month while last month still waits for it, and stays out of next
   * month's sum.
   */
  private async markFopEvents(m: EntityManager, t: TxRow): Promise<void> {
    for (const e of await this.fopEventIncome(m)) {
      if (!e.income || e.periodOf.get(t.id) !== e.period) continue;
      if (!e.received) await this.receiveFopEvent(m, e.id, e.income);
      else if (e.byBank && e.amountUah !== e.income.sum) {
        await m.query(`UPDATE income_events SET amount_uah=$2 WHERE id=$1 AND status='received' AND matched_transaction_id IS NOT NULL`, [
          e.id,
          e.income.sum,
        ]);
      }
    }
  }

  /**
   * Fop events still expected whose month already has fop income are received, dated by its first income
   * (the hourly job: events the old half-the-amount rule, or the calendar-month rule before Б46, left waiting).
   * Safe to repeat; a received event is never re-dated. Like any bank credit it leaves the day's fixed limit alone.
   *
   * It also repairs what the calendar-month rule did before Б46: an event received by last month's late money,
   * with no income of its own month, is opened again (receivedByLastMonthsMoney) while last month takes that money,
   * so the next income date is its own window's again. Its date (`expected_on`, `date_set_by_hand`) is untouched.
   * Both follow from the same attribution, so a second run finds nothing to do.
   */
  private async receiveFopEvents(m: EntityManager): Promise<void> {
    for (const e of await this.fopEventIncome(m)) {
      if (receivedByLastMonthsMoney({ period: e.period, received: e.received, matchedId: e.matchedId, hasIncome: e.income !== undefined }, e.periodOf)) {
        await m.query(
          `UPDATE income_events SET status='expected', received_at=NULL, amount_uah=NULL, matched_transaction_id=NULL
            WHERE id=$1 AND status='received' AND matched_transaction_id=$2`,
          [e.id, e.matchedId],
        );
      } else if (!e.received && e.income) await this.receiveFopEvent(m, e.id, e.income);
    }
  }

  private async receiveFopEvent(m: EntityManager, id: number, income: FopMonthIncome): Promise<void> {
    await m.query(
      `UPDATE income_events SET status='received', received_at=$2, amount_uah=$3, matched_transaction_id=$4 WHERE id=$1 AND status <> 'received'`,
      [id, income.firstAt, income.sum, income.firstId],
    );
  }

  /**
   * Every fop event with the fop income its month takes, by domain/fop-income's rule for its expected income. A fop
   * event is one of an income that pays the fop tax (Д3а); such an income has one event a month (domain/incomes).
   */
  private async fopEventIncome(m: EntityManager): Promise<FopEventIncome[]> {
    const events: {
      id: number;
      expected_income_id: number;
      period: string;
      status: string;
      matched_transaction_id: number | null;
      amount_uah: number | null;
      window_start_day: number;
      matched_on: string | null;
    }[] = await m.query(
      `SELECT e.id, e.expected_income_id, e.period, e.status, e.matched_transaction_id, e.amount_uah::float8 AS amount_uah,
              x.window_start_day, mt.local_date::text AS matched_on
         FROM income_events e JOIN expected_incomes x ON x.id = e.expected_income_id AND x.pays_fop_tax
         LEFT JOIN transactions mt ON mt.id = e.matched_transaction_id
        WHERE e.slot = 1
        ORDER BY e.expected_income_id, e.period`,
    );
    if (events.length === 0) return [];
    const incomes: FopIncome[] = await m.query(FOP_INCOMES);
    const out: FopEventIncome[] = [];
    for (const xid of new Set(events.map((e) => e.expected_income_id))) {
      const own = events.filter((e) => e.expected_income_id === xid);
      const waiting = new Set(
        own
          .filter((e) => waitsForLateIncome({ period: e.period, received: e.status === "received", matchedOn: e.matched_on }))
          .map((e) => e.period),
      );
      const { periodOf, months } = fopIncomeByPeriod(incomes, own[0]!.window_start_day, waiting);
      for (const e of own) {
        out.push({
          id: e.id,
          period: e.period,
          received: e.status === "received",
          byBank: e.matched_transaction_id !== null,
          matchedId: e.matched_transaction_id,
          amountUah: e.amount_uah,
          income: months.get(e.period),
          periodOf,
        });
      }
    }
    return out;
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
        `SELECT e.id, e.status, e.matched_transaction_id, x.crypto, x.amount::float8 AS expected_amount, x.currency
           FROM income_events e JOIN expected_incomes x ON x.id = e.expected_income_id
          WHERE e.id=$1 FOR UPDATE OF e`,
        [id],
      )
    )[0] as
      | { id: number; status: string; matched_transaction_id: number | null; crypto: boolean; expected_amount: number; currency: string }
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
                status, matched_transaction_id, slot FROM income_events WHERE id=$1`,
        [id],
      )
    )[0];
  }
}
