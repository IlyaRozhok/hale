import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import { z } from "zod";
import { APP_CONFIG } from "../config.module";
import type { AppConfig } from "../config";
import { KYIV_TZ } from "../time/clock";
import { ImportService } from "./import.service";

/** `{ from: "YYYY-MM-DD" }`: the body of the import route and of the hold check (Б6). */
export const fromDateBody = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** Midnight Kyiv on that date; null for impossible dates such as 2025-13-45. */
export function kyivMidnight(ymd: string): Date | null {
  for (const offset of ["+03:00", "+02:00"]) {
    const d = new Date(`${ymd}T00:00:00${offset}`);
    if (Number.isNaN(d.getTime())) return null;
    const kyiv = new Intl.DateTimeFormat("en-CA", {
      timeZone: KYIV_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
    if (kyiv.startsWith(`${ymd}, 00:00`) || kyiv.startsWith(`${ymd}, 24:00`)) return d;
  }
  return null;
}

@Controller("mono")
export class MonoController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ImportService) private readonly imports: ImportService,
  ) {}

  /** Owner-authenticated (global guard): queues the resumable history import. */
  @Post("import")
  @HttpCode(202)
  async startImport(@Body() body: unknown): Promise<{ status: "queued" }> {
    const parsed = fromDateBody.safeParse(body);
    const from = parsed.success ? kyivMidnight(parsed.data.from) : null;
    if (!from) throw new BadRequestException("from must be a real date, YYYY-MM-DD");
    if (!this.config.MONOBANK_TOKEN) {
      throw new ServiceUnavailableException("MONOBANK_TOKEN is not configured");
    }
    await this.imports.enqueueHistory(from);
    return { status: "queued" };
  }
}
