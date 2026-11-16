import { BadRequestException, Controller, Get, Inject, Query } from "@nestjs/common";
import { insightsMonthQuery, type InsightsMonthDto } from "@hale/contracts";
import { InsightsService } from "./insights.service";

/** Task В1: «Итоги». Owner-authenticated by the global guard (not `@Public()`); read only. */
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
}
