import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  CashAnswerDto,
  RuleDto,
  RecipientLabelName,
  RecipientLabelResultDto,
  RecipientSummaryDto,
  TransactionDto,
  TransactionEditDto,
  TransactionPageDto,
  TransactionPatch,
  TransactionsQuery,
  TxTypeDto,
} from "@hale/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { isCounterpartyName } from "../domain/counterparty";
import { creditPart } from "../domain/credit";
import { type TxType, isWeakRuleValue, normaliseText, ruleMatches, typeCategory } from "../domain/classify";
import { binanceOnChange, cashAnswerOf } from "../domain/cash-answer";
import { limitSql, spendGroupSql } from "../domain/ledger";
import { PlanService } from "../plan/plan.service";
import { LimitService } from "../today/limit.service";
import { type CashAnswerRow, binanceEvent, cashAnswerColumnsSql, cashAnswerFacts, undoAnswer } from "../cash/cash-answer";
import { cardCashSql, cardTransferSql } from "../cash/wallet";
import { counterKeySql } from "./counter-key";
import { PLAN_TYPES, ReclassifyService } from "./reclassify.service";

const KEY = counterKeySql("t");
/** The row counts against the day limit: one definition, domain/ledger.ts, evaluated in the database. */
const IN_LIMIT = `(${limitSql("t", "a")})`;
const COLUMNS = `
  ${IN_LIMIT} AS in_limit,
  t.id, t.occurred_at, to_char(t.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS ts,
  t.local_date::text AS local_date, t.description, t.amount::float8 AS amount, t.amount_uah::float8 AS amount_uah,
  t.fx_rate::float8 AS fx_rate, a.currency, t.type, t.category, t.hold, t.needs_label,
  t.balance_after::float8 AS balance_after, t.credit_limit_at::float8 AS credit_limit_at,
  ${KEY} AS counter_key, t.counter_iban, t.counter_name, a.kind AS account_kind, (a.kind = 'cash') AS manual,
  CASE WHEN ${cardTransferSql()} THEN ${cardCashSql()}::float8 END AS card_cash,
  ${cashAnswerColumnsSql("t")},
  COALESCE(
    (SELECT s.name FROM payment_links l JOIN scheduled_payments s ON s.id = l.payment_id WHERE l.transaction_id = t.id),
    (SELECT s.name FROM scheduled_payments s WHERE s.transaction_id = t.id ORDER BY s.id LIMIT 1)
  ) AS payment_name`;
const FROM = `FROM transactions t JOIN accounts a ON a.id = t.account_id`;

interface Row extends CashAnswerRow {
  id: number;
  occurred_at: Date;
  ts: string;
  local_date: string;
  description: string;
  amount: number;
  amount_uah: number | null;
  fx_rate: number | null;
  currency: string;
  type: TxTypeDto | null;
  category: string | null;
  hold: boolean;
  needs_label: boolean;
  counter_key: string;
  counter_iban: string | null;
  counter_name: string | null;
  account_kind: string;
  manual: boolean;
  card_cash: number | null;
  payment_name: string | null;
  balance_after: number | null;
  credit_limit_at: number | null;
  in_limit: boolean;
}

/** A stored answer about a recipient. */
interface AnswerRule {
  matchKind: "merchant" | "iban" | "recipient";
  matchValue: string;
  direction: "in" | "out" | null;
  label: RecipientLabelName;
}

const answerFor = (
  rules: readonly AnswerRule[],
  r: { amount: number; description: string; counter_iban: string | null; counter_name: string | null },
): RecipientLabelName | null =>
  rules.find((rule) => ruleMatches(rule, { amount: r.amount, description: r.description, counterIban: r.counter_iban, counterName: r.counter_name }))?.label ?? null;

/** The answer to «Откуда наличные?» the card can change; `binanceOpen`: a received USDC income and a rate (see binanceEvent). */
function cashAnswerView(r: Row, binanceOpen: boolean): CashAnswerDto | null {
  const a = cashAnswerOf(cashAnswerFacts(r));
  if (!a) return null;
  return { answer: a.answer, canBinance: a.answer === "binance" || binanceOpen, binanceOnChange: binanceOnChange(a) };
}

const view = (r: Row, rules: readonly AnswerRule[], binanceOpen: boolean): TransactionDto => ({
  id: r.id,
  occurredAt: r.occurred_at.toISOString(),
  localDate: r.local_date,
  description: r.description,
  amount: r.amount,
  amountUah: r.amount_uah,
  fxRate: r.fx_rate,
  currency: r.currency,
  type: r.type,
  category: r.category,
  hold: r.hold,
  needsLabel: r.needs_label,
  counterKey: r.counter_key,
  counterName: r.counter_name,
  accountKind: r.account_kind,
  manual: r.manual,
  recipientLabel: answerFor(rules, r),
  cashOut: r.card_cash,
  paymentName: r.payment_name,
  creditPart: creditPart({ amount: r.amount, balanceAfter: r.balance_after, creditLimit: r.credit_limit_at, currency: r.currency }),
  inLimit: r.in_limit,
  cashAnswer: cashAnswerView(r, binanceOpen),
});

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6})\|(\d{1,10})$/;
const encodeCursor = (r: Row) => Buffer.from(`${r.ts}|${r.id}`).toString("base64url");
const MAX_INT4 = 2_147_483_647;
function decodeCursor(c: string): { ts: string; id: number } | null {
  const m = CURSOR.exec(Buffer.from(c, "base64url").toString("utf8"));
  if (!m) return null;
  const id = Number(m[2]);
  return id <= MAX_INT4 ? { ts: m[1]!, id } : null;
}

/** Types whose rows can settle a planned payment; a row retyped to anything else frees it. */
const SETTLING_TYPES: ReadonlySet<string> = new Set(["obligation", "debt_payment", "tax"]);

/** Owner label to the type it stands for: what it does to the limit follows from the type. */
const LABEL_TYPE: Record<RecipientLabelName, TxType> = {
  close_regular: "person_transfer",
  one_off: "person_transfer",
  service: "spend",
  debt_repayment: "debt_payment",
  lend: "loan_out",
  own_account: "own_transfer",
  skip: "person_transfer",
  obligation: "obligation",
  shared_budget: "person_transfer",
  help: "person_transfer",
};

/** Types an answer can have given a recipient's outgoing rows, so that it can be changed. */
const ANSWERED_TYPES = ["person_transfer", "obligation", "debt_payment", "spend", "loan_out", "own_transfer"];

/**
 * Types the «Доходы» list group shows. The «Траты» group is spendGroupSql in domain/ledger.ts.
 * own_transfer, loan_in, goal_contribution and untyped rows are only in "all".
 */
const INCOME_GROUP_TYPES: readonly string[] = ["income", "person_in", "cash_in"];

export class InvalidCursorError extends Error {}

@Injectable()
export class TransactionsService {
  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(PlanService) private readonly plan: PlanService,
    @Inject(ReclassifyService) private readonly reclassify: ReclassifyService,
    @Inject(LimitService) private readonly limit: LimitService,
  ) {}

  async list(q: TransactionsQuery): Promise<TransactionPageDto> {
    const where: string[] = [];
    const args: unknown[] = [];
    const arg = (v: unknown) => `$${args.push(v)}`;
    if (q.type) where.push(`t.type = ${arg(q.type)}`);
    if (q.needsLabel !== undefined) where.push(`t.needs_label = ${arg(q.needsLabel)}`);
    // The «Траты» group is the ledger's: its types and the withdrawal rule live in domain/ledger.ts.
    if (q.group === "spend") where.push(spendGroupSql("t"));
    if (q.group === "income") where.push(`t.type = ANY(${arg(INCOME_GROUP_TYPES)}::text[])`);
    if (q.category) where.push(`t.category = ${arg(q.category)}`);
    if (q.from) where.push(`t.local_date >= ${arg(q.from)}::date`);
    if (q.to) where.push(`t.local_date <= ${arg(q.to)}::date`);
    if (q.q) {
      const like = arg(`%${q.q.replace(/[\\%_]/g, "\\$&")}%`);
      where.push(`(t.description ILIKE ${like} ESCAPE '\\' OR t.counter_name ILIKE ${like} ESCAPE '\\')`);
    }
    const filters = [...where];
    const filterArgs = [...args];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      if (!c) throw new InvalidCursorError("bad cursor");
      where.push(`(t.occurred_at, t.id) < (${arg(c.ts)}::timestamp AT TIME ZONE 'UTC', ${arg(c.id)}::int)`);
    }
    const rows: Row[] = await this.ds.query(
      `SELECT ${COLUMNS} ${FROM} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY t.occurred_at DESC, t.id DESC LIMIT ${arg(q.limit + 1)}`,
      args,
    );
    const page = rows.slice(0, q.limit);
    const rules = await this.answerRules();
    const binanceOpen = await this.binanceOpen(page);
    // Under «Траты» the totals are the limit's (Б2): the sum and count of the rows that count against it,
    // the same figure as «потрачено» on «Сегодня» and in the calendar. Payments, taxes, debts, loans out
    // and jar rows stay on the list, marked by inLimit, but do not add up. «Все» and «Доходы» sum every row.
    const counted = q.group === "spend" ? IN_LIMIT : "true";
    return {
      items: page.map((r) => view(r, rules, binanceOpen)),
      nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1]!) : null,
      dayTotals: await this.dayTotals([...new Set(page.map((r) => r.local_date))], filters, filterArgs, counted),
      summary: q.category || q.from || q.to ? await this.summary(filters, filterArgs, counted) : null,
    };
  }

  /** The sum and count of the `counted` rows under the filters, ignoring the cursor. */
  private async summary(filters: string[], args: unknown[], counted: string): Promise<{ total: number; count: number }> {
    const r = (
      await this.ds.query(
        `SELECT COALESCE(SUM(t.amount_uah) FILTER (WHERE ${counted}), 0)::float8 AS total, COUNT(*) FILTER (WHERE ${counted})::int AS count
           ${FROM} ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}`,
        args,
      )
    )[0] as { total: number; count: number };
    return { total: r.total, count: r.count };
  }

  /**
   * Totals of the `counted` rows for whole days, ignoring the cursor, so a day split across pages still adds
   * up. A day with no counted row with a known hryvnia amount has no total at all rather than a misleading zero.
   */
  private async dayTotals(dates: string[], filters: string[], args: unknown[], counted: string): Promise<Record<string, number>> {
    if (dates.length === 0) return {};
    const rows: { local_date: string; total: number }[] = await this.ds.query(
      `SELECT t.local_date::text AS local_date, COALESCE(SUM(t.amount_uah) FILTER (WHERE ${counted}), 0)::float8 AS total ${FROM}
        WHERE ${[...filters, `t.local_date = ANY($${args.length + 1}::date[])`].join(" AND ")}
        GROUP BY t.local_date
       HAVING COUNT(t.amount_uah) FILTER (WHERE ${counted}) > 0`,
      [...args, dates],
    );
    return Object.fromEntries(rows.map((r) => [r.local_date, r.total]));
  }

  /**
   * Owner edit. With applyToSimilar the same change goes to every row of the same counterparty
   * (counterKey; a row without IBAN or name is keyed by its normalised description) and a rule
   * is stored for rows that arrive later. Every changed row becomes type_source 'owner'.
   */
  async edit(id: number, p: TransactionPatch): Promise<TransactionEditDto> {
    const base = (
      await this.ds.query(
        `SELECT t.type, t.amount::float8 AS amount, t.counter_iban, t.counter_name, t.description, ${KEY} AS counter_key ${FROM} WHERE t.id=$1`,
        [id],
      )
    )[0] as
      | { type: string | null; amount: number; counter_iban: string | null; counter_name: string | null; description: string; counter_key: string }
      | undefined;
    if (!base) throw new NotFoundException("transaction not found");
    const ruleType = p.type ?? base.type;
    if (p.applyToSimilar && !ruleType) throw new UnprocessableEntityException("the row has no type to make a rule from");

    const changed = await this.ds.transaction(async (m) => {
      if (p.applyToSimilar && ruleType) {
        // A name that is short or a generic bank text would catch strangers: rows are still
        // changed, but no rule is stored for it.
        const rule = ruleFor(base);
        if (rule.kind === "iban" || !isWeakRuleValue(rule.value)) {
          await this.saveRule(m, rule.kind, rule.value, ruleType, p.category ?? null, null, base.amount < 0 ? "out" : "in");
        }
      }
      const scope = p.applyToSimilar ? similarScope(id, base, ruleType!) : { id };
      const undone = p.type ? await this.undoCashAnswers(m, scope, p.type) : false;
      const ids = await this.apply(m, scope, p.type ?? null, p.category ?? null);
      const freed = p.type ? await this.unsettle(m, ids, p.type) : false;
      if (undone || freed) await this.limit.invalidate(freed ? "payment_paid" : "cash", m);
      return ids;
    });
    if (p.type) await this.settle(changed, p.type);
    const row = await this.one(id);
    return { transaction: row, updated: changed.length };
  }

  /** How many rows an edit with applyToSimilar to `type` (or the row's own type) would change. */
  async similar(id: number, type?: TxType): Promise<number> {
    const base = (await this.ds.query(`SELECT t.type, t.amount::float8 AS amount, ${KEY} AS counter_key ${FROM} WHERE t.id=$1`, [id]))[0] as
      | { type: string | null; amount: number; counter_key: string }
      | undefined;
    if (!base) throw new NotFoundException("transaction not found");
    const effective = type ?? base.type;
    if (!effective) return 1;
    const { where, args } = scopeWhere(similarScope(id, base, effective), 1);
    return (await this.ds.query(`SELECT count(*)::int AS n ${FROM} WHERE ${where}`, args))[0].n as number;
  }

  /** The owner's rules, oldest first, each with how many rows follow it. */
  async rules(): Promise<RuleDto[]> {
    const rules: StoredRule[] = await this.ds.query(`SELECT ${RULE_COLUMNS} FROM rules ORDER BY id`);
    if (rules.length === 0) return [];
    const rows: RuleRow[] = await this.ds.query(
      `SELECT id, type, amount::float8 AS amount, description, counter_iban, counter_name FROM transactions ORDER BY occurred_at DESC, id DESC`,
    );
    return rules.map((r) => {
      const named = rows.find((x) => matches(r, x) && x.counter_name?.trim())?.counter_name?.trim();
      return {
        id: r.id,
        matchKind: r.matchKind,
        title: r.matchKind === "iban" ? (named ?? `Счёт •${r.matchValue.slice(-4)}`) : r.matchValue,
        direction: r.direction,
        type: r.type,
        category: r.category,
        label: r.label,
        count: rowsUnder(r, rows).length,
      };
    });
  }

  /**
   * Deletes a rule. Its rows, the one the owner edited included, go back to automatic recognition
   * right away; the limit follows by itself, it is computed from types.
   */
  async deleteRule(id: number): Promise<{ updated: number }> {
    const ids = await this.ds.transaction(async (m) => {
      const rule = (await m.query(`SELECT ${RULE_COLUMNS} FROM rules WHERE id=$1 FOR UPDATE`, [id]))[0] as StoredRule | undefined;
      if (!rule) throw new NotFoundException("rule not found");
      await m.query(`DELETE FROM rules WHERE id=$1`, [id]);
      const rows: RuleRow[] = await m.query(
        `SELECT t.id, t.type, t.amount::float8 AS amount, t.description, t.counter_iban, t.counter_name ${FROM}
          WHERE t.type_source IN ('owner','rule') AND t.type = $1 AND a.kind <> 'cash'
            AND NOT EXISTS (SELECT 1 FROM payment_links l WHERE l.transaction_id = t.id)`,
        [rule.type],
      );
      const under = rowsUnder(rule, rows).map((r) => r.id);
      if (under.length > 0) await m.query(`UPDATE transactions SET type_source = NULL WHERE id = ANY($1::int[])`, [under]);
      return under;
    });
    await this.reclassify.reclassifyIds(ids);
    return { updated: ids.length };
  }

  /**
   * Gives a recipient's whole history the type the answer stands for, and remembers it as a rule: by
   * account number when known, so that transfers with only a bank text follow it too. A later answer
   * replaces an earlier one.
   */
  async labelRecipient(counterKey: string, label: RecipientLabelName): Promise<RecipientLabelResultDto> {
    const sample = (
      await this.ds.query(
        `SELECT t.counter_iban, t.counter_name, t.description ${FROM} WHERE ${KEY} = $1
          ORDER BY (t.type = 'person_transfer') DESC, t.occurred_at DESC, t.id DESC LIMIT 1`,
        [counterKey],
      )
    )[0] as { counter_iban: string | null; counter_name: string | null; description: string } | undefined;
    if (!sample) throw new NotFoundException("recipient not found");
    const rule = ruleFor(sample);
    const type = LABEL_TYPE[label];
    const changed = await this.ds.transaction(async (m) => {
      if (rule.kind === "iban" || !isWeakRuleValue(rule.value)) {
        await this.dropNameAnswer(m, sample);
        await this.saveRule(m, rule.kind === "merchant" ? "recipient" : rule.kind, rule.value, type, null, label, "out");
      }
      const ids = await this.apply(m, { key: counterKey, relabel: true }, type, null);
      if (await this.unsettle(m, ids, type)) await this.limit.invalidate("payment_paid", m);
      return ids;
    });
    await this.settle(changed, type);
    return { updated: changed.length };
  }

  /** The answer by name that an answer by account number replaces: rules apply oldest first. */
  private async dropNameAnswer(m: EntityManager, r: { counter_name: string | null; description: string }): Promise<void> {
    await m.query(`DELETE FROM rules WHERE match_kind='recipient' AND label IS NOT NULL AND match_value=$1`, [
      normaliseText(r.counter_name?.trim() || r.description),
    ]);
  }

  /** Who a recipient is, what was sent to them in all, and the answer given about them. */
  async recipient(counterKey: string): Promise<RecipientSummaryDto> {
    const rows: { amount: number; amount_uah: number | null; local_date: string; description: string; counter_iban: string | null; counter_name: string | null }[] =
      await this.ds.query(
        `SELECT t.amount::float8 AS amount, t.amount_uah::float8 AS amount_uah, t.local_date::text AS local_date, t.description, t.counter_iban, t.counter_name
           ${FROM} WHERE ${KEY} = $1 AND t.amount < 0 ORDER BY t.occurred_at DESC, t.id DESC`,
        [counterKey],
      );
    const last = rows[0];
    if (!last) throw new NotFoundException("recipient not found");
    const labelOf = (r: (typeof rows)[number]) => r.counter_name?.trim() || r.description;
    const rules = await this.answerRules();
    return {
      name: labelOf(rows.find((r) => isCounterpartyName(labelOf(r))) ?? last),
      count: rows.length,
      total: rows.reduce((s, r) => s + Math.abs(r.amount_uah ?? 0), 0),
      lastOn: last.local_date,
      label: answerFor(rules, last),
    };
  }

  private answerRules(): Promise<AnswerRule[]> {
    return this.ds.query(
      `SELECT match_kind AS "matchKind", match_value AS "matchValue", direction, label FROM rules WHERE label IS NOT NULL ORDER BY id`,
    );
  }

  private async apply(m: EntityManager, scope: Scope, type: TxType | null, category: string | null): Promise<number[]> {
    const { where, args: scopeArgs } = scopeWhere(scope, 4);
    const args: unknown[] = [type, category, type ? typeCategory(type) : null, ...scopeArgs];
    const rows: { id: number }[] = await m.query(
      `WITH u AS (UPDATE transactions SET
         category = CASE
           WHEN $2::text IS NOT NULL THEN $2
           WHEN $1::text IS NULL THEN transactions.category
           WHEN $1 = 'spend' AND transactions.type = 'spend' THEN COALESCE(transactions.category, 'uncategorized')
           ELSE $3 END,
         type = COALESCE($1::text, transactions.type), type_source = 'owner', needs_label = false
       FROM transactions t WHERE transactions.id = t.id AND ${where} RETURNING transactions.id AS id)
       SELECT id FROM u`,
      args,
    );
    return rows.map((r) => r.id);
  }

  /**
   * Rows retyped to a type that settles nothing free their planned payments, in the edit's transaction. A
   * payment closed through the row itself (transaction_id) opens again. A row linked through payment_links
   * is unlinked, and its payment opens again only if those links closed it and the rest no longer cover it
   * (task Б26); a payment marked paid by hand stays paid. True when a payment opened: the caller fixes the
   * day afresh.
   */
  private async unsettle(m: EntityManager, ids: readonly number[], type: string): Promise<boolean> {
    if (ids.length === 0 || SETTLING_TYPES.has(type)) return false;
    const unlinked: { payment_id: number }[] = await m.query(
      `WITH d AS (DELETE FROM payment_links WHERE transaction_id = ANY($1::int[]) RETURNING payment_id) SELECT DISTINCT payment_id FROM d`,
      [ids],
    );
    const freed = (await m.query(
      `UPDATE scheduled_payments SET transaction_id = NULL, paid_at = NULL, closed_by_links = false WHERE transaction_id = ANY($1::int[])`,
      [ids],
    )) as [unknown[], number];
    const reopened = await this.plan.reopenUncovered(m, unlinked.map((u) => u.payment_id));
    return freed[1] > 0 || reopened;
  }

  /** Rows given a type the plan cares about are matched to planned payments as after classification. */
  private async settle(ids: readonly number[], type: string): Promise<void> {
    if (ids.length === 0 || !PLAN_TYPES.has(type as TxType)) return;
    for (const id of ids) await this.plan.onClassified(id, type);
  }

  private async saveRule(
    m: EntityManager,
    kind: "merchant" | "iban" | "recipient",
    value: string,
    type: string,
    category: string | null,
    label: string | null,
    direction: "in" | "out",
  ): Promise<void> {
    await m.query(
      `DELETE FROM rules WHERE match_kind=$1 AND lower(match_value)=lower($2) AND direction IS NOT DISTINCT FROM $3`,
      [kind, value, direction],
    );
    await m.query(
      `INSERT INTO rules (match_kind, match_value, type, category, label, direction) VALUES ($1,$2,$3,$4,$5,$6)`,
      [kind, value, type, category, label, direction],
    );
  }

  async one(id: number): Promise<TransactionDto> {
    const r = (await this.ds.query(`SELECT ${COLUMNS} ${FROM} WHERE t.id=$1`, [id]))[0] as Row;
    return view(r, await this.answerRules(), await this.binanceOpen([r]));
  }

  /** Whether «Вывод с Binance» can be chosen now; asked only when a row on the page has a cash answer. */
  private async binanceOpen(rows: readonly Row[]): Promise<boolean> {
    if (!rows.some((r) => cashAnswerOf(cashAnswerFacts(r)) !== null)) return false;
    return (await binanceEvent(this.ds.manager)) !== null;
  }

  /**
   * A type changed by hand on a row with an answer to «Откуда наличные?» or «Это вывод с Binance?» undoes
   * that answer first, as a new answer would (task Б21): the wallet, Binance and the income get back what
   * it did. Rows keeping their type keep their answer. True when anything was undone.
   */
  private async undoCashAnswers(m: EntityManager, scope: Scope, type: string): Promise<boolean> {
    const { where, args } = scopeWhere(scope, 2);
    const rows: { id: number }[] = await m.query(
      `SELECT t.id ${FROM} WHERE ${where} AND t.type IS DISTINCT FROM $1
          AND (t.from_wallet OR t.usdc_checked OR EXISTS (SELECT 1 FROM cash_answers c WHERE c.transaction_id = t.id))
        ORDER BY t.id FOR UPDATE OF t`,
      [type, ...args],
    );
    let undone = false;
    for (const r of rows) undone = (await undoAnswer(m, r.id)) || undone;
    return undone;
  }
}

type Scope = { id: number } | { key: string; relabel?: boolean; sign?: number; keepId?: number; type?: string };

/** Rows of the same counterparty and direction; their withdrawals only if the new type is a withdrawal. */
const similarScope = (id: number, base: { amount: number; counter_key: string }, type: string): Scope => ({
  key: base.counter_key,
  sign: Math.sign(base.amount),
  keepId: id,
  type,
});

/** WHERE over `t` for a scope, with parameters numbered from `first`. */
function scopeWhere(scope: Scope, first: number): { where: string; args: unknown[] } {
  const args: unknown[] = [];
  const arg = (v: unknown) => `$${first + args.push(v) - 1}`;
  if ("id" in scope) return { where: `t.id = ${arg(scope.id)}`, args };
  const parts = [`${KEY} = ${arg(scope.key)}`];
  if (scope.sign) parts.push(`sign(t.amount) = ${arg(scope.sign)}`);
  if (scope.relabel) parts.push(`t.amount < 0 AND t.type = ANY('{${ANSWERED_TYPES.join(",")}}'::text[])`);
  if (scope.keepId !== undefined) {
    const keep = arg(scope.keepId);
    // Rows that pay a planned payment stay with it; the owner changes them one by one.
    parts.push(`(t.id = ${keep} OR NOT EXISTS (SELECT 1 FROM payment_links l WHERE l.transaction_id = t.id))`);
    if (scope.type && scope.type !== "cash_out") parts.push(`(t.id = ${keep} OR t.type IS DISTINCT FROM 'cash_out')`);
  }
  return { where: parts.join(" AND "), args };
}

const RULE_COLUMNS = `id, match_kind AS "matchKind", match_value AS "matchValue", direction, type, category, label`;
interface StoredRule {
  id: number;
  matchKind: "merchant" | "iban" | "recipient";
  matchValue: string;
  direction: "in" | "out" | null;
  type: TxTypeDto;
  category: string | null;
  label: RecipientLabelName | null;
}
interface RuleRow {
  id: number;
  type: string | null;
  amount: number;
  description: string;
  counter_iban: string | null;
  counter_name: string | null;
}
const matches = (r: StoredRule, x: RuleRow) =>
  ruleMatches(r, { amount: x.amount, description: x.description, counterIban: x.counter_iban, counterName: x.counter_name });
/** Rows a rule stands for: they match it and have its type. */
const rowsUnder = (r: StoredRule, rows: readonly RuleRow[]) => rows.filter((x) => x.type === r.type && matches(r, x));

/** The narrowest rule that still catches the row's counterparty. */
function ruleFor(r: { counter_iban: string | null; counter_name: string | null; description: string }): {
  kind: "iban" | "recipient" | "merchant";
  value: string;
} {
  if (r.counter_iban) return { kind: "iban", value: r.counter_iban };
  if (r.counter_name?.trim()) return { kind: "recipient", value: normaliseText(r.counter_name) };
  return { kind: "merchant", value: normaliseText(r.description) };
}
