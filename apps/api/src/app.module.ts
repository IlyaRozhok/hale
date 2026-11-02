import { type DynamicModule, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "./auth/auth.module";
import type { AppConfig } from "./config";
import { ConfigModule } from "./config.module";
import { entities } from "./db/entities";
import { migrations } from "./db/data-source";
import { HealthController } from "./health.controller";
import { MonoModule } from "./mono/mono.module";
import { PlanModule } from "./plan/plan.module";
import { TodayModule } from "./today/today.module";
import { TransactionsModule } from "./transactions/transactions.module";

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
        PlanModule,
        TodayModule,
        TransactionsModule,
      ],
      controllers: [HealthController],
    };
  }
}
