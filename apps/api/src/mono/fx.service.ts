import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { DataSource } from "typeorm";
import { APP_CONFIG } from "../config.module";
import type { AppConfig } from "../config";
import { CURRENCY_ALPHA } from "../domain/money";
import { JOB_CLOCK, type JobClock } from "./jobs/job-runner";
import { MonoClient } from "./mono.client";

const UAH = 980;
export const FX_REFRESH_MS = 3_600_000;

/** Hourly /bank/currency into fx_rates. The endpoint is public: no token needed. */
@Injectable()
export class FxService implements OnApplicationBootstrap {
  private readonly log = new Logger(FxService.name);

  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(MonoClient) private readonly client: MonoClient,
    @Inject(JOB_CLOCK) private readonly clock: JobClock,
    @Inject(APP_CONFIG) private readonly config?: AppConfig,
  ) {}

  /** Fill rates at boot, but only on a configured server so tests never hit the network. */
  onApplicationBootstrap(): void {
    if (this.config?.MONOBANK_TOKEN) void this.refresh();
  }

  @Interval(FX_REFRESH_MS)
  async tick(): Promise<void> {
    await this.refresh();
  }

  /** Never throws: on any failure the old rows stay and the next hour tries again. */
  async refresh(): Promise<void> {
    try {
      const rates = await this.client.currency();
      const fetchedAt = new Date(this.clock.now());
      const rows: [string, number][] = [];
      for (const r of rates) {
        const code = CURRENCY_ALPHA[r.currencyCodeA];
        if (r.currencyCodeB !== UAH || r.currencyCodeA === UAH || !code) continue;
        const rate =
          r.rateBuy && r.rateSell ? (r.rateBuy + r.rateSell) / 2 : r.rateCross;
        if (!rate || rate <= 0) continue;
        rows.push([code, rate]);
      }
      await this.ds.transaction(async (m) => {
        for (const [currency, rate] of rows) {
          await m.query(
            `INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ($1,$2,$3)
             ON CONFLICT DO NOTHING`,
            [currency, fetchedAt, rate],
          );
        }
      });
    } catch (e) {
      this.log.warn(`currency refresh failed, keeping old rates: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
