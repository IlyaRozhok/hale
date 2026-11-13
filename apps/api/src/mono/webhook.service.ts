import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";
import { z } from "zod";
import { Account, Job } from "../db/entities";
import { ImportService } from "./import.service";
import { JOB_CLOCK, type JobClock, JobRunner } from "./jobs/job-runner";
import { monoStatementItemSchema } from "./mono.schemas";
import { markSynced } from "./sync-status";

export const WEBHOOK_JOB_KIND = "webhook.item";
/**
 * The account's stored limit counts as the limit at the moment of the operation only this soon after it.
 * A job that ran later (a backlog, a retry) keeps no limit. Our own threshold: client-info refreshes hourly.
 */
export const LIVE_LIMIT_MS = 60 * 60 * 1000;

export const webhookBodySchema = z.object({
  type: z.literal("StatementItem"),
  data: z.object({ account: z.string().min(1), statementItem: monoStatementItemSchema }),
});

const jobPayloadSchema = z.object({
  account: z.string().min(1),
  statementItem: monoStatementItemSchema,
});

@Injectable()
export class WebhookService implements OnModuleInit {
  private readonly log = new Logger(WebhookService.name);

  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(ImportService) private readonly imports: ImportService,
    @Inject(JobRunner) private readonly runner: JobRunner,
    @Inject(JOB_CLOCK) private readonly clock: JobClock,
  ) {}

  onModuleInit(): void {
    this.runner.register(WEBHOOK_JOB_KIND, (job) => this.process(job));
  }

  /**
   * Validates the body and queues a job. Always resolves: monobank disables the hook after
   * repeated failures, so a body we cannot use is logged (without its contents) and dropped.
   */
  async accept(body: unknown): Promise<void> {
    const type = (body as { type?: unknown } | null)?.type;
    if (type !== "StatementItem") {
      this.log.warn(`webhook ignored: event type ${typeof type === "string" ? type : "missing"}`);
      return;
    }
    const parsed = webhookBodySchema.safeParse(body);
    if (!parsed.success) {
      const fields = parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")).join(", ");
      this.log.warn(`webhook ignored: malformed StatementItem (${fields})`);
      return;
    }
    await this.ds.query(`INSERT INTO jobs (kind, payload, run_after) VALUES ($1, $2::jsonb, $3)`, [
      WEBHOOK_JOB_KIND,
      JSON.stringify(parsed.data.data),
      new Date(this.clock.now()),
    ]);
  }

  private async process(job: Job): Promise<void> {
    const { account: externalId, statementItem } = jobPayloadSchema.parse(job.payload);
    const accounts = this.ds.getRepository(Account);
    let account = await accounts.findOneBy({ external_id: externalId });
    if (!account) {
      // A new card or jar: refresh accounts once, then retry.
      await this.imports.syncAccounts();
      account = await accounts.findOneBy({ external_id: externalId });
    }
    if (!account) {
      throw new Error(`webhook item for unknown account ${externalId}, even after refreshing accounts`);
    }
    const live = this.clock.now() - statementItem.time * 1000 < LIVE_LIMIT_MS;
    await this.imports.upsertStatementItem(account.id, statementItem, { live });
    // The item carries the balance after it. A late or re-delivered item must not undo a newer one.
    const at = new Date(statementItem.time * 1000);
    await this.ds.query(
      `UPDATE accounts SET balance=$2, balance_at=$3 WHERE id=$1 AND (balance_at IS NULL OR balance_at <= $3)`,
      [account.id, statementItem.balance, at],
    );
    await markSynced(this.ds, new Date(this.clock.now()));
  }
}
