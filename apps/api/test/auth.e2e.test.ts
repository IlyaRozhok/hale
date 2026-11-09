import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";

describe("auth (e2e, real Postgres)", () => {
  let dbUrl: string;
  let app: INestApplication;

  beforeAll(async () => {
    dbUrl = await createMigratedDatabase();
  });
  // Fresh app per test so the in-memory login throttle starts clean.
  beforeEach(async () => {
    app = await createTestApp(dbUrl);
  });
  afterEach(async () => {
    await app.close();
  });

  it("GET /health is public and returns 200", async () => {
    await request(app.getHttpServer()).get("/health").expect(200);
  });

  it("rejects an unknown password with 401", async () => {
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ password: "nope", deviceName: "iPhone" })
      .expect(401);
  });

  it("rejects a malformed login body with 400", async () => {
    await request(app.getHttpServer()).post("/auth/login").send({}).expect(400);
  });

  it("returns 429 after five wrong passwords in a row", async () => {
    const http = app.getHttpServer();
    for (let i = 0; i < 5; i++) {
      await request(http)
        .post("/auth/login")
        .send({ password: "wrong", deviceName: "iPhone" })
        .expect(401);
    }
    // even the right password is refused while locked out
    await request(http)
      .post("/auth/login")
      .send({ password: TEST_PASSWORD, deviceName: "iPhone" })
      .expect(429);
  });

  it("a successful login resets the failure counter", async () => {
    const http = app.getHttpServer();
    for (let i = 0; i < 4; i++) {
      await request(http).post("/auth/login").send({ password: "wrong", deviceName: "x" }).expect(401);
    }
    await request(http)
      .post("/auth/login")
      .send({ password: TEST_PASSWORD, deviceName: "x" })
      .expect(201);
    for (let i = 0; i < 4; i++) {
      await request(http).post("/auth/login").send({ password: "wrong", deviceName: "x" }).expect(401);
    }
  });

  it("guards protected routes: 401 without token, 200 with a device token", async () => {
    const http = app.getHttpServer();
    await request(http).get("/auth/me").expect(401);
    await request(http).get("/auth/me").set("Authorization", "Bearer garbage").expect(401);

    const login = await request(http)
      .post("/auth/login")
      .send({ password: TEST_PASSWORD, deviceName: "Ilya's iPhone" })
      .expect(201);
    const token = login.body.token as string;
    expect(typeof token).toBe("string");

    const me = await request(http).get("/auth/me").set("Authorization", `Bearer ${token}`).expect(200);
    expect(me.body).toEqual({ deviceName: "Ilya's iPhone" });
  });

  it("stores only a hash of the device token", async () => {
    const http = app.getHttpServer();
    const login = await request(http)
      .post("/auth/login")
      .send({ password: TEST_PASSWORD, deviceName: "hash-check" })
      .expect(201);
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    const { rows } = await client.query("SELECT token_hash FROM devices WHERE name = 'hash-check'");
    await client.end();
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(login.body.token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("issues device tokens that expire in 90 days", async () => {
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ password: TEST_PASSWORD, deviceName: "ttl-check" })
      .expect(201);
    const payload = JSON.parse(
      Buffer.from((login.body.token as string).split(".")[1]!, "base64url").toString("utf8"),
    ) as { iat: number; exp: number };
    expect(payload.exp - payload.iat).toBe(90 * 24 * 60 * 60);
  });
});
