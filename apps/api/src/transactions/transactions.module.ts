import { Module } from "@nestjs/common";
import { CashController } from "../cash/cash.controller";
import { CashService } from "../cash/cash.service";
import { MonoModule } from "../mono/mono.module";
import { PlanModule } from "../plan/plan.module";
import { TodayModule } from "../today/today.module";
import { TransactionsController } from "./transactions.controller";
import { TransactionsService } from "./transactions.service";

@Module({
  imports: [MonoModule, PlanModule, TodayModule],
  controllers: [TransactionsController, CashController],
  providers: [TransactionsService, CashService],
})
export class TransactionsModule {}
