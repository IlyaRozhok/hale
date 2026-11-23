import { BadRequestException, Controller, Delete, Get, HttpCode, Inject, Param, Put, Query } from "@nestjs/common";
import { counterKeyParam, insightsMonthQuery, type InsightsMonthDto } from "@hale/contracts";
import { InsightsService } from "./insights.service";

/** Task В1: «Итоги». Owner-authenticated by the global guard (not `@Public()`); read only, but for the «Не подписка» marks (ЯМ6). */
@Controller("insights")
export class InsightsController {
  constructor(@Inject(InsightsService) private readonly insights: InsightsService) {}

  /** Without `month`, the current Kyiv month. A month that has not started is refused. */
  @Get("month")
  month(@Query() query: unknown): Promise<InsightsMonthDto> {
    const r = insightsMonthQuery.safeParse(query);
    if (!r.success) throw new BadRequestException("month: expected YYYY-MM");
    return this.insights.month(r.data.month);
  }

  /** Task ЯМ6: «Не подписка» — the place `key` is never found as a subscription again. Idempotent. */
  @Put("not-subscriptions/:key")
  @HttpCode(204)
  async markNotSubscription(@Param("key") key: string): Promise<void> {
    await this.insights.markNotSubscription(parseKey(key));
  }

  /** Task ЯМ6: «Вернуть» — the place `key` may be a subscription again. Idempotent. */
  @Delete("not-subscriptions/:key")
  @HttpCode(204)
  async unmarkNotSubscription(@Param("key") key: string): Promise<void> {
    await this.insights.unmarkNotSubscription(parseKey(key));
  }
}

function parseKey(key: string): string {
  const r = counterKeyParam.safeParse(key);
  if (!r.success) throw new BadRequestException("key: expected 16 hex characters");
  return r.data;
}
