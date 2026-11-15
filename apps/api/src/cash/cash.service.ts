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
import { Clock } from "../today/clock";
import { LimitService } from "../today/limit.service";
import { TransactionsService } from "../transactions/transactions.service";
import { counterKeySql } from "../transactions/counter-key";
import { linkedSum, paymentCandidateIds } from "./candidates";
import { answerOther, answerWallet, binanceEvent, lockAnswer, undoAnswer } from "./cash-answer";
import { CASH_ACCOUNT_ID, cardTransferSql, walletBalance } from "./wallet";

const DEFAULT_NOTE: Record<CashOperationKind, string> = {
  spend: "Покупка наличными",
  received: "Получил наличные",
  own_out: "Отдал в свои",
};
const TYPE: Record<CashOperationKind, string> = { spend: "spend", received: "person_in", own_out: "own_transfer" };
const KIND_OF_TYPE: Record<string, CashOperationKind> = { spend: "spend", person_in: "received", own_transfer: "own_out" };
const CATEGORY_OF: Record<Exclude<CashOperationKind, "spend">, string> = { received: "cash", own_out: "own" };

/** A row on the wallet: `amount` is signed, as it changes the wallet. */
interface Row {
  type: string;
  amount: number;
  category: string;
  date: string;
  note: string;
}

/** received adds to the wallet; a purchase and own_out take from it. */
const signed = (kind: CashOperationKind, amount: number) => (kind === "received" ? amount : -amount);

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

  /** Starts once. The day gets a fresh limit: the wallet is new own money. */
  async start(p: CashStartInput): Promise<CashWalletDto> {
    const today = this.today();
    const date = p.date ?? today;
    if (date > today) throw new UnprocessableEntityException("the start cannot be in the future");
    return this.ds.transaction(async (m) => {
      const s = (await m.query(`SELECT cash_start FROM settings WHERE id=1 FOR UPDATE`))[0] as { cash_start: string | null };
      if (s.cash_start !== null) throw new ConflictException("the wallet is already started");
      await m.query(`UPDATE settings SET cash_start=$1 WHERE id=1`, [date]);
      const account = await this.account(m);
      if (p.amount > 0) await this.insert(m, account, { type: "own_transfer", amount: p.amount, category: "own", date, note: "Начальный остаток" });
      await this.limit.invalidate("cash", m);
      return this.wallet(m);
    });
  }

  async add(p: CashOperationInput): Promise<TransactionDto> {
    const date = this.checkDate(p.date);
    const id = await this.ds.transaction(async (m) => {
      const account = await this.startedAccount(m);
      return this.insert(m, account, {
        type: TYPE[p.kind],
        amount: signed(p.kind, p.amount),
        category: p.kind === "spend" ? p.category! : CATEGORY_OF[p.kind],
        date,
        note: p.note || DEFAULT_NOTE[p.kind],
      });
    });
    return this.tx.one(id);
  }

  async change(id: number, p: CashOperationPatch): Promise<TransactionDto> {
    await this.ds.transaction(async (m) => {
      const row = await this.manualRow(m, id);
      if (row.type === "obligation") throw new ConflictException("a planned payment is deleted, not changed");
      const kind = p.kind ?? KIND_OF_TYPE[row.type] ?? "own_out";
      const category = kind === "spend" ? (p.category ?? (row.type === "spend" ? row.category : null)) : CATEGORY_OF[kind];
      if (!category) throw new UnprocessableEntityException("a purchase needs a category");
      const op: Row = {
        type: TYPE[kind],
        amount: signed(kind, p.amount ?? Math.abs(row.amount)),
        category,
        date: p.date === undefined ? row.local_date : this.checkDate(p.date),
        note: p.note === undefined ? row.description : p.note || DEFAULT_NOTE[kind],
      };
      await m.query(
        `UPDATE transactions SET type=$2, category=$3, amount=$4, amount_uah=$4, local_date=$5, description=$6,
                occurred_at = CASE WHEN local_date = $5::date THEN occurred_at ELSE ${this.occurredSql("$5")} END
          WHERE id=$1`,
        [id, op.type, op.category, op.amount, op.date, op.note],
      );
    });
    return this.tx.one(id);
  }

  async remove(id: number): Promise<{ deleted: true }> {
    await this.ds.transaction(async (m) => {
      await this.manualRow(m, id);
      // A planned payment paid with this row is unpaid again, and back in the day's limit at once.
      const reopened = (await m.query(`UPDATE scheduled_payments SET paid_at=NULL WHERE transaction_id=$1`, [id])) as [unknown[], number];
      await m.query(`DELETE FROM transactions WHERE id=$1`, [id]);
      if (reopened[1] > 0) await this.limit.invalidate("payment_paid", m);
    });
    return { deleted: true };
  }

  /** What is in the pocket: less is spent today as not recorded, more just corrects the balance. */
  async count(p: CashCountInput): Promise<CashWalletDto> {
    return this.ds.transaction(async (m) => {
      const account = await this.startedAccount(m);
      const { balance } = await walletBalance(m);
      const diff = p.amount - balance;
      const date = this.today();
      if (diff < 0) await this.insert(m, account, { type: "spend", amount: diff, category: "uncategorized", date, note: "Не записано" });
      if (diff > 0) await this.insert(m, account, { type: "own_transfer", amount: diff, category: "own", date, note: "Сверка: больше, чем записано" });
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

  /** A cash deposit at a terminal paid from the wallet: an own transfer that lowers the wallet. Asked again, nothing changes. */
  async fromWallet(id: number): Promise<CashWalletDto> {
    return this.ds.transaction(async (m) => {
      await this.startedAccount(m);
      const t = (await m.query(`SELECT type, amount::float8 AS amount, from_wallet FROM transactions WHERE id=$1 FOR UPDATE`, [id]))[0] as
        | { type: string | null; amount: number; from_wallet: boolean }
        | undefined;
      if (!t) throw new NotFoundException("transaction not found");
      if (t.from_wallet) return this.wallet(m);
      if (t.type !== "cash_in" || t.amount <= 0) throw new UnprocessableEntityException("only a cash deposit can come from the wallet");
      await answerWallet(m, id);
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
      const p = (await m.query(`SELECT amount::float8 AS amount, paid_at FROM scheduled_payments WHERE id=$1 FOR UPDATE`, [paymentId]))[0] as
        | { amount: number; paid_at: Date | null }
        | undefined;
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
      const cover = paymentCover(p.amount, await linkedSum(m, paymentId));
      if (cover.closed) {
        await m.query(
          `UPDATE scheduled_payments SET paid_at = (SELECT max(t.occurred_at) FROM payment_links l JOIN transactions t ON t.id = l.transaction_id
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
    return `(${dateArg}::date + time '12:00') AT TIME ZONE 'Europe/Kyiv'`;
  }

  private async insert(m: EntityManager, account: number, op: Row): Promise<number> {
    const now = this.clock.now();
    const today = this.today() === op.date;
    const r = await m.query(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, category,
                                 type_source, usdc_checked, needs_label, raw)
       VALUES ($1,$2, CASE WHEN $9 THEN $3::timestamptz ELSE ${this.occurredSql("$4")} END, $4, $5, $6, $6, $7, $8, 'owner', true, false, '{}')
       RETURNING id`,
      [`manual:${randomUUID()}`, account, now.toISOString(), op.date, op.note, op.amount, op.type, op.category, today],
    );
    return (r[0] as { id: number }).id;
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
