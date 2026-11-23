import { BadRequestException } from "@nestjs/common";
import type { GoalDto, GoalPlace } from "@hale/contracts";
import type { EntityManager } from "typeorm";
import { goalSaved } from "../domain/goals";
import { type BankAccountKind, accountName } from "../today/today.service";

/** A goal's place as stored (ЯМ5): one of the two columns, or neither. */
export interface GoalPlaceColumns {
  account_id: number | null;
  manual_balance_id: number | null;
}

export function goalPlaceColumns(p: GoalPlace | null): GoalPlaceColumns {
  return { account_id: p?.source === "account" ? p.id : null, manual_balance_id: p?.source === "manual" ? p.id : null };
}

/**
 * The currency of a place a goal may be kept in: a bank account (not the wallet's row) or a balance kept by hand.
 * Refuses one that is not there.
 */
export async function goalPlaceCurrency(m: EntityManager, p: GoalPlace): Promise<string> {
  const row = (
    p.source === "account"
      ? await m.query(`SELECT currency FROM accounts WHERE id=$1 AND kind <> 'cash'`, [p.id])
      : await m.query(`SELECT currency FROM manual_balances WHERE id=$1`, [p.id])
  )[0] as { currency: string } | undefined;
  if (!row) throw new BadRequestException("place not found");
  return row.currency;
}

/**
 * The goals in display order, or the one with `id` (ЯМ5): a goal kept in a place shows that place's money now, named as
 * its row in «Отложено» is (domain/goals goalSaved).
 */
export async function goalDtos(m: EntityManager, id?: number): Promise<GoalDto[]> {
  const rows: {
    id: number; name: string; target_cents: number; saved_cents: number; sort: number; currency: string;
    account_id: number | null; kind: BankAccountKind | null; account_name: string | null; title: string | null;
    account_currency: string | null; balance: number | null; credit_limit: number | null;
    manual_balance_id: number | null; manual_name: string | null; manual_currency: string | null; amount: number | null;
  }[] = await m.query(
    `SELECT g.id, g.name, g.target_cents::float8 AS target_cents, g.saved_cents::float8 AS saved_cents, g.sort, g.currency,
            a.id AS account_id, a.kind, a.name AS account_name, a.title, a.currency AS account_currency,
            a.balance::float8 AS balance, a.credit_limit::float8 AS credit_limit,
            b.id AS manual_balance_id, b.name AS manual_name, b.currency AS manual_currency, b.amount::float8 AS amount
       FROM goals g
       LEFT JOIN accounts a ON a.id = g.account_id AND a.kind <> 'cash'
       LEFT JOIN manual_balances b ON b.id = g.manual_balance_id
      WHERE $1::int IS NULL OR g.id = $1
      ORDER BY g.sort, g.id`,
    [id ?? null],
  );
  return rows.map((r) => {
    const place =
      r.account_id !== null
        ? {
            ref: { source: "account" as const, id: r.account_id, name: accountName({ kind: r.kind!, name: r.account_name, title: r.title }) },
            balance: { balance: r.balance!, creditLimit: r.credit_limit!, currency: r.account_currency! },
          }
        : r.manual_balance_id !== null
          ? {
              ref: { source: "manual" as const, id: r.manual_balance_id, name: r.manual_name! },
              balance: { balance: r.amount!, creditLimit: 0, currency: r.manual_currency! },
            }
          : null;
    const { saved, linked } = goalSaved({ savedByHand: r.saved_cents, currency: r.currency }, place?.balance ?? null);
    return {
      id: r.id,
      name: r.name,
      target_cents: r.target_cents,
      saved_cents: saved,
      sort: r.sort,
      currency: r.currency,
      place: linked ? place!.ref : null,
    };
  });
}
