import { Module } from "@nestjs/common";
import { Clock } from "./clock";
import { TodayController } from "./today.controller";
import { TodayService } from "./today.service";

@Module({
  controllers: [TodayController],
  providers: [Clock, TodayService],
  exports: [TodayService, Clock],
})
export class TodayModule {}
