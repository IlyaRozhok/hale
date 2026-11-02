import { createHash, timingSafeEqual } from "node:crypto";
import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { APP_CONFIG } from "../config.module";
import type { AppConfig } from "../config";
import { WebhookService } from "./webhook.service";

const digest = (v: string) => createHash("sha256").update(v).digest();

/** Compares digests, so length differences leak nothing and the compare is constant time. */
export function secretMatches(given: string, expected: string | undefined): boolean {
  if (!expected) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

/** Public: monobank calls it without our JWT; the path secret is the credential. */
@Public()
@Controller("mono/webhook")
export class WebhookController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(WebhookService) private readonly webhook: WebhookService,
  ) {}

  /** monobank probes the URL with GET when the hook is set. */
  @Get(":secret")
  @HttpCode(200)
  check(@Param("secret") secret: string): void {
    this.assertSecret(secret);
  }

  /** Only writes a job row, then answers; processing happens in the job runner. */
  @Post(":secret")
  @HttpCode(200)
  async receive(@Param("secret") secret: string, @Body() body: unknown): Promise<void> {
    this.assertSecret(secret);
    await this.webhook.accept(body);
  }

  private assertSecret(secret: string): void {
    if (!secretMatches(secret, this.config.MONO_WEBHOOK_SECRET)) throw new NotFoundException();
  }
}
