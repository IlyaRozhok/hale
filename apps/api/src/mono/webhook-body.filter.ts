import { type ArgumentsHost, Catch, HttpException, Inject, Logger } from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import type { Request, Response } from "express";
import { APP_CONFIG } from "../config.module";
import type { AppConfig } from "../config";
import { secretMatches } from "./webhook.controller";

const BODY_ERROR_STATUSES = new Set([400, 413, 415]);
const WEBHOOK_PATH = /^\/mono\/webhook\/([^/?]+)/;

/**
 * Express rejects unparsable JSON before any controller runs, which would answer monobank
 * with 400 and eventually get the hook disabled. For a request carrying the right secret
 * that body error becomes a logged 200; a wrong secret still gets 404. Everything else
 * falls through to Nest's default handling.
 */
@Catch()
export class WebhookBodyErrorFilter extends BaseExceptionFilter {
  private readonly log = new Logger("WebhookBody");

  constructor(
    @Inject(HttpAdapterHost) adapterHost: HttpAdapterHost,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super(adapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === "http") {
      const http = host.switchToHttp();
      const req = http.getRequest<Request>();
      const match = WEBHOOK_PATH.exec(req.path ?? "");
      // The webhook controller never throws these itself, so on a POST to this route they
      // can only come from the body parser (invalid JSON, too large, wrong content type).
      if (
        match &&
        req.method === "POST" &&
        exception instanceof HttpException &&
        BODY_ERROR_STATUSES.has(exception.getStatus())
      ) {
        const res = http.getResponse<Response>();
        if (secretMatches(decodeURIComponent(match[1]!), this.config.MONO_WEBHOOK_SECRET)) {
          this.log.warn(`webhook ignored: unreadable body (${exception.getStatus()})`);
          res.status(200).end();
        } else {
          res.status(404).json({ statusCode: 404, message: "Not Found" });
        }
        return;
      }
    }
    super.catch(exception, host);
  }
}
