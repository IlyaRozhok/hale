import { Module } from "@nestjs/common";
import { PlanController, SettingsController } from "./plan.controller";
import { TodayModule } from "../today/today.module";
import { PlanService } from "./plan.service";

@Module({
  imports: [TodayModule],
  controllers: [PlanController, SettingsController],
  providers: [PlanService],
  exports: [PlanService],
})
export class PlanModule {}
