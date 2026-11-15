import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { TodayModule } from "../today/today.module";
import { CheckController } from "./check.controller";
import { LedgerCheckService } from "./check.service";
import { ScreenSpent } from "./screen-spent";

/** Task Б11: the nightly ledger check. TodayModule gives the one Clock. */
@Module({
  imports: [ScheduleModule.forRoot(), TodayModule],
  controllers: [CheckController],
  providers: [LedgerCheckService, ScreenSpent],
})
export class CheckModule {}
