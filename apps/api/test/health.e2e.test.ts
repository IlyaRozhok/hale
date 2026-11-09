import type { INestApplication } from "@nestjs/common";
import pg from "pg";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createMigratedDatabase, createTestApp } from "./app";

describe("GET /health (e2e, real Postgres)", () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close().catch(() => undefined);
    app = undefined;
  });

  it("returns 200 with db ok when the database answers", async () => {
    app = await createTestApp(await createMigratedDatabase());
    const res = await request(app.getHttpServer()).get("/health").expect(200);
    expect(res.body).toEqual({ status: "ok", db: "ok" });
  });

  it("returns 503 when the database is unreachable", async () => {
    const url = await createMigratedDatabase();
    app = await createTestApp(url);
    // Kill the database under the running app: every pooled connection dies
    // and new ones are refused.
    const name = new URL(url).pathname.slice(1);
    const admin = new pg.Client({ connectionString: inject("pgAdminUrl") });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
    const res = await request(app.getHttpServer()).get("/health").expect(503);
    expect(res.body).toMatchObject({ status: "error", db: "down" });
  });
});
