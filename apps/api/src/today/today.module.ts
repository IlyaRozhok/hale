import { Module } from "@nestjs/common";
import { Clock } from "./clock";
import { LimitService } from "./limit.service";
import { TodayController } from "./today.controller";
import { TodayService } from "./today.service";

@Module({
  controllers: [TodayController],
  providers: [Clock, TodayService, LimitService],
  exports: [TodayService, LimitService, Clock],
})
export class TodayModule {}
