import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { APP_CONFIG } from "../config.module";
import type { AppConfig } from "../config";
import { ImportService } from "./import.service";
import { JOB_CLOCK, JobRunner } from "./jobs/job-runner";
import { MonoClient } from "./mono.client";
import { RateGate } from "./rate-gate";

/** Single RateGate and MonoClient for the whole app, so the 60 s spacing is global. */
@Module({
  imports: [ScheduleModule.forRoot()],
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
    ImportService,
  ],
  exports: [MonoClient, RateGate, ImportService, JobRunner],
})
export class MonoModule {}
