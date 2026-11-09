import { Controller, Get, HttpStatus, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { DataSource } from "typeorm";
import { Public } from "./auth/public.decorator";

const DB_TIMEOUT_MS = 2000;

type Health = { status: "ok"; db: "ok" } | { status: "error"; db: "down" };

/**
 * Liveness + readiness in one: answers 200 only when Postgres answers
 * `SELECT 1`. infra/deploy.sh, infra/rollback.sh, the compose healthcheck and
 * the external uptime monitor all rely on this meaning "the app really works".
 */
@Controller("health")
export class HealthController {
  constructor(@Inject(DataSource) private readonly ds: DataSource) {}

  @Public()
  @Get()
  async health(@Res({ passthrough: true }) res: Response): Promise<Health> {
    try {
      await withTimeout(this.ds.query("SELECT 1"), DB_TIMEOUT_MS);
      return { status: "ok", db: "ok" };
    } catch {
      // No error details: /health is public.
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: "error", db: "down" };
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("db timeout")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
