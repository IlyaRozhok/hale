import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  CashCardAnswer,
  CashCountInput,
  CashDepositAnswerName,
  CashOperationInput,
  CashOperationKind,
  CashOperationPatch,
  CashStartInput,
  CashWalletDto,
  PaymentLinksDto,
  TransactionDto,
} from "@hale/contracts";
import { randomUUID } from "node:crypto";
import { DataSource, type EntityManager } from "typeorm";
import { isAnswerableDeposit } from "../domain/cash-answer";
import { kyivDate } from "../domain/money";
import { paymentCover } from "../domain/payment-cover";
import { PlanService } from "../plan/plan.service";
import { Clock, kyivInstantSql } from "../time/clock";
import { LimitService } from "../today/limit.service";
import { TransactionsService } from "../transactions/transactions.service";
import { counterKeySql } from "../transactions/counter-key";
import { paymentUah } from "../domain/recurring-match";
import { latestRates, linkedSum, paymentCandidateIds } from "./candidates";
import { answerOther, answerWallet, binanceEvent, lockAnswer, undoAnswer } from "./cash-answer";
import { exchangeOf, takeExchange, undoExchange } from "./cash-exchange";
import { CASH_ACCOUNT_ID, cardTransferSql, walletBalance } from "./wallet";

const DEFAULT_NOTE: Record<CashOperationKind, string> = {
  spend: "Покупка наличными",
  received: "Получил наличные",
  own_out: "Отдал в свои",
  exchange: "Обмен USDC на наличные",
};
/** An exchange is an own transfer like own_out; cash_exchanges tells them apart (task Б22). */
const TYPE: Record<CashOperationKind, string> = { spend: "spend", received: "person_in", own_out: "own_transfer", exchange: "own_transfer" };
const KIND_OF_TYPE: Record<string, CashOperationKind> = { spend: "spend", person_in: "received", own_transfer: "own_out" };
const CATEGORY_OF: Record<Exclude<CashOperationKind, "spend">, string> = { received: "cash", own_out: "own", exchange: "own" };

/** A row on the wallet: `amount` is signed, as it changes the wallet. */
interface Row {
  type: string;
  amount: number;
  category: string;
  date: string;
  note: string;
}

/** received and an exchange add to the wallet; a purchase and own_out take from it. */
const signed = (kind: CashOperationKind, amount: number) => (kind === "received" || kind === "exchange" ? amount : -amount);

/**
 * The opening balance and a count that found more («Сверка: больше, чем записано»): an own transfer into the
 * wallet that is no exchange. It corrects the balance and is no operation of any kind, so it keeps its kind and
 * its plus sign when changed.
 */
const isCorrection = (row: { type: string; amount: number }, exchange: boolean) => row.type === "own_transfer" && row.amount > 0 && !exchange;

/** The cash wallet: its start, operations entered by hand, counting the pocket, and deposits from it. */
@Injectable()
export class CashService {
  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(TransactionsService) private readonly tx: TransactionsService,
    @Inject(LimitService) private readonly limit: LimitService,
    @Inject(PlanService) private readonly plan: PlanService,
  ) {}

  async wallet(m: EntityManager = this.ds.manager): Promise<CashWalletDto> {
    const w = await walletBalance(m);
    return { started: w.start !== null, start: w.start, balance: w.balance };
  }

  /**
   * Starts once. The day gets a fresh limit: the wallet is new own money.
   * Started today, it starts now: the opening balance already holds cash withdrawn earlier today, so that
   * withdrawal does not go into the wallet again (Б39). Started on an earlier day, it starts at that day's
   * beginning: the balance is what the owner had that day, and no time is guessed.
   */
  async start(p: CashStartInput): Promise<CashWalletDto> {
    const now = this.clock.now();
    const today = kyivDate(now);
    const date = p.date ?? today;
    if (date > today) throw new UnprocessableEntityException("the start cannot be in the future");
    return this.ds.transaction(async (m) => {
      const s = (await m.query(`SELECT cash_start FROM settings WHERE id=1 FOR UPDATE`))[0] as { cash_start: string | null };
      if (s.cash_start !== null) throw new ConflictException("the wallet is already started");
      await m.query(
        `UPDATE settings SET cash_start=$1,
                cash_started_at = CASE WHEN $3 THEN $2::timestamptz ELSE ${kyivInstantSql("$1::date::timestamp")} END
          WHERE id=1`,
        [date, now.toISOString(), date === today],
      );
      const account = await this.account(m);
      if (p.amount > 0) await this.insert(m, account, { type: "own_transfer", amount: p.amount, category: "own", date, note: "Начальный остаток" });
      await this.limit.invalidate("cash", m);
      return this.wallet(m);
    });
  }

  /**
   * An exchange (task Б22) also takes its dollars off Binance and, unlike the other operations, whose cash
   * changes the limit from tomorrow, fixes the day afresh at once, as a Binance balance edit does.
   */
  async add(p: CashOperationInput): Promise<TransactionDto> {
    const date = this.checkDate(p.date);
    const id = await this.ds.transaction(async (m) => {
      const account = await this.startedAccount(m);
      const id = await this.insert(m, account, {
        type: TYPE[p.kind],
        amount: signed(p.kind, p.amount),
        category: p.kind === "spend" ? p.category! : CATEGORY_OF[p.kind],
        date,
        note: p.note || DEFAULT_NOTE[p.kind],
      });
      if (p.kind === "exchange") {
        await takeExchange(m, id, p.usdc!);
        await this.limit.invalidate("binance", m);
      }
      return id;
    });
    return this.tx.one(id);
  }

  /**
   * An exchange given other dollars, or turned into another kind and back, gives Binance back what it took
   * first; one whose dollars stay the same leaves Binance alone.
   */
  async change(id: number, p: CashOperationPatch): Promise<TransactionDto> {
    await this.ds.transaction(async (m) => {
      const row = await this.manualRow(m, id);
      if (row.type === "obligation") throw new ConflictException("a planned payment is deleted, not changed");
      const was = await exchangeOf(m, id);
      if (isCorrection(row, was !== null)) {
        // Read as own_out it would be saved negative, and the wallet would lose twice the amount.
        if (p.kind !== undefined || p.usdc !== undefined) throw new UnprocessableEntityException("a correction of the wallet keeps its kind");
        await this.update(m, id, {
          type: row.type,
          amount: p.amount ?? row.amount,
          category: row.category ?? CATEGORY_OF.own_out,
          date: p.date === undefined ? row.local_date : this.checkDate(p.date),
          note: p.note || row.description,
        });
        return;
      }
      const kind = p.kind ?? (was ? "exchange" : (KIND_OF_TYPE[row.type] ?? "own_out"));
      if (p.usdc !== undefined && kind !== "exchange") throw new UnprocessableEntityException("usdc is only for an exchange");
      const usdc = kind === "exchange" ? (p.usdc ?? was?.usdc) : undefined;
      if (kind === "exchange" && usdc === undefined) throw new UnprocessableEntityException("an exchange needs usdc");
      const category = kind === "spend" ? (p.category ?? (row.type === "spend" ? row.category : null)) : CATEGORY_OF[kind];
      if (!category) throw new UnprocessableEntityException("a purchase needs a category");
      const op: Row = {
        type: TYPE[kind],
        amount: signed(kind, p.amount ?? Math.abs(row.amount)),
        category,
        date: p.date === undefined ? row.local_date : this.checkDate(p.date),
        note: p.note === undefined ? row.description : p.note || DEFAULT_NOTE[kind],
      };
      await this.update(m, id, op);
      if (was || kind === "exchange") {
        // The same dollars keep what they took: taken again, an exchange Binance could not cover in full would
        // take the rest from money that came to Binance since.
        if (!(was && kind === "exchange" && usdc === was.usdc)) {
          await undoExchange(m, id);
          if (kind === "exchange") await takeExchange(m, id, usdc!);
        }
        await this.limit.invalidate("binance", m);
      }
    });
    return this.tx.one(id);
  }

  async remove(id: number): Promise<{ deleted: true }> {
    await this.ds.transaction(async (m) => {
      await this.manualRow(m, id);
      // An exchange gives Binance back exactly what it took (task Б22).
      const exchanged = await undoExchange(m, id);
      // A planned payment paid with this row is unpaid again, and back in the day's limit at once.
      const reopened = (await m.query(`UPDATE scheduled_payments SET paid_at=NULL WHERE transaction_id=$1`, [id])) as [unknown[], number];
      // One it helped pay through payment_links loses it with the row (ON DELETE CASCADE), and opens again
      // when the rest no longer cover it (task Б26).
      const linked: { payment_id: number }[] = await m.query(`SELECT payment_id FROM payment_links WHERE transaction_id=$1`, [id]);
      await m.query(`DELETE FROM transactions WHERE id=$1`, [id]);
      const uncovered = await this.plan.reopenUncovered(m, linked.map((l) => l.payment_id));
      if (exchanged) await this.limit.invalidate("binance", m);
      else if (reopened[1] > 0 || uncovered) await this.limit.invalidate("payment_paid", m);
    });
    return { deleted: true };
  }

  /**
   * What is in the pocket: less is spent today as not recorded, more just corrects the balance.
   * Every count, one that finds no difference too, is remembered by its moment (settings.cash_counted_at), and the
   * row it writes keeps in `raw` its own moment and the one of the count before it (task Б40): an answer «Из
   * кошелька» given later finds by them the first count after its deposit, whatever the row's note becomes.
   */
  async count(p: CashCountInput): Promise<CashWalletDto> {
    return this.ds.transaction(async (m) => {
      const account = await this.startedAccount(m);
      const prev = (await m.query(`SELECT COALESCE(cash_counted_at, cash_started_at) AS at FROM settings WHERE id=1 FOR UPDATE`))[0] as {
        at: Date | null;
      };
      const { balance } = await walletBalance(m);
      const diff = p.amount - balance;
      const date = this.today();
      const now = this.clock.now();
      // The deposits since the start that did not lower the wallet when the pocket was counted: only these can be
      // what the count found missing (review round 1: one answered «Из кошелька» before it was already recorded).
      const open = (
        await m.query(
          `SELECT COALESCE(jsonb_agg(t.id ORDER BY t.id), '[]') AS ids FROM transactions t JOIN accounts a ON a.id = t.account_id
            WHERE a.kind NOT IN ('cash','jar') AND t.amount > 0 AND NOT t.from_wallet
              AND t.local_date >= (SELECT cash_start FROM settings WHERE id=1)
              AND (t.type = 'cash_in' OR EXISTS (SELECT 1 FROM cash_answers c WHERE c.transaction_id = t.id))`,
        )
      )[0] as { ids: number[] };
      const raw = (kind: "short" | "more") => ({ cash_count: kind, at: now.toISOString(), after: prev.at?.toISOString() ?? null, open: open.ids });
      if (diff < 0) await this.insert(m, account, { type: "spend", amount: diff, category: "uncategorized", date, note: "Не записано" }, raw("short"));
      if (diff > 0) {
        await this.insert(m, account, { type: "own_transfer", amount: diff, category: "own", date, note: "Сверка: больше, чем записано" }, raw("more"));
      }
      await m.query(`UPDATE settings SET cash_counted_at=$1 WHERE id=1`, [now.toISOString()]);
      return this.wallet(m);
    });
  }

  /**
   * A planned payment paid in cash: closed and linked to a wallet row of its own type, which is not
   * spending against the limit. Only when the recorded cash covers it: the wallet never goes below zero.
   */
  async payPlanned(id: number): Promise<CashWalletDto> {
    return this.ds.transaction(async (m) => {
      const p = (
        await m.query(`SELECT name, amount::float8 AS amount, currency, paid_at FROM scheduled_payments WHERE id=$1 FOR UPDATE`, [id])
      )[0] as { name: string; amount: number; currency: string; paid_at: Date | null } | undefined;
      if (!p) throw new NotFoundException("payment not found");
      if (p.paid_at !== null) throw new ConflictException("the payment is already paid");
      // Its parts are paid already: the whole amount from the wallet on top would pay it twice (task Б9).
      if ((await linkedSum(m, id)) > 0) throw new ConflictException("the payment is partly paid by operations");
      const account = await this.startedAccount(m);
      if (p.currency !== "UAH") throw new UnprocessableEntityException("only a payment in hryvnias can be paid in cash");
      const { balance } = await walletBalance(m);
      if (balance < p.amount) throw new UnprocessableEntityException("the wallet has less cash than the payment");
      const tx = await this.insert(m, account, { type: "obligation", amount: -p.amount, category: "transfer", date: this.today(), note: p.name });
      await m.query(`UPDATE scheduled_payments SET paid_at=now(), transaction_id=$2 WHERE id=$1`, [id, tx]);
      await this.limit.invalidate("payment_paid", m);
      return this.wallet(m);
    });
  }

  /**
   * A cash deposit at a terminal paid from the wallet: an own transfer that lowers the wallet. Asked again, nothing changes.
   * When the answer takes the deposit off a count's «Не записано» (Б40), spending changed, and the day is fixed afresh
   * as an answer from the operation's card does.
   */
  async fromWallet(id: number): Promise<CashWalletDto> {
    return this.ds.transaction(async (m) => {
      await this.startedAccount(m);
      const t = (await m.query(`SELECT type, amount::float8 AS amount, from_wallet FROM transactions WHERE id=$1 FOR UPDATE`, [id]))[0] as
        | { type: string | null; amount: number; from_wallet: boolean }
        | undefined;
      if (!t) throw new NotFoundException("transaction not found");
      if (t.from_wallet) return this.wallet(m);
      if (t.type !== "cash_in" || t.amount <= 0) throw new UnprocessableEntityException("only a cash deposit can come from the wallet");
      if ((await answerWallet(m, id)) > 0) await this.limit.invalidate("cash", m);
      return this.wallet(m);
    });
  }

  /**
   * A new answer to «Откуда наличные?» from the operation's card (task Б21): the earlier answer is undone
   * first (see undoAnswer), then the new one acts as it does from the question. The same answer again
   * changes nothing. «Вывод с Binance» is matched to the latest received USDC income.
   */
  async changeDepositAnswer(id: number, answer: CashDepositAnswerName): Promise<TransactionDto> {
    await this.ds.transaction(async (m) => {
      await this.startedAccount(m);
      const a = await lockAnswer(m, id);
      if (!a) throw new NotFoundException("transaction not found");
      if (!isAnswerableDeposit(a.facts)) throw new UnprocessableEntityException("only a cash deposit since the wallet start");
      if (a.current?.answer === answer) return;
      const event = answer === "binance" ? await binanceEvent(m) : null;
      if (answer === "binance" && event === null) throw new UnprocessableEntityException("no received USDC income to match");
      await undoAnswer(m, id);
      if (answer === "wallet") await answerWallet(m, id);
      if (answer === "binance") await this.plan.answerBinance(m, event!, id);
      if (answer === "other") await answerOther(m, id);
      await this.limit.invalidate("cash", m);
    });
    return this.tx.one(id);
  }

  /**
   * "Снял наличными?" about a transfer to the owner's card at another bank. The answer is kept for
   * the card: yes (also part) lets later transfers to it fill the wallet, no stops the question.
   */
  async answerCard(id: number, a: CashCardAnswer): Promise<CashWalletDto> {
    return this.ds.transaction(async (m) => {
      const t = await this.cardTransfer(m, id);
      if (a.answer === "part" && (a.amount === undefined || a.amount > t.full)) {
        throw new UnprocessableEntityException("part needs the amount taken, no more than the transfer");
      }
      await m.query(
        `INSERT INTO cash_cards (counter_key, withdraws) VALUES ($1, $2) ON CONFLICT (counter_key) DO UPDATE SET withdraws = EXCLUDED.withdraws`,
        [t.key, a.answer !== "no"],
      );
      await m.query(`UPDATE transactions SET cash_amount=$2 WHERE id=$1`, [id, a.answer === "part" ? a.amount : null]);
      return this.wallet(m);
    });
  }

  /** How much of this one transfer was taken out as cash; the card's answer stays. */
  async setCardCash(id: number, amount: number): Promise<CashWalletDto> {
    return this.ds.transaction(async (m) => {
      const t = await this.cardTransfer(m, id);
      if (amount > t.full) throw new UnprocessableEntityException("no more than the transfer");
      await m.query(`UPDATE transactions SET cash_amount=$2 WHERE id=$1`, [id, amount]);
      return this.wallet(m);
    });
  }

  private async cardTransfer(m: EntityManager, id: number): Promise<{ key: string; full: number }> {
    const r = (
      await m.query(
        `SELECT ${counterKeySql("t")} AS key, -t.amount_uah::float8 AS full, ${cardTransferSql()} AS ok
           FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id=$1`,
        [id],
      )
    )[0] as { key: string; full: number | null; ok: boolean | null } | undefined;
    if (!r) throw new NotFoundException("transaction not found");
    if (!r.ok || r.full === null) throw new UnprocessableEntityException("only a transfer to the owner's card at another bank");
    return { key: r.key, full: r.full };
  }

  /** Operations that could have paid this payment, newest first: see candidateIds. */
  async candidates(paymentId: number): Promise<TransactionDto[]> {
    const ids = await this.candidateIds(this.ds.manager, paymentId);
    return Promise.all(ids.map((id) => this.tx.one(id)));
  }

  /**
   * The owner says these operations paid the payment. They become it: obligation, so the limit is
   * not spent twice, and the owner's, so the classifier leaves them. A withdrawal after the wallet
   * start then passes the wallet by: its cash went straight to the payment.
   *
   * The payment closes only when all operations linked to it, earlier ones too, cover its amount
   * (paymentCover, task Б9). Until then it stays open and keeps its whole amount reserved, as a tax
   * paid in parts does (task Б24): the limit is lower for a while, never higher. More operations can
   * be added later the same way, or the payment closed by hand with «Оплачено».
   */
  async payWith(paymentId: number, ids: readonly number[]): Promise<PaymentLinksDto> {
    return this.ds.transaction(async (m) => {
      const p = (
        await m.query(`SELECT amount::float8 AS amount, currency, paid_at FROM scheduled_payments WHERE id=$1 FOR UPDATE`, [paymentId])
      )[0] as { amount: number; currency: string; paid_at: Date | null } | undefined;
      if (!p) throw new NotFoundException("payment not found");
      if (p.paid_at !== null) throw new ConflictException("the payment is already paid");
      const offered = new Set(await this.candidateIds(m, paymentId));
      const chosen = [...new Set(ids)];
      if (chosen.some((id) => !offered.has(id))) throw new UnprocessableEntityException("only an offered operation can pay the payment");
      await m.query(`INSERT INTO payment_links (payment_id, transaction_id) SELECT $1, unnest($2::int[])`, [paymentId, chosen]);
      await m.query(
        `UPDATE transactions SET type='obligation', category='transfer', type_source='owner', needs_label=false WHERE id = ANY($1::int[])`,
        [chosen],
      );
      // The linked sum is in hryvnias: a foreign payment is compared at the latest rate (task Б44). It has one,
      // or no operation would have been offered for it.
      const amount = paymentUah(p, await latestRates(m));
      if (amount === null) throw new UnprocessableEntityException("no rate for the payment's currency");
      const cover = paymentCover(amount, await linkedSum(m, paymentId));
      if (cover.closed) {
        // Closed by its links: it opens again if it loses one and the rest no longer cover it (task Б26).
        await m.query(
          `UPDATE scheduled_payments SET closed_by_links = true,
                  paid_at = (SELECT max(t.occurred_at) FROM payment_links l JOIN transactions t ON t.id = l.transaction_id
                              WHERE l.payment_id = $1) WHERE id=$1`,
          [paymentId],
        );
      }
      // The rows changed type even when the payment stays open: the day is fixed afresh either way.
      await this.limit.invalidate("payment_paid", m);
      return { linked: chosen.length, closed: cover.closed, remaining: cover.remaining };
    });
  }

  /** See paymentCandidateIds: the same rule asks «Это оплата?» on the home screen. */
  private candidateIds(m: EntityManager, paymentId: number): Promise<number[]> {
    return paymentCandidateIds(m, paymentId, this.today());
  }

  // --- helpers -------------------------------------------------------------------
  private today(): string {
    return kyivDate(this.clock.now());
  }

  private checkDate(date: string | undefined): string {
    const today = this.today();
    if (date === undefined) return today;
    if (date > today) throw new UnprocessableEntityException("the date cannot be in the future");
    return date;
  }

  /** Today keeps the moment of entry, so the list shows it on top; an earlier day sits at its noon. */
  private occurredSql(dateArg: string): string {
    return kyivInstantSql(`(${dateArg}::date + time '12:00')`);
  }

  private async insert(m: EntityManager, account: number, op: Row, raw: object = {}): Promise<number> {
    const now = this.clock.now();
    const today = this.today() === op.date;
    const r = await m.query(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, category,
                                 type_source, usdc_checked, needs_label, raw)
       VALUES ($1,$2, CASE WHEN $9 THEN $3::timestamptz ELSE ${this.occurredSql("$4")} END, $4, $5, $6, $6, $7, $8, 'owner', true, false, $10::jsonb)
       RETURNING id`,
      [`manual:${randomUUID()}`, account, now.toISOString(), op.date, op.note, op.amount, op.type, op.category, today, JSON.stringify(raw)],
    );
    return (r[0] as { id: number }).id;
  }

  private async update(m: EntityManager, id: number, op: Row): Promise<void> {
    await m.query(
      `UPDATE transactions SET type=$2, category=$3, amount=$4, amount_uah=$4, local_date=$5, description=$6,
              occurred_at = CASE WHEN local_date = $5::date THEN occurred_at ELSE ${this.occurredSql("$5")} END
        WHERE id=$1`,
      [id, op.type, op.category, op.amount, op.date, op.note],
    );
  }

  /** No title: titles are how the classifier recognises the owner's own accounts in bank texts. */
  private async account(m: EntityManager): Promise<number> {
    const r = await m.query(
      `INSERT INTO accounts (external_id, kind, currency, balance) VALUES ($1,'cash','UAH',0)
       ON CONFLICT (external_id) DO UPDATE SET kind='cash' RETURNING id`,
      [CASH_ACCOUNT_ID],
    );
    return (r[0] as { id: number }).id;
  }

  private async startedAccount(m: EntityManager): Promise<number> {
    const s = (await m.query(`SELECT cash_start FROM settings WHERE id=1`))[0] as { cash_start: string | null };
    if (s.cash_start === null) throw new ConflictException("the wallet is not started");
    return this.account(m);
  }

  private async manualRow(m: EntityManager, id: number) {
    const row = (
      await m.query(
        `SELECT t.type, t.category, t.amount::float8 AS amount, t.local_date::text AS local_date, t.description, a.kind
           FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.id=$1 FOR UPDATE OF t`,
        [id],
      )
    )[0] as { type: string; category: string | null; amount: number; local_date: string; description: string; kind: string } | undefined;
    if (!row) throw new NotFoundException("transaction not found");
    if (row.kind !== "cash") throw new ConflictException("only an operation entered by hand can be changed");
    return row;
  }
}
