import { Inject, Injectable, Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { TodayService } from "./today.service";

/** What the person changed, as the log names it: a limit that moved mid-day can then be traced to its cause. */
export type LimitReason = "plan" | "income" | "payment_paid" | "loan" | "cash" | "binance" | "settings" | "tax_estimate" | "accounts";

/**
 * The one place a change by the person's own hand reaches the day's limit (task Б4; the owner's decision of
 * 11 November, risk 7 of the audit): the plan, the settings, Binance, a loan, «Оплачено». Each such change calls
 * `invalidate(reason)` and the day is fixed afresh from the current facts at once — in the caller's transaction
 * when it gives one, so the change and the new limit are seen together, and never with a moment without the row.
 * Money that arrives on its own (a bank credit, a rate) does not come here: the day keeps its morning limit.
 */
@Injectable()
export class LimitService {
  private readonly log = new Logger(LimitService.name);

  constructor(@Inject(TodayService) private readonly today: TodayService) {}

  async invalidate(reason: LimitReason, m?: EntityManager): Promise<void> {
    this.log.log(`day limit fixed afresh: ${reason}`);
    await this.today.refix(m);
  }
}
