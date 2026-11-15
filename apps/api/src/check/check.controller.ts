import { Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import type { LedgerCheckDto } from "@hale/contracts";
import { LedgerCheckService } from "./check.service";

/**
 * Task Б11: the ledger check. Owner-authenticated by the global guard (not `@Public()`). A run by hand works with
 * the nightly check off (for the owner to try it once); the latest result is given out only while it is on.
 */
@Controller("check")
export class CheckController {
  constructor(@Inject(LedgerCheckService) private readonly check: LedgerCheckService) {}

  @Post("run")
  @HttpCode(200)
  run(): Promise<LedgerCheckDto> {
    return this.check.run();
  }

  /** An empty answer when there is no result to show. */
  @Get("latest")
  latest(): Promise<LedgerCheckDto | null> {
    return this.check.latest();
  }
}
