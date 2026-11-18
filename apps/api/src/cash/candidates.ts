import { NotFoundException } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { isWithdrawal } from "../domain/classify";
import { candidateCap } from "../domain/recurring-match";
import { internalTransferSql } from "./wallet";

/**
 * Operations that could have paid this payment, newest first: the one rule shared by the «Оплачено»
 * sheet and the «Это оплата?» question (task Б8). `today` is the Kyiv day.
 *
 * Outgoing withdrawals, transfers and obligations on bank accounts, from a week before the due
 * date to today, none larger than candidateCap (task Б44: a hryvnia payment up to ₴20 above its amount, a foreign
 * one up to 5% above it at the latest rate, none without a rate) and none already paying another one. A transfer
 * between the owner's own accounts is not offered: nothing can be paid with it. A transfer to the
 * owner's card at another bank is.
 */
export async function paymentCandidateIds(m: EntityManager, paymentId: number, today: string): Promise<number[]> {
  const p = (await m.query(`SELECT amount::float8 AS amount, currency, due_on::text AS due_on FROM scheduled_payments WHERE id=$1`, [paymentId]))[0] as
    | { amount: number; currency: string; due_on: string }
    | undefined;
  if (!p) throw new NotFoundException("payment not found");
  const cap = candidateCap(p, await latestRates(m));
  if (cap === null) return [];
  const rows: { id: number; type: string; amount: number; description: string; mcc: number | null }[] = await m.query(
    `SELECT t.id, t.type, t.amount::float8 AS amount, t.description, t.mcc FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE t.amount < 0 AND a.kind <> 'cash'
        AND t.type = ANY('{cash_out,person_transfer,own_transfer,obligation,spend}'::text[])
        AND t.local_date BETWEEN $2::date - 7 AND $3::date
        AND t.amount_uah IS NOT NULL AND -t.amount_uah <= $1
        AND NOT ${internalTransferSql("t")}
        AND NOT EXISTS (SELECT 1 FROM payment_links l WHERE l.transaction_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM scheduled_payments s WHERE s.transaction_id = t.id)
      ORDER BY t.occurred_at DESC, t.id DESC`,
    [cap, p.due_on, today],
  );
  // A purchase only when it is really a withdrawal that an old rule made a purchase.
  return rows.filter((r) => r.type !== "spend" || isWithdrawal(r)).map((r) => r.id);
}

/** Hryvnia minor units already paid on this payment by operations linked through payment_links. */
export async function linkedSum(m: EntityManager, paymentId: number): Promise<number> {
  const r = (
    await m.query(
      `SELECT COALESCE(SUM(-COALESCE(t.amount_uah, t.amount)), 0)::float8 AS sum
         FROM payment_links l JOIN transactions t ON t.id = l.transaction_id WHERE l.payment_id = $1`,
      [paymentId],
    )
  )[0] as { sum: number };
  return r.sum;
}

/** The latest rate of each currency, UAH per unit: the same query as PlanService.rates. */
export async function latestRates(m: EntityManager): Promise<Record<string, number>> {
  const rows: { currency: string; rate: number }[] = await m.query(
    `SELECT DISTINCT ON (currency) currency, rate::float8 AS rate FROM fx_rates ORDER BY currency, fetched_at DESC`,
  );
  return Object.fromEntries(rows.map((r) => [r.currency, r.rate]));
}
