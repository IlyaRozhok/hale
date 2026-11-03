import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  RecipientLabelName,
  RecipientLabelResultDto,
  TransactionDto,
  TransactionEditDto,
  TransactionPageDto,
  TransactionPatch,
  TransactionsQuery,
  TxTypeDto,
} from "@hale/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { type TxType, isWeakRuleValue, normaliseText, typeCategory } from "../domain/classify";
import { PlanService } from "../plan/plan.service";
import { counterKeySql } from "./counter-key";
import { PLAN_TYPES } from "./reclassify.service";

const KEY = counterKeySql("t");
const COLUMNS = `
  t.id, t.occurred_at, to_char(t.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS ts,
  t.local_date::text AS local_date, t.description, t.amount::float8 AS amount, t.amount_uah::float8 AS amount_uah,
  t.fx_rate::float8 AS fx_rate, a.currency, t.type, t.category, t.hold, t.needs_label,
  ${KEY} AS counter_key, t.counter_name, a.kind AS account_kind`;
const FROM = `FROM transactions t JOIN accounts a ON a.id = t.account_id`;

interface Row {
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
  counter_name: string | null;
  account_kind: string;
}

const view = (r: Row): TransactionDto => ({
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

/** Owner label to the type it stands for; the other three stay spending. */
const LABEL_TYPE: Record<RecipientLabelName, TxType> = {
  obligation: "obligation",
  debt_repayment: "debt_payment",
  shared_budget: "person_transfer",
  help: "person_transfer",
  one_off: "person_transfer",
};

/** Which types each list group shows. own_transfer, loan_in, goal_contribution and untyped rows are only in "all". */
const GROUP_TYPES: Record<"spend" | "income", readonly string[]> = {
  spend: ["spend", "obligation", "tax", "debt_payment", "person_transfer", "cash_out"],
  income: ["income", "person_in", "cash_in"],
};

export class InvalidCursorError extends Error {}

@Injectable()
export class TransactionsService {
  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(PlanService) private readonly plan: PlanService,
  ) {}

  async list(q: TransactionsQuery): Promise<TransactionPageDto> {
    const where: string[] = [];
    const args: unknown[] = [];
    const arg = (v: unknown) => `$${args.push(v)}`;
    if (q.type) where.push(`t.type = ${arg(q.type)}`);
    if (q.needsLabel !== undefined) where.push(`t.needs_label = ${arg(q.needsLabel)}`);
    if (q.group && q.group !== "all") where.push(`t.type = ANY(${arg(GROUP_TYPES[q.group])}::text[])`);
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
    return {
      items: page.map(view),
      nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1]!) : null,
      dayTotals: await this.dayTotals([...new Set(page.map((r) => r.local_date))], filters, filterArgs),
    };
  }

  /** Totals for whole days, ignoring the cursor, so a day split across pages still adds up. */
  private async dayTotals(dates: string[], filters: string[], args: unknown[]): Promise<Record<string, number>> {
    if (dates.length === 0) return {};
    const rows: { local_date: string; total: number }[] = await this.ds.query(
      `SELECT t.local_date::text AS local_date, COALESCE(SUM(t.amount_uah), 0)::float8 AS total ${FROM}
        WHERE ${[...filters, `t.local_date = ANY($${args.length + 1}::date[])`].join(" AND ")}
        GROUP BY t.local_date`,
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
      const scope = p.applyToSimilar ? { key: base.counter_key, sign: Math.sign(base.amount) } : { id };
      return this.apply(m, scope, p.type ?? null, p.category ?? null);
    });
    if (p.type) await this.settle(changed, p.type);
    const row = await this.one(id);
    return { transaction: row, updated: changed.length };
  }

  /** Gives a recipient's whole history the type the label stands for, and remembers it as a rule. */
  async labelRecipient(counterKey: string, label: RecipientLabelName): Promise<RecipientLabelResultDto> {
    const sample = (
      await this.ds.query(
        `SELECT t.counter_name, t.description ${FROM} WHERE ${KEY} = $1
          ORDER BY (t.type = 'person_transfer') DESC, t.occurred_at DESC, t.id DESC LIMIT 1`,
        [counterKey],
      )
    )[0] as { counter_name: string | null; description: string } | undefined;
    if (!sample) throw new NotFoundException("recipient not found");
    const value = normaliseText(sample.counter_name?.trim() || sample.description);
    const type = LABEL_TYPE[label];
    const changed = await this.ds.transaction(async (m) => {
      if (!isWeakRuleValue(value)) await this.saveRule(m, "recipient", value, type, null, label, "out");
      return this.apply(m, { key: counterKey, relabel: true }, type, null);
    });
    await this.settle(changed, type);
    return { updated: changed.length };
  }

  private async apply(
    m: EntityManager,
    scope: { id: number } | { key: string; relabel?: boolean; sign?: number },
    type: TxType | null,
    category: string | null,
  ): Promise<number[]> {
    const args: unknown[] = [type, category, type ? typeCategory(type) : null];
    let where: string;
    if ("id" in scope) {
      args.push(scope.id);
      where = `t.id = $4`;
    } else {
      args.push(scope.key);
      if (scope.sign) args.push(scope.sign);
      where = `${KEY} = $4${scope.sign ? " AND sign(t.amount) = $5" : ""}${scope.relabel ? ` AND t.amount < 0 AND t.type IN ('person_transfer','obligation','debt_payment')` : ""}`;
    }
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
   * Planned payments follow the new type: a row that no longer settles one frees it (a payment
   * marked paid by hand has no transaction and stays paid); otherwise the row is matched as after
   * classification.
   */
  private async settle(ids: readonly number[], type: string): Promise<void> {
    if (ids.length === 0) return;
    if (!SETTLING_TYPES.has(type)) {
      await this.ds.query(
        `UPDATE scheduled_payments SET transaction_id = NULL, paid_at = NULL WHERE transaction_id = ANY($1::int[])`,
        [ids],
      );
    }
    if (!PLAN_TYPES.has(type as TxType)) return;
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

  private async one(id: number): Promise<TransactionDto> {
    const r = (await this.ds.query(`SELECT ${COLUMNS} ${FROM} WHERE t.id=$1`, [id]))[0] as Row;
    return view(r);
  }
}

/** The narrowest rule that still catches the row's counterparty. */
function ruleFor(r: { counter_iban: string | null; counter_name: string | null; description: string }): {
  kind: "iban" | "recipient" | "merchant";
  value: string;
} {
  if (r.counter_iban) return { kind: "iban", value: r.counter_iban };
  if (r.counter_name?.trim()) return { kind: "recipient", value: normaliseText(r.counter_name) };
  return { kind: "merchant", value: normaliseText(r.description) };
}
