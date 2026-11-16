import { Module } from "@nestjs/common";
import { TodayModule } from "../today/today.module";
import { InsightsController } from "./insights.controller";
import { InsightsService } from "./insights.service";

/** Task В1: «Итоги», in their own module (audit, section 7). TodayModule gives the one Clock. */
@Module({
  imports: [TodayModule],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
