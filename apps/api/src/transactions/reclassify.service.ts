import { Inject, Injectable, Optional, type OnApplicationBootstrap, type OnModuleInit } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import {
  CLASSIFIER_VERSION,
  classify,
  hasThirdParty,
  type ClassifyContext,
  type ClassifyInput,
  type ClassifyRule,
  type TxType,
} from "../domain/classify";
import { deletedCategories } from "../categories/live";
import { storedCategory } from "../domain/categories";
import { exactPartnerSql, isOwnPair, OWN_PAIR_WINDOW_S, type PairLeg } from "../domain/own-pair";
import { JobRunner } from "../mono/jobs/job-runner";
import { PlanService } from "../plan/plan.service";

export const RECLASSIFY_JOB_KIND = "reclassify";
export const OWN_IDENTITY = Symbol("OWN_IDENTITY");
const CHUNK = 500;
/** Types the planned-data matcher cares about; other rows skip its per-row transaction. */
export const PLAN_TYPES: ReadonlySet<TxType> = new Set<TxType>(["obligation", "debt_payment", "tax", "loan_in", "income", "spend", "person_transfer"]);

/** What the bank statements cannot tell us about who "me" is. */
export interface OwnIdentity {
  ownNames: readonly string[];
  ownIbans: readonly string[];
  ownJars: readonly string[];
}

interface Row {
  id: number;
  /** The type before this pass. */
  type: string | null;
  account_kind: ClassifyInput["accountKind"];
  description: string;
  comment: string | null;
  mcc: number | null;
  amount: number;
  counter_iban: string | null;
  counter_name: string | null;
}

/** One side of a possible pair, as the pair rule reads it. */
interface LegFacts {
  account_id: number;
  kind: string;
  currency: string;
  at: number;
  amount: number;
  amount_uah: number | null;
  exact: boolean;
  description: string;
  counter_name: string | null;
  counter_iban: string | null;
}

/** SQL columns of LegFacts for the transaction `x` and its account `xa`, each prefixed with `p`. */
const legColumns = (x: string, xa: string, p: string): string =>
  `${x}.account_id AS ${p}account_id, ${xa}.kind AS ${p}kind, ${xa}.currency AS ${p}currency,
   extract(epoch FROM ${x}.occurred_at)::float8 * 1000 AS ${p}at, ${x}.amount::float8 AS ${p}amount,
   ${x}.amount_uah::float8 AS ${p}amount_uah, ${exactPartnerSql(x)} AS ${p}exact, ${x}.description AS ${p}description,
   ${x}.counter_name AS ${p}counter_name, ${x}.counter_iban AS ${p}counter_iban`;

const prefixed = (r: Record<string, unknown>, p: string): LegFacts =>
  Object.fromEntries(Object.entries(r).filter(([k]) => k.startsWith(p)).map(([k, v]) => [k.slice(p.length), v])) as unknown as LegFacts;

/**
 * Applies classify() to rows that are untyped or were typed by a rule or automatically.
 * Rows with type_source = 'owner' (labelled by the owner) are never read for update or written.
 * An owner *rule* is stored as 'rule', so deleting the rule lets the row be classified again.
 */
@Injectable()
export class ReclassifyService implements OnModuleInit, OnApplicationBootstrap {
  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(JobRunner) private readonly runner: JobRunner,
    @Inject(OWN_IDENTITY) private readonly own: OwnIdentity,
    @Optional() @Inject(PlanService) private readonly plan?: PlanService,
  ) {}

  onModuleInit(): void {
    this.runner.register(RECLASSIFY_JOB_KIND, async () => {
      await this.reclassifyPending();
    });
  }

  /**
   * A server with a newer classifier than the one the stored rows were classified with queues one reclassify
   * of the whole history (Б49). The version is written in the same transaction as the job, so a crash leaves
   * either both or neither, and the next start with the same version queues nothing.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.ds.transaction(async (m) => {
      const [, raised] = (await m.query(
        `UPDATE settings SET classifier_version=$1 WHERE id=1 AND classifier_version < $1`,
        [CLASSIFIER_VERSION],
      )) as [unknown, number];
      if (raised === 0) return;
      // A fresh database has nothing to rewrite; an empty job would only sit in the queue.
      const rows: unknown[] = await m.query(`SELECT 1 FROM transactions WHERE type_source IS DISTINCT FROM 'owner' LIMIT 1`);
      if (rows.length > 0) await this.enqueue(new Date(), m);
    });
  }

  /**
   * Queues one reclassify job unless one is already waiting. Called after a history import ends
   * (ImportService) and at start when the classifier version is newer (onApplicationBootstrap).
   */
  async enqueue(runAfter: Date = new Date(), q: DataSource | EntityManager = this.ds): Promise<void> {
    await q.query(
      `INSERT INTO jobs (kind, run_after)
       SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE kind=$1 AND status='pending')`,
      [RECLASSIFY_JOB_KIND, runAfter],
    );
  }

  /** Every row that is allowed to change. Returns how many rows were examined. */
  async reclassifyPending(): Promise<number> {
    const ids: { id: number }[] = await this.ds.query(
      `SELECT id FROM transactions WHERE type_source IS DISTINCT FROM 'owner' ORDER BY id`,
    );
    return this.reclassifyIds(ids.map((r) => r.id));
  }

  /** Just these rows (after an upsert). Owner-labelled rows among them are skipped. */
  async reclassifyIds(ids: readonly number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const ctx = await this.loadContext();
    const deleted = await deletedCategories(this.ds);
    // In the order they happened: a loan opens before the repayment that closes it.
    const all = (
      (await this.ds.query(`SELECT id FROM transactions WHERE id = ANY($1) ORDER BY occurred_at, id`, [
        await this.withOppositeLegs(ids, ctx),
      ])) as { id: number }[]
    ).map((r) => r.id);
    let n = 0;
    for (let i = 0; i < all.length; i += CHUNK) {
      const chunk = all.slice(i, i + CHUNK);
      const rows: Row[] = await this.ds.query(
        `SELECT t.id, t.type, a.kind AS account_kind, t.description, t.comment, t.mcc, t.amount::float8 AS amount,
                t.counter_iban, t.counter_name
           FROM transactions t JOIN accounts a ON a.id = t.account_id
          WHERE t.id = ANY($1) AND t.type_source IS DISTINCT FROM 'owner'
          ORDER BY t.occurred_at, t.id`,
        [chunk],
      );
      const pairs = await this.ownPairs(chunk, ctx);
      for (const r of rows) {
        const out = classify(
          {
            amount: r.amount,
            mcc: r.mcc,
            description: r.description,
            comment: r.comment,
            counterIban: r.counter_iban,
            counterName: r.counter_name,
            accountKind: r.account_kind,
            pairedOwnTransfer: pairs.has(r.id),
          },
          ctx,
        );
        const args = [r.id, out.type, storedCategory(out.category, deleted), out.source === "owner" ? "rule" : out.source, out.needsLabel];
        const update = (q: DataSource | EntityManager) =>
          q.query(
            `UPDATE transactions SET type=$2, category=$3, type_source=$4, needs_label=$5
              WHERE id=$1 AND type_source IS DISTINCT FROM 'owner'`,
            args,
          ) as Promise<[unknown[], number]>;
        const plan = this.plan;
        if (plan && r.type !== null && r.type !== out.type) {
          // A row given another type frees what it settled under the old one, as an edit by hand does (Б52).
          // An untyped row is new and has settled nothing yet.
          const from = r.type;
          await this.ds.transaction(async (m) => {
            if ((await update(m))[1] > 0) await plan.onRetyped(m, r.id, from, out.type);
          });
        } else {
          await update(this.ds);
        }
        if (PLAN_TYPES.has(out.type)) await this.plan?.onClassified(r.id, out.type);
        n++;
      }
    }
    return n;
  }

  /**
   * A transfer between own accounts is two rows. Whichever arrives second makes the first one
   * recognisable, so the opposite legs of the given rows are reclassified with them.
   */
  private async withOppositeLegs(ids: readonly number[], ctx: ClassifyContext): Promise<number[]> {
    const out = new Set(ids);
    for (let i = 0; i < ids.length; i += CHUNK) {
      for (const others of (await this.ownPairs(ids.slice(i, i + CHUNK), ctx)).values()) for (const id of others) out.add(id);
    }
    return [...out];
  }

  /**
   * For each of the given rows that has one, the rows that are its other leg (isOwnPair). SQL only
   * narrows the candidates to opposite signs on other accounts within the window; the rule decides.
   */
  private async ownPairs(ids: readonly number[], ctx: ClassifyContext): Promise<Map<number, number[]>> {
    const rows: ({ id: number; other_id: number } & Record<string, unknown>)[] = await this.ds.query(
      `SELECT t.id, o.id AS other_id, ${legColumns("t", "a", "t_")}, ${legColumns("o", "oa", "o_")}
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         JOIN transactions o ON o.account_id <> t.account_id AND sign(o.amount) = -sign(t.amount)
          AND o.occurred_at BETWEEN t.occurred_at - make_interval(secs => $2) AND t.occurred_at + make_interval(secs => $2)
         JOIN accounts oa ON oa.id = o.account_id
        WHERE t.id = ANY($1)`,
      [ids, OWN_PAIR_WINDOW_S],
    );
    const leg = (f: LegFacts): PairLeg => ({
      accountId: f.account_id,
      accountKind: f.kind,
      currency: f.currency,
      at: f.at,
      amount: f.amount,
      amountUah: f.amount_uah,
      exactPartner: f.exact,
      thirdParty: hasThirdParty({ amount: f.amount, description: f.description, counterName: f.counter_name, counterIban: f.counter_iban }, ctx),
    });
    const out = new Map<number, number[]>();
    for (const r of rows) {
      if (!isOwnPair(leg(prefixed(r, "t_")), leg(prefixed(r, "o_")))) continue;
      const list = out.get(r.id);
      if (list) list.push(r.other_id);
      else out.set(r.id, [r.other_id]);
    }
    return out;
  }

  private async loadContext(): Promise<ClassifyContext> {
    const rules: { match_kind: ClassifyRule["matchKind"]; match_value: string; type: string; category: string | null; direction: "in" | "out" | null }[] =
      await this.ds.query(`SELECT match_kind, match_value, type, category, direction FROM rules ORDER BY id`);
    const accounts: { kind: string; iban: string | null; title: string | null }[] = await this.ds.query(
      `SELECT kind, iban, title FROM accounts WHERE iban IS NOT NULL OR title IS NOT NULL`,
    );
    return {
      ownIbans: new Set([...this.own.ownIbans, ...accounts.flatMap((a) => (a.iban ? [a.iban] : []))]),
      ownNames: this.own.ownNames,
      ownJars: [...this.own.ownJars, ...accounts.flatMap((a) => (a.kind === "jar" && a.title ? [a.title] : []))],
      rules: rules.map((r) => ({
        matchKind: r.match_kind,
        matchValue: r.match_value,
        type: r.type as TxType,
        category: r.category,
        direction: r.direction,
      })),
    };
  }
}
