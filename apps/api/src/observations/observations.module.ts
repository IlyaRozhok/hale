import { Module } from "@nestjs/common";
import { TodayModule } from "../today/today.module";
import { ObservationsController } from "./observations.controller";
import { ObservationsService } from "./observations.service";

/** Task В7: observations in the phrase of the day, in their own module. TodayModule gives the Clock and the day's mode. */
@Module({
  imports: [TodayModule],
  controllers: [ObservationsController],
  providers: [ObservationsService],
})
export class ObservationsModule {}
