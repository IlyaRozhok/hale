import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource as DS } from "typeorm";
import { createMigratedDatabase, createTestApp } from "./app";
import { JobRunner } from "../src/mono/jobs/job-runner";
import { ImportService } from "../src/mono/import.service";
import { ReconcileService } from "../src/mono/reconcile.service";

const SECRET = "webhook-secret-0123456789abcdef";
const hookItem = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  time: Math.floor(Date.now() / 1000) - 60,
  description: "Coffee",
  mcc: 5814,
  originalMcc: 5814,
  hold: true,
  amount: -5000,
  operationAmount: -5000,
  currencyCode: 980,
  commissionRate: 0,
  cashbackAmount: 0,
  balance: 100000,
  ...over,
});
const body = (account: string, statementItem: unknown) => ({
  type: "StatementItem",
  data: { account, statementItem },
});

const info = {
  clientId: "c",
  name: "n",
  webHookUrl: "",
  accounts: [{ id: "acc-1", balance: 100000, creditLimit: 0, type: "black", currencyCode: 980, maskedPan: [] }],
  jars: [],
};

let url: string;
let app: INestApplication;
let ds: DataSource;
let client: { clientInfo: ReturnType<typeof vi.fn>; statement: ReturnType<typeof vi.fn>; setWebhook: ReturnType<typeof vi.fn>; currency: ReturnType<typeof vi.fn> };

beforeAll(async () => {
  url = await createMigratedDatabase();
  ds = new DS({ type: "postgres", url });
  await ds.initialize();
});
afterAll(async () => {
  await ds.destroy();
});
beforeEach(async () => {
  await ds.query("TRUNCATE jobs, transactions, accounts, fx_rates RESTART IDENTITY CASCADE");
  await ds.query("UPDATE settings SET last_sync_at = NULL");
  client = {
    clientInfo: vi.fn(async () => info),
    statement: vi.fn(async () => []),
    setWebhook: vi.fn(async () => {}),
    currency: vi.fn(async () => []),
  };
  app = await createTestApp(url, { config: { MONO_WEBHOOK_SECRET: SECRET }, client });
  await ds.query(
    `INSERT INTO accounts (external_id, kind, currency, balance) VALUES ('acc-1','black','UAH',100000)`,
  );
});
afterEach(async () => {
  await app.close();
});

const http = () => app.getHttpServer();

describe("webhook route", () => {
  it("answers 404 for a wrong secret on GET and POST", async () => {
    await request(http()).get("/mono/webhook/wrong").expect(404);
    await request(http()).post("/mono/webhook/wrong").send(body("acc-1", hookItem("a"))).expect(404);
    expect(await ds.query("SELECT 1 FROM jobs WHERE kind='webhook.item'")).toHaveLength(0);
  });

  it("answers 404 when no secret is configured", async () => {
    await app.close();
    app = await createTestApp(url, { client });
    await request(http()).get("/mono/webhook/anything").expect(404);
  });

  it("answers GET with the right secret with 200, no auth header needed", async () => {
    await request(http()).get(`/mono/webhook/${SECRET}`).expect(200);
  });

  it("POST answers 200 and only queues a job; the job writes the row", async () => {
    await request(http()).post(`/mono/webhook/${SECRET}`).send(body("acc-1", hookItem("w1"))).expect(200);
    expect(await ds.query("SELECT 1 FROM transactions")).toHaveLength(0);
    const jobs = await ds.query("SELECT kind, status FROM jobs WHERE kind='webhook.item'");
    expect(jobs).toHaveLength(1);

    await app.get(JobRunner).runOnce();
    const tx = await ds.query("SELECT external_id, hold FROM transactions");
    expect(tx).toEqual([{ external_id: "w1", hold: true }]);
    const [s] = await ds.query("SELECT last_sync_at FROM settings");
    expect(s.last_sync_at).not.toBeNull();
  });

  it("returns 200 without a job for other types, bad shapes and invalid JSON", async () => {
    const url2 = `/mono/webhook/${SECRET}`;
    await request(http()).post(url2).send({ type: "Other", data: {} }).expect(200);
    await request(http()).post(url2).send({ type: "StatementItem", data: { account: "x" } }).expect(200);
    await request(http()).post(url2).send({}).expect(200);
    await request(http()).post(url2).set("Content-Type", "application/json").send("{not json").expect(200);
    await request(http()).post("/mono/webhook/wrong").set("Content-Type", "application/json").send("{not json").expect(404);
    await request(http()).post("/mono/webhook/%").set("Content-Type", "application/json").send("{not json").expect(404);
    expect(await ds.query("SELECT 1 FROM jobs WHERE kind='webhook.item'")).toHaveLength(0);
  });

  it("one id from webhook then reconcile is one row; new amount and hold false win", async () => {
    await request(http()).post(`/mono/webhook/${SECRET}`).send(body("acc-1", hookItem("same"))).expect(200);
    await app.get(JobRunner).runOnce();
    await app.close();
    app = await createTestApp(url, { config: { MONO_WEBHOOK_SECRET: SECRET, MONOBANK_TOKEN: "tok" }, client });
    client.clientInfo.mockClear();
    client.statement.mockResolvedValueOnce([hookItem("same", { hold: false, amount: -5200 })]);
    await app.get(ReconcileService).runDaily();
    const rows = await ds.query("SELECT amount, amount_uah, hold FROM transactions");
    expect(rows).toEqual([{ amount: "-5200", amount_uah: "-5200", hold: false }]);
  });

  it("refreshes accounts once for an unknown account, then processes the item", async () => {
    await ds.query("DELETE FROM accounts");
    await request(http()).post(`/mono/webhook/${SECRET}`).send(body("acc-1", hookItem("n1"))).expect(200);
    await app.get(JobRunner).runOnce();
    expect(client.clientInfo).toHaveBeenCalledTimes(1);
    expect(await ds.query("SELECT 1 FROM transactions")).toHaveLength(1);
  });

  it("fails visibly (job error, no row) when the account is still unknown", async () => {
    await request(http()).post(`/mono/webhook/${SECRET}`).send(body("ghost", hookItem("g1"))).expect(200);
    await app.get(JobRunner).runOnce();
    expect(client.clientInfo).toHaveBeenCalledTimes(1);
    expect(await ds.query("SELECT 1 FROM transactions")).toHaveLength(0);
    const [j] = await ds.query("SELECT status, attempts, last_error FROM jobs WHERE kind='webhook.item'");
    expect(j.attempts).toBe(1);
    expect(j.last_error).toMatch(/ghost/);
  });
});

describe("POST /mono/import", () => {
  const login = async () => {
    const { TEST_PASSWORD } = await import("./app");
    const r = await request(http()).post("/auth/login").send({ password: TEST_PASSWORD, deviceName: "t" });
    return r.body.token as string;
  };

  it("requires owner auth", async () => {
    await request(http()).post("/mono/import").send({ from: "2025-01-01" }).expect(401);
  });

  it("rejects bad dates with 400 and starts the history import for a good one", async () => {
    await app.close();
    app = await createTestApp(url, { config: { MONOBANK_TOKEN: "tok" }, client });
    const token = await login();
    const auth = { Authorization: `Bearer ${token}` };
    await request(http()).post("/mono/import").set(auth).send({ from: "2025-13-45" }).expect(400);
    await request(http()).post("/mono/import").set(auth).send({}).expect(400);
    const spy = vi.spyOn(app.get(ImportService), "enqueueHistory").mockResolvedValue();
    await request(http()).post("/mono/import").set(auth).send({ from: "2025-01-01" }).expect(202);
    expect(spy).toHaveBeenCalledWith(new Date("2025-01-01T00:00:00+02:00"));
  });
});
