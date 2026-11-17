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
  type PayableTx,
  type Payment,
  type PaymentKind,
  matchPayment,
  matchTaxPayment,
  matchTaxShare,
  monthlyDueDates,
  monthlyEvents,
} from "../domain/recurring-match";
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
/** Fop income per month: its hryvnia sum and its first row. The caller adds conditions and `GROUP BY 1`. */
const FOP_INCOME_BY_PERIOD = `SELECT to_char(t.local_date,'YYYY-MM') AS period, SUM(t.amount_uah) AS s,
    (array_agg(t.id ORDER BY t.occurred_at, t.id))[1] AS first_id, min(t.occurred_at) AS first_at
  FROM transactions t JOIN accounts a ON a.id = t.account_id
  WHERE a.kind='fop' AND t.type='income' AND t.amount > 0 AND t.amount_uah IS NOT NULL`;

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
    await this.receiveFopEvents(this.ds.manager, null);
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
   * how payments read under an older rule reach their quarter (Б30). Newest first: a row goes to its
   * latest fitting payment. Safe to repeat.
   */
  async linkTaxTransactions(): Promise<void> {
    const rows: { id: number }[] = await this.ds.query(
      `SELECT t.id FROM transactions t
        WHERE t.type='tax' AND t.amount < 0
          AND NOT EXISTS (SELECT 1 FROM scheduled_payments p WHERE p.transaction_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM payment_links l WHERE l.transaction_id = t.id)
          AND EXISTS (SELECT 1 FROM scheduled_payments p WHERE p.kind='tax' AND p.transaction_id IS NULL)
        ORDER BY t.occurred_at DESC, t.id DESC`,
    );
    for (const r of rows) await this.onClassified(r.id, "tax");
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
   * A card credit or cash deposit that is the USDC arriving by another way: see answerBinance. Asking
   * again about a row already matched, or already an own transfer from Binance or the wallet, changes nothing.
   */
  async matchTransaction(eventId: number, transactionId: number): Promise<IncomeEvent> {
    return this.ds.transaction(async (m) => {
      const ev = await this.lockEvent(m, eventId);
      if (ev.source !== "usdc") throw new UnprocessableEntityException("only USDC events can be matched");
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
    if (ev.source !== "usdc") throw new UnprocessableEntityException("only USDC events can be matched");
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
      // Tax rows stay candidates after the owner marked them paid: they can still claim their bank row.
      const open: Payment[] = await m.query(
        `SELECT p.id, p.kind, p.name, p.amount::float8 AS amount, p.currency, p.due_on::text AS due_on, p.paid_at,
                p.transaction_id, p.match_hint, p.tax_quarter, p.is_estimate,
                (SELECT COALESCE(SUM(-COALESCE(x.amount_uah, x.amount)), 0) FROM payment_links l
                   JOIN transactions x ON x.id = l.transaction_id WHERE l.payment_id = p.id)::float8 AS linked
           FROM scheduled_payments p WHERE p.transaction_id IS NULL AND (p.paid_at IS NULL OR p.kind='tax')
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
    const share = matchTaxShare(tx, open, others);
    if (!share) return;
    if (share.release) await m.query(`DELETE FROM payment_links WHERE payment_id=$1`, [share.payment.id]);
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
    const rows: { id: number; kind: PaymentKind; amount: number; is_estimate: boolean; paid: boolean; closed_by_links: boolean; linked: number }[] =
      await m.query(
        `SELECT p.id, p.kind, p.amount::float8 AS amount, p.is_estimate, p.paid_at IS NOT NULL AS paid, p.closed_by_links,
                (SELECT COALESCE(SUM(-COALESCE(x.amount_uah, x.amount)), 0) FROM payment_links l
                   JOIN transactions x ON x.id = l.transaction_id WHERE l.payment_id = p.id)::float8 AS linked
           FROM scheduled_payments p WHERE p.id = ANY($1::int[]) ORDER BY p.id FOR UPDATE OF p`,
        [[...new Set(paymentIds)]],
      );
    const reopen = rows
      .filter((r) => reopensOnUnlink({ kind: r.kind, amount: r.amount, isEstimate: r.is_estimate, paid: r.paid, closedByLinks: r.closed_by_links }, r.linked))
      .map((r) => r.id);
    if (reopen.length === 0) return false;
    await m.query(`UPDATE scheduled_payments SET paid_at = NULL, closed_by_links = false WHERE id = ANY($1::int[])`, [reopen]);
    return true;
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
   */
  private async markFopEvents(m: EntityManager, t: TxRow): Promise<void> {
    const period = t.local_date.slice(0, 7);
    await this.receiveFopEvents(m, period);
    await m.query(
      `WITH inc AS (${FOP_INCOME_BY_PERIOD} AND to_char(t.local_date,'YYYY-MM')=$1 GROUP BY 1)
       UPDATE income_events e SET amount_uah = inc.s FROM inc, expected_incomes x
        WHERE x.id = e.expected_income_id AND x.source='fop' AND e.period = inc.period AND e.status = 'received'
          AND e.matched_transaction_id IS NOT NULL AND e.amount_uah IS DISTINCT FROM inc.s`,
      [period],
    );
  }

  /**
   * Fop events still expected in a month that already has fop income are received, dated by its first income.
   * One month, or every month (the hourly job: events the old half-the-amount rule left waiting). Safe to repeat;
   * a received event is never re-dated. Like any bank credit it leaves the day's fixed limit alone.
   */
  private async receiveFopEvents(m: EntityManager, period: string | null): Promise<void> {
    await m.query(
      `WITH inc AS (${FOP_INCOME_BY_PERIOD} AND ($1::text IS NULL OR to_char(t.local_date,'YYYY-MM')=$1) GROUP BY 1)
       UPDATE income_events e SET status='received', received_at = inc.first_at, amount_uah = inc.s, matched_transaction_id = inc.first_id
         FROM inc, expected_incomes x
        WHERE x.id = e.expected_income_id AND x.source='fop' AND e.period = inc.period AND e.status <> 'received'`,
      [period],
    );
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
