import { type DynamicModule, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "./auth/auth.module";
import type { AppConfig } from "./config";
import { ConfigModule } from "./config.module";
import { entities } from "./db/entities";
import { migrations } from "./db/data-source";
import { HealthController } from "./health.controller";
import { MonoModule } from "./mono/mono.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PlanModule } from "./plan/plan.module";
import { TodayModule } from "./today/today.module";
import { TransactionsModule } from "./transactions/transactions.module";
// After the modules above: it reaches into today/, which must load in its usual order first.
import { InsightsModule } from "./insights/insights.module";
// Last: it reaches into today/ and cash/, which must load in their usual order first.
import { CheckModule } from "./check/check.module";

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        TypeOrmModule.forRoot({
          type: "postgres",
          url: config.DATABASE_URL,
          entities,
          migrations,
          synchronize: false,
        }),
        AuthModule,
        MonoModule,
        NotificationsModule,
        PlanModule,
        TodayModule,
        TransactionsModule,
        InsightsModule,
        CheckModule,
      ],
      controllers: [HealthController],
    };
  }
}
