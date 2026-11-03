import { Inject, Injectable, Optional, type OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";
import {
  classify,
  type ClassifyContext,
  type ClassifyInput,
  type ClassifyRule,
  type TxType,
} from "../domain/classify";
import { JobRunner } from "../mono/jobs/job-runner";
import { PlanService } from "../plan/plan.service";

export const RECLASSIFY_JOB_KIND = "reclassify";
export const OWN_IDENTITY = Symbol("OWN_IDENTITY");
const CHUNK = 500;
/** Types the planned-data matcher cares about; other rows skip its per-row transaction. */
export const PLAN_TYPES: ReadonlySet<TxType> = new Set<TxType>(["obligation", "debt_payment", "tax", "loan_in", "income", "spend", "person_transfer"]);
const PAIR_WINDOW_S = 600;

/** What the bank statements cannot tell us about who "me" is. */
export interface OwnIdentity {
  ownNames: readonly string[];
  ownIbans: readonly string[];
  ownJars: readonly string[];
}

interface Row {
  id: number;
  account_kind: ClassifyInput["accountKind"];
  description: string;
  comment: string | null;
  mcc: number | null;
  amount: number;
  counter_iban: string | null;
  counter_name: string | null;
  paired: boolean;
}

/**
 * Applies classify() to rows that are untyped or were typed by a rule or automatically.
 * Rows with type_source = 'owner' (labelled by the owner) are never read for update or written.
 * An owner *rule* is stored as 'rule', so deleting the rule lets the row be classified again.
 */
@Injectable()
export class ReclassifyService implements OnModuleInit {
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

  /** Queues one reclassify job unless one is already waiting (call after the rules change). */
  async enqueue(runAfter: Date = new Date()): Promise<void> {
    await this.ds.query(
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
    const all = await this.withOppositeLegs(ids);
    let n = 0;
    for (let i = 0; i < all.length; i += CHUNK) {
      const rows: Row[] = await this.ds.query(
        `SELECT t.id, a.kind AS account_kind, t.description, t.comment, t.mcc, t.amount::float8 AS amount,
                t.counter_iban, t.counter_name,
                EXISTS (
                  SELECT 1 FROM transactions o
                   WHERE o.account_id <> t.account_id AND o.amount = -t.amount
                     AND abs(extract(epoch FROM (o.occurred_at - t.occurred_at))) <= $2
                ) AS paired
           FROM transactions t JOIN accounts a ON a.id = t.account_id
          WHERE t.id = ANY($1) AND t.type_source IS DISTINCT FROM 'owner'`,
        [all.slice(i, i + CHUNK), PAIR_WINDOW_S],
      );
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
            pairedOwnTransfer: r.paired,
          },
          ctx,
        );
        await this.ds.query(
          `UPDATE transactions SET type=$2, category=$3, type_source=$4, needs_label=$5
            WHERE id=$1 AND type_source IS DISTINCT FROM 'owner'`,
          [r.id, out.type, out.category, out.source === "owner" ? "rule" : out.source, out.needsLabel],
        );
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
  private async withOppositeLegs(ids: readonly number[]): Promise<number[]> {
    const out = new Set(ids);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const rows: { id: number }[] = await this.ds.query(
        `SELECT DISTINCT o.id FROM transactions t JOIN transactions o
           ON o.account_id <> t.account_id AND o.amount = -t.amount
          AND abs(extract(epoch FROM (o.occurred_at - t.occurred_at))) <= $2
          WHERE t.id = ANY($1)`,
        [ids.slice(i, i + CHUNK), PAIR_WINDOW_S],
      );
      for (const r of rows) out.add(r.id);
    }
    return [...out];
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
