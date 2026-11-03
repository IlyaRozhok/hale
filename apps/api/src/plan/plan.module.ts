import { Module } from "@nestjs/common";
import { PlanController, SettingsController } from "./plan.controller";
import { TodayModule } from "../today/today.module";
import { LoansService } from "./loans.service";
import { PlanService } from "./plan.service";

@Module({
  imports: [TodayModule],
  controllers: [PlanController, SettingsController],
  providers: [PlanService, LoansService],
  exports: [PlanService],
})
export class PlanModule {}
