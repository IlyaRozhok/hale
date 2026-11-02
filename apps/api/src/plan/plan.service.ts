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
import { type Payment, matchPayment, monthlyDueDates, monthlyEvents } from "../domain/recurring-match";
import type { IncomeEvent, ScheduledPayment } from "../db/entities";

export const BINANCE = "Binance";
const MATCH_DAYS = 3;

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

  constructor(@Inject(DataSource) private readonly ds: DataSource) {}

  /** Catch up after downtime; the unique key makes this safe to repeat. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.generateEvents();
      await this.generateRecurring();
    } catch (e) {
      this.log.warn(`event generation failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  @Cron("0 4 * * *", { timeZone: "Europe/Kyiv" })
  async dailyJob(): Promise<void> {
    await this.generateEvents();
    await this.generateRecurring();
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
    return this.eventView(this.ds.manager, id);
  }

  /**
   * "It arrived": marks the event received and, for USDC, adds the expected amount to the
   * Binance manual balance. A second call changes nothing.
   */
  async confirmEvent(id: number): Promise<IncomeEvent> {
    return this.ds.transaction(async (m) => {
      const ev = await this.lockEvent(m, id);
      if (ev.status !== "received") {
        const balanceDelta = ev.source === "usdc" ? ev.expected_amount : 0;
        await this.markReceived(m, ev, null);
        if (balanceDelta > 0) {
          await m.query(
            `INSERT INTO manual_balances (name, amount, currency, counts_as_own) VALUES ($1,$2,'USD',true)
             ON CONFLICT (name) DO UPDATE SET amount = manual_balances.amount + EXCLUDED.amount`,
            [BINANCE, balanceDelta],
          );
        }
      }
      return this.eventView(m, id);
    });
  }

  /**
   * A card credit or cash deposit that is the USDC arriving by another way: lowers the Binance
   * balance by its hryvnia amount at the current USD rate and retypes the row as an own transfer.
   * An event not yet confirmed is confirmed by this match (the money was never on Binance in the
   * app's books, so the balance is left alone).
   */
  async matchTransaction(eventId: number, transactionId: number): Promise<IncomeEvent> {
    return this.ds.transaction(async (m) => {
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
      if (ev.matched_transaction_id === tx.id) return this.eventView(m, eventId);
      if (ev.matched_transaction_id !== null) throw new ConflictException("event is already matched to another transaction");
      const taken = await m.query(`SELECT 1 FROM income_events WHERE matched_transaction_id=$1`, [tx.id]);
      if (taken.length > 0) throw new ConflictException("transaction is already matched to another event");
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
      await m.query(`UPDATE income_events SET matched_transaction_id=$2 WHERE id=$1`, [eventId, tx.id]);
      await m.query(
        `UPDATE transactions SET type='own_transfer', category='own', type_source='owner', needs_label=false WHERE id=$1`,
        [tx.id],
      );
      return this.eventView(m, eventId);
    });
  }

  /** Manual path: the owner says it was paid. Idempotent. */
  async markPaid(id: number): Promise<ScheduledPayment> {
    await this.ds.query(`UPDATE scheduled_payments SET paid_at = COALESCE(paid_at, now()) WHERE id=$1`, [id]);
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
          `INSERT INTO loans (amount, received_on, source_transaction_id, note)
           SELECT $2, $3, $1, 'loan_in' WHERE NOT EXISTS (SELECT 1 FROM loans WHERE source_transaction_id=$1)
           ON CONFLICT DO NOTHING`,
          [t.id, Math.abs(t.amount_uah ?? t.amount), t.local_date],
        );
      } else if (t.type === "income" && t.account_kind === "fop") {
        await this.markFopEvents(m, t);
      } else if (t.type === "obligation" || t.type === "debt_payment" || t.type === "tax" || t.type === "spend") {
        const linked = await m.query(`SELECT 1 FROM scheduled_payments WHERE transaction_id=$1`, [t.id]);
        if (linked.length > 0) {
          if (t.type === "spend") await this.retypeAsDebt(m, t.id);
          return;
        }
        const open: Payment[] = await m.query(
          `SELECT id, kind, name, amount::float8 AS amount, currency, due_on::text AS due_on, paid_at,
                  transaction_id, match_hint
             FROM scheduled_payments WHERE paid_at IS NULL AND transaction_id IS NULL
            ORDER BY due_on, id FOR UPDATE`,
        );
        if (t.type === "spend" && t.type_source === "owner") return;
        const hit = matchPayment(
          { id: t.id, type: t.type, amount: t.amount, currency: t.currency, amountUah: t.amount_uah, localDate: t.local_date, text: t.text },
          open,
          await this.rates(m),
        );
        if (hit) {
          await m.query(
            `UPDATE scheduled_payments SET paid_at=$2, transaction_id=$3 WHERE id=$1 AND paid_at IS NULL`,
            [hit.id, t.occurred_at, t.id],
          );
          if (t.type === "spend") await this.retypeAsDebt(m, t.id);
        }
      }
    });
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
