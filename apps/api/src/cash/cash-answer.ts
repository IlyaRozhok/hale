import type { EntityManager } from "typeorm";
import { type CashAnswer, type CashAnswerFacts, type CashAnswerName, cashAnswerOf, countAbsorbed } from "../domain/cash-answer";
import { BINANCE } from "../plan/binance";

/**
 * Answers to «Откуда наличные?» (task Б21) are kept with what they did, so that a new answer, or a type
 * changed by hand, undoes exactly that. Everything here runs in the caller's transaction; the caller
 * fixes the day's limit afresh.
 */

/** The row as an answer found it: undoing the answer puts it back. */
interface RowBefore {
  type: string | null;
  category: string | null;
  type_source: string | null;
  needs_label: boolean;
  usdc_checked: boolean;
}

/** A row of cash_answers, as row_to_json gives it. */
interface StoredAnswer {
  answer: CashAnswerName;
  binance_cents: number;
  income_event_id: number | null;
  event_status_before: string | null;
  type_before: string | null;
  category_before: string | null;
  type_source_before: string | null;
  needs_label_before: boolean;
  usdc_checked_before: boolean;
  /** Б40: the count row whose shortfall a «Из кошелька» answer took the deposit off, and by how many kopecks. */
  count_transaction_id: number | null;
  count_absorbed: number | string;
  /** The count row as it was, when the answer took off all of it and deleted it. */
  count_row: Record<string, unknown> | null;
}

/** What a «Из кошелька» answer took off a count's shortfall (task Б40). */
interface CountAbsorbed {
  transactionId: number;
  cents: number;
  /** The whole row, when the answer deleted it. */
  row: Record<string, unknown> | null;
}

/** SQL columns over `t` (transactions) that, with its type, amount, text, day and account, make CashAnswerFacts. */
export const cashAnswerColumnsSql = (t = "t"): string =>
  `${t}.from_wallet, ${t}.usdc_checked, ${t}.mcc, (SELECT s.cash_start::text FROM settings s WHERE s.id = 1) AS cash_start,
   EXISTS (SELECT 1 FROM income_events e WHERE e.matched_transaction_id = ${t}.id) AS income_matched,
   (SELECT row_to_json(c) FROM cash_answers c WHERE c.transaction_id = ${t}.id) AS cash_answer`;

export interface CashAnswerRow {
  type: string | null;
  amount: number;
  mcc: number | null;
  description: string;
  account_kind: string;
  local_date: string;
  cash_start: string | null;
  from_wallet: boolean;
  usdc_checked: boolean;
  income_matched: boolean;
  cash_answer: StoredAnswer | null;
}

export const cashAnswerFacts = (r: CashAnswerRow): CashAnswerFacts => ({
  type: r.type,
  amount: r.amount,
  mcc: r.mcc,
  description: r.description,
  accountKind: r.account_kind,
  localDate: r.local_date,
  cashStart: r.cash_start,
  fromWallet: r.from_wallet,
  usdcChecked: r.usdc_checked,
  incomeMatched: r.income_matched,
  stored: r.cash_answer
    ? { answer: r.cash_answer.answer, typeBefore: r.cash_answer.type_before, binanceCents: Number(r.cash_answer.binance_cents) }
    : null,
});

/** Locks the row and reads its answer: the kept one, or one given before answers were kept. Null: no such row. */
export async function lockAnswer(
  m: EntityManager,
  id: number,
): Promise<{ facts: CashAnswerFacts; stored: StoredAnswer | null; current: CashAnswer | null } | null> {
  const r = (
    await m.query(
      `SELECT t.type, t.amount::float8 AS amount, t.description, t.local_date::text AS local_date, a.kind AS account_kind, ${cashAnswerColumnsSql("t")}
         FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id = $1 FOR UPDATE OF t`,
      [id],
    )
  )[0] as CashAnswerRow | undefined;
  if (!r) return null;
  const facts = cashAnswerFacts(r);
  return { facts, stored: r.cash_answer, current: cashAnswerOf(facts) };
}

/** The latest received USDC income, which «Вывод с Binance» is matched to; null without one or without a dollar rate. */
export async function binanceEvent(m: EntityManager): Promise<number | null> {
  const r = (
    await m.query(
      `SELECT e.id FROM income_events e JOIN expected_incomes x ON x.id = e.expected_income_id
        WHERE x.crypto AND e.status = 'received'
          AND (SELECT rate FROM fx_rates WHERE currency = 'USD' ORDER BY fetched_at DESC LIMIT 1) > 0
        ORDER BY e.received_at DESC NULLS LAST, e.id DESC LIMIT 1`,
    )
  )[0] as { id: number } | undefined;
  return r?.id ?? null;
}

/** The row as it is now, for the answer about to change it. */
export async function rowBefore(m: EntityManager, id: number): Promise<RowBefore> {
  return (
    await m.query(`SELECT type, category, type_source, needs_label, usdc_checked FROM transactions WHERE id = $1`, [id])
  )[0] as RowBefore;
}

/** Keeps an answer, the row as it found it, and what it did to Binance and to an income. */
export async function keepAnswer(
  m: EntityManager,
  id: number,
  answer: CashAnswerName,
  before: RowBefore,
  did: { binanceCents?: number; eventId?: number; eventStatusBefore?: string | null; count?: CountAbsorbed | null } = {},
): Promise<void> {
  await m.query(
    `INSERT INTO cash_answers (transaction_id, answer, binance_cents, income_event_id, event_status_before,
                               type_before, category_before, type_source_before, needs_label_before, usdc_checked_before,
                               count_transaction_id, count_absorbed, count_row)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id, answer, did.binanceCents ?? 0, did.eventId ?? null, did.eventStatusBefore ?? null,
      before.type, before.category, before.type_source, before.needs_label, before.usdc_checked,
      did.count?.transactionId ?? null, did.count?.cents ?? 0, did.count?.row ? JSON.stringify(did.count.row) : null,
    ],
  );
}

/**
 * Task Б40. A deposit not answered yet does not lower the wallet, so a count of the pocket made after it found the
 * deposited cash missing and wrote it off as «Не записано». Answered «Из кошелька», the deposit lowers the wallet
 * itself: it takes its amount off the shortfall of the first count after it, never more than either (countAbsorbed),
 * and deletes the row when nothing is left of it. Only the first count after the deposit: later ones were made
 * against a wallet that already held that discrepancy. And only when the deposit was still not lowering the wallet
 * at that count (it is in the row's `open` list): one answered «Из кошелька» before the count was already recorded,
 * and that count's shortfall is real spending. A count row is known by the marker `count` writes into its `raw`
 * (the moment of the count and of the count before it, the open deposits), not by its note, which the owner can
 * change; rows written before the marker are never touched. A row the owner retyped away from spending, or one
 * anything else points at (a payment, a loan, an income), is left alone: deleting it would drop those links.
 */
async function absorbCount(m: EntityManager, depositId: number): Promise<CountAbsorbed | null> {
  const c = (
    await m.query(
      `SELECT c.id, -c.amount::float8 AS short, d.amount_uah::float8 AS deposit
         FROM transactions d, transactions c JOIN accounts a ON a.id = c.account_id
        WHERE d.id = $1 AND a.kind = 'cash' AND c.raw->>'cash_count' = 'short' AND c.type = 'spend' AND c.amount < 0
          AND (c.raw->>'at')::timestamptz > d.occurred_at
          AND COALESCE((c.raw->>'after')::timestamptz, '-infinity') <= d.occurred_at
          AND c.raw->'open' @> jsonb_build_array(d.id)
          AND NOT EXISTS (SELECT 1 FROM payment_links l WHERE l.transaction_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM payment_dismissals pd WHERE pd.transaction_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM scheduled_payments sp WHERE sp.transaction_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM loans lo WHERE lo.source_transaction_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM loan_repayments lr WHERE lr.transaction_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM income_events e WHERE e.matched_transaction_id = c.id)
        ORDER BY (c.raw->>'at')::timestamptz LIMIT 1 FOR UPDATE OF c`,
      [depositId],
    )
  )[0] as { id: number; short: number; deposit: number | null } | undefined;
  if (!c) return null;
  const cents = countAbsorbed(c.deposit ?? 0, c.short);
  if (cents === 0) return null;
  if (cents < c.short) {
    await m.query(`UPDATE transactions SET amount = amount + $2, amount_uah = amount_uah + $2 WHERE id = $1`, [c.id, cents]);
    return { transactionId: c.id, cents, row: null };
  }
  const row = (await m.query(`SELECT to_jsonb(t) AS row FROM transactions t WHERE t.id = $1`, [c.id]))[0].row as Record<string, unknown>;
  await m.query(`DELETE FROM transactions WHERE id = $1`, [c.id]);
  return { transactionId: c.id, cents, row };
}

/**
 * Gives a count row back the kopecks an answer took off it (Б40). Deleted by an answer (this one, or another
 * deposit's before the same count), it comes back with its id and everything else, holding just these kopecks;
 * the kept copies are then dropped, so a row the owner deletes later stays deleted. A row the owner deleted is
 * not brought back. One the owner changed after the answer (a new amount, kind or category) still gets these
 * kopecks back as they are: the undo gives back exactly what the answer took.
 */
async function giveBackCount(m: EntityManager, countId: number, cents: number): Promise<void> {
  const updated = (await m.query(`UPDATE transactions SET amount = amount - $2, amount_uah = amount_uah - $2 WHERE id = $1`, [
    countId,
    cents,
  ])) as [unknown[], number];
  if (updated[1] > 0) return;
  const kept = (
    await m.query(`SELECT count_row FROM cash_answers WHERE count_transaction_id = $1 AND count_row IS NOT NULL LIMIT 1`, [countId])
  )[0] as { count_row: Record<string, unknown> } | undefined;
  if (!kept) return;
  await m.query(
    `INSERT INTO transactions
     SELECT * FROM jsonb_populate_record(NULL::transactions, $1::jsonb || jsonb_build_object('amount', -$2::bigint, 'amount_uah', -$2::bigint))`,
    [JSON.stringify(kept.count_row), cents],
  );
  await m.query(`UPDATE cash_answers SET count_row = NULL WHERE count_transaction_id = $1`, [countId]);
}

/**
 * «Из кошелька»: an own transfer that lowers the wallet. The row must be an unanswered cash deposit. A count made
 * after the deposit gives up what it wrote off for it (see absorbCount). The kopecks taken off spending, 0 for none.
 */
export async function answerWallet(m: EntityManager, id: number): Promise<number> {
  await undoAnswer(m, id);
  const before = await rowBefore(m, id);
  await m.query(
    `UPDATE transactions SET type='own_transfer', category='own', type_source='owner', needs_label=false, usdc_checked=true, from_wallet=true WHERE id=$1`,
    [id],
  );
  const count = await absorbCount(m, id);
  await keepAnswer(m, id, "wallet", before, { count });
  return count?.cents ?? 0;
}

/** «Другое» (or «Нет» to «Это вывод с Binance?»): the row stays as it is and is not asked about again. */
export async function answerOther(m: EntityManager, id: number): Promise<void> {
  await undoAnswer(m, id);
  const before = await rowBefore(m, id);
  await m.query(`UPDATE transactions SET usdc_checked=true WHERE id=$1`, [id]);
  await keepAnswer(m, id, "other", before);
}

/**
 * Undoes the row's answer. A kept one exactly: the wallet no longer pays the deposit, Binance gets back
 * the cents it took, the income loses this row and, if this answer marked it received, its earlier
 * status; a count gets back the shortfall the answer took off it (Б40); the row is put back as it was. One given before answers were kept, as far as the row tells:
 * Binance is left alone, since what it took is not known. True when there was an answer.
 */
export async function undoAnswer(m: EntityManager, id: number): Promise<boolean> {
  const a = await lockAnswer(m, id);
  if (!a) return false;
  const s = a.stored;
  if (s) {
    if (s.answer === "binance") {
      const cents = Number(s.binance_cents);
      if (cents !== 0) await m.query(`UPDATE manual_balances SET amount = amount + $2 WHERE name=$1`, [BINANCE, cents]);
      if (s.income_event_id !== null && s.event_status_before !== null) {
        await m.query(
          `UPDATE income_events SET status=$3, received_at=NULL, amount_uah=NULL WHERE id=$1 AND matched_transaction_id=$2`,
          [s.income_event_id, id, s.event_status_before],
        );
      }
      await m.query(`UPDATE income_events SET matched_transaction_id=NULL WHERE matched_transaction_id=$1`, [id]);
    }
    const absorbed = Number(s.count_absorbed);
    if (s.count_transaction_id !== null && absorbed > 0) await giveBackCount(m, s.count_transaction_id, absorbed);
    await m.query(
      `UPDATE transactions SET type=$2, category=$3, type_source=$4, needs_label=$5, usdc_checked=$6, from_wallet=false WHERE id=$1`,
      [id, s.type_before, s.category_before, s.type_source_before, s.needs_label_before, s.usdc_checked_before],
    );
    await m.query(`DELETE FROM cash_answers WHERE transaction_id=$1`, [id]);
    return true;
  }
  if (!a.current) return false;
  if (a.current.answer === "binance") {
    await m.query(`UPDATE income_events SET matched_transaction_id=NULL WHERE matched_transaction_id=$1`, [id]);
  }
  // Back to a cash deposit not answered yet, as the classifier left it.
  await m.query(
    `UPDATE transactions SET type='cash_in', category='cash', type_source='rule', needs_label=false, usdc_checked=false, from_wallet=false WHERE id=$1`,
    [id],
  );
  return true;
}
