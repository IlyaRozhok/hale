import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { TodayModule } from "../today/today.module";
import { DevicesController } from "./devices.controller";
import { EXPO_FETCH, ExpoPush, type FetchLike } from "./expo-push";
import { NotificationsService } from "./notifications.service";

@Module({
  imports: [ScheduleModule.forRoot(), TodayModule],
  controllers: [DevicesController],
  providers: [
    { provide: EXPO_FETCH, useValue: ((url, init) => fetch(url, init)) satisfies FetchLike },
    ExpoPush,
    NotificationsService,
  ],
})
export class NotificationsModule {}
