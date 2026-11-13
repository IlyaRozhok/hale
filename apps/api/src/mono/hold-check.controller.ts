import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import { APP_CONFIG } from "../config.module";
import type { AppConfig } from "../config";
import { type HoldCheckState, HoldCheckService } from "./hold-check.service";
import { fromDateBody, kyivMidnight } from "./mono.controller";

/**
 * Task Б6, step 2: the one-off hold check. Owner-authenticated by the global guard (not `@Public()`).
 * To be removed by a separate PR once the owner has read the result.
 */
@Controller("mono")
export class HoldCheckController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HoldCheckService) private readonly check: HoldCheckService,
  ) {}

  /** Starts the check from the Kyiv day `from`; answers at once. A second call returns the current state. */
  @Post("hold-check")
  @HttpCode(202)
  start(@Body() body: unknown): { started: boolean; state: HoldCheckState } {
    const parsed = fromDateBody.safeParse(body);
    const from = parsed.success ? kyivMidnight(parsed.data.from) : null;
    if (!from) throw new BadRequestException("from must be a real date, YYYY-MM-DD");
    if (!this.config.MONOBANK_TOKEN) {
      throw new ServiceUnavailableException("MONOBANK_TOKEN is not configured");
    }
    return this.check.start(from);
  }

  @Get("hold-check")
  state(): HoldCheckState {
    return this.check.state();
  }
}
