import { Module } from "@nestjs/common";
import { PlanController, SettingsController } from "./plan.controller";
import { PlanService } from "./plan.service";

@Module({
  controllers: [PlanController, SettingsController],
  providers: [PlanService],
  exports: [PlanService],
})
export class PlanModule {}
