import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { APP_CONFIG } from "../config.module";
import type { AppConfig } from "../config";
import { FxService } from "./fx.service";
import { ImportService } from "./import.service";
import { JOB_CLOCK, JobRunner } from "./jobs/job-runner";
import { MonoClient } from "./mono.client";
import { MonoController } from "./mono.controller";
import { OWN_IDENTITY, ReclassifyService } from "../transactions/reclassify.service";
import { PlanModule } from "../plan/plan.module";
import { RateGate } from "./rate-gate";
import { ReconcileService } from "./reconcile.service";
import { WebhookBodyErrorFilter } from "./webhook-body.filter";
import { WebhookController } from "./webhook.controller";
import { WebhookService } from "./webhook.service";

/** Single RateGate and MonoClient for the whole app, so the 60 s spacing is global. */
@Module({
  imports: [ScheduleModule.forRoot(), PlanModule],
  providers: [
    RateGate,
    {
      provide: MonoClient,
      inject: [APP_CONFIG, RateGate],
      useFactory: (config: AppConfig, gate: RateGate) =>
        new MonoClient({ token: config.MONOBANK_TOKEN, gate }),
    },
    { provide: JOB_CLOCK, useValue: { now: () => Date.now() } },
    JobRunner,
    {
      provide: OWN_IDENTITY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ ownNames: config.OWNER_NAMES, ownIbans: [], ownJars: [] }),
    },
    ReclassifyService,
    ImportService,
    WebhookService,
    ReconcileService,
    FxService,
    { provide: APP_FILTER, useClass: WebhookBodyErrorFilter },
  ],
  controllers: [WebhookController, MonoController],
  exports: [MonoClient, RateGate, ImportService, JobRunner, ReclassifyService],
})
export class MonoModule {}
