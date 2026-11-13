import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DataSource } from "typeorm";
import { APP_CONFIG } from "../config.module";
import type { AppConfig } from "../config";
import { Account } from "../db/entities";
import { ImportService } from "./import.service";
import { JOB_CLOCK, type JobClock } from "./jobs/job-runner";
import { MonoClient } from "./mono.client";
import { markContact, markSynced } from "./sync-status";
import { TodayService } from "../today/today.service";

export const RECONCILE_DAYS = 7;
const DAY_S = 86_400;

@Injectable()
export class ReconcileService implements OnApplicationBootstrap {
  private readonly log = new Logger(ReconcileService.name);

  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(MonoClient) private readonly client: MonoClient,
    @Inject(ImportService) private readonly imports: ImportService,
    @Inject(JOB_CLOCK) private readonly clock: JobClock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TodayService) private readonly today: TodayService,
  ) {}

  /** A freshly configured server installs its webhook now instead of waiting for 04:00. */
  onApplicationBootstrap(): void {
    if (!this.config.MONOBANK_TOKEN) return;
    void this.installWebhookOnly();
  }

  @Cron("0 4 * * *", { timeZone: "Europe/Kyiv" })
  async scheduledRun(): Promise<void> {
    try {
      await this.runDaily();
    } catch (e) {
      this.log.error(`daily reconcile failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** A quiet day has no webhook items: this keeps balances fresh and shows the bank is still in touch. */
  @Cron("30 * * * *", { timeZone: "Europe/Kyiv" })
  async hourlyRefresh(): Promise<void> {
    try {
      await this.refreshBalances();
    } catch (e) {
      this.log.warn(`hourly client-info refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** One client-info call (through the rate gate): balances and the contact time. Throws on failure. */
  async refreshBalances(): Promise<void> {
    if (!this.config.MONOBANK_TOKEN) return;
    await this.imports.syncAccounts(await this.client.clientInfo());
    await markContact(this.ds, new Date(this.clock.now()));
  }

  /** Last 7 days for every account, plus balances and the webhook check. Throws on failure. */
  async runDaily(): Promise<void> {
    if (!this.config.MONOBANK_TOKEN) {
      this.log.warn("reconcile and webhook install skipped: MONOBANK_TOKEN is not set");
      return;
    }
    const info = await this.client.clientInfo();
    await this.imports.syncAccounts(info);
    await this.ensureWebhook(info.webHookUrl);

    const toSec = Math.floor(this.clock.now() / 1000);
    const fromSec = toSec - RECONCILE_DAYS * DAY_S;
    // The cash wallet has no bank statement.
    const accounts = (await this.ds.getRepository(Account).find({ order: { id: "ASC" } })).filter((a) => a.kind !== "cash");
    const failures: string[] = [];
    for (const account of accounts) {
      try {
        const items = await this.client.statement(account.external_id, fromSec, toSec);
        for (const item of items) await this.imports.upsertStatementItem(account.id, item);
      } catch (e) {
        failures.push(`${account.external_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`reconcile failed for ${failures.length} account(s): ${failures.join("; ")}`);
    }
    await markSynced(this.ds, new Date(this.clock.now()));
    // The night's facts are in: the day's row is fixed on them (task Б3).
    await this.today.ensureSnapshot();
  }

  private async installWebhookOnly(): Promise<void> {
    try {
      const info = await this.client.clientInfo();
      await this.ensureWebhook(info.webHookUrl);
    } catch (e) {
      this.log.warn(`webhook check at startup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Re-registers the hook when monobank reports a different (or no) URL. */
  private async ensureWebhook(current: string | undefined): Promise<void> {
    const { MONO_WEBHOOK_SECRET: secret, PUBLIC_URL: base } = this.config;
    if (!secret || !base) {
      this.log.warn("webhook install skipped: MONO_WEBHOOK_SECRET or PUBLIC_URL is not set");
      return;
    }
    const ours = `${base}/mono/webhook/${secret}`;
    if (current === ours) return;
    await this.client.setWebhook(ours);
    this.log.log("monobank webhook was missing or foreign; installed ours");
  }
}
