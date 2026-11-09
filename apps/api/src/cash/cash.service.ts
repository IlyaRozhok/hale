import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  CashCountInput,
  CashOperationInput,
  CashOperationKind,
  CashOperationPatch,
  CashStartInput,
  CashWalletDto,
  TransactionDto,
} from "@hale/contracts";
import { randomUUID } from "node:crypto";
import { DataSource, type EntityManager } from "typeorm";
import { kyivDate } from "../domain/money";
import { Clock } from "../today/clock";
import { TransactionsService } from "../transactions/transactions.service";
import { CASH_ACCOUNT_ID, walletBalance } from "./wallet";

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
      await m.query(`DELETE FROM daily_snapshots WHERE local_date=$1`, [today]);
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
      await m.query(`DELETE FROM transactions WHERE id=$1`, [id]);
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

  /** A cash deposit at a terminal paid from the wallet: an own transfer that lowers the wallet. */
  async fromWallet(id: number): Promise<CashWalletDto> {
    return this.ds.transaction(async (m) => {
      await this.startedAccount(m);
      const t = (await m.query(`SELECT type, amount::float8 AS amount FROM transactions WHERE id=$1 FOR UPDATE`, [id]))[0] as
        | { type: string | null; amount: number }
        | undefined;
      if (!t) throw new NotFoundException("transaction not found");
      if (t.type !== "cash_in" || t.amount <= 0) throw new UnprocessableEntityException("only a cash deposit can come from the wallet");
      await m.query(
        `UPDATE transactions SET type='own_transfer', category='own', type_source='owner', needs_label=false, usdc_checked=true, from_wallet=true WHERE id=$1`,
        [id],
      );
      return this.wallet(m);
    });
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
