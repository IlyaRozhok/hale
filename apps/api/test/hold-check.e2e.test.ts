import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_PASSWORD, createMigratedDatabase, createTestApp } from "./app";
import { HoldCheckService } from "../src/mono/hold-check.service";

const FROM_S = Date.parse("2026-10-01T00:00:00+03:00") / 1000;
const DAY = 86_400;

const item = (id: string, time: number, over: Record<string, unknown> = {}) => ({
  id, time, description: "Uklon", mcc: 4121, originalMcc: 4121, hold: true,
  amount: -15_000, operationAmount: -15_000, currencyCode: 980, commissionRate: 0, cashbackAmount: 0,
  balance: 1, ...over,
});

let url: string;
let app: INestApplication;
let ds: DataSource;
let client: { clientInfo: ReturnType<typeof vi.fn>; statement: ReturnType<typeof vi.fn>; setWebhook: ReturnType<typeof vi.fn>; currency: ReturnType<typeof vi.fn> };

beforeAll(async () => {
  url = await createMigratedDatabase();
  ds = new DataSource({ type: "postgres", url });
  await ds.initialize();
});
afterAll(async () => {
  await ds.destroy();
});
beforeEach(async () => {
  await ds.query("TRUNCATE jobs, transactions, accounts, fx_rates, devices RESTART IDENTITY CASCADE");
  await ds.query("UPDATE settings SET last_sync_at = NULL, last_contact_at = NULL");
  client = {
    clientInfo: vi.fn(async () => ({ clientId: "c", name: "n", webHookUrl: "", accounts: [], jars: [] })),
    statement: vi.fn(async () => []),
    setWebhook: vi.fn(async () => {}),
    currency: vi.fn(async () => []),
  };
  app = await createTestApp(url, { config: { MONOBANK_TOKEN: "tok" }, client });
  await ds.query(
    `INSERT INTO accounts (external_id, kind, currency, balance) VALUES ('acc-1','black','UAH',100000), ('manual:cash','cash','UAH',0)`,
  );
  await ds.query(
    `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, mcc, amount, amount_uah, hold, raw)
     SELECT 'h1', id, to_timestamp($1), '2026-10-02', 'Uklon', 4121, -15000, -15000, true, '{}' FROM accounts WHERE external_id='acc-1'`,
    [FROM_S + DAY],
  );
});
afterEach(async () => {
  await app.close();
});

const http = () => app.getHttpServer();
const login = async () => {
  const r = await request(http()).post("/auth/login").send({ password: TEST_PASSWORD, deviceName: "t" });
  return { Authorization: `Bearer ${r.body.token as string}` };
};

/** Every row of every public table, order-independent. */
async function snapshot(): Promise<Record<string, string[]>> {
  const tables: { table_name: string }[] = await ds.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`,
  );
  const out: Record<string, string[]> = {};
  for (const { table_name } of tables) {
    const rows: unknown[] = await ds.query(`SELECT * FROM "${table_name}"`);
    out[table_name] = rows.map((r) => JSON.stringify(r)).sort();
  }
  return out;
}

describe("/mono/hold-check", () => {
  it("без входа запрос отклоняется: 401 on both routes", async () => {
    await request(http()).post("/mono/hold-check").send({ from: "2026-10-01" }).expect(401);
    await request(http()).get("/mono/hold-check").expect(401);
    expect(client.statement).not.toHaveBeenCalled();
  });

  it("answers 400 for a bad date and 503 without MONOBANK_TOKEN", async () => {
    const auth = await login();
    await request(http()).post("/mono/hold-check").set(auth).send({ from: "2026-13-45" }).expect(400);
    await request(http()).post("/mono/hold-check").set(auth).send({}).expect(400);
    await app.close();
    app = await createTestApp(url, { client });
    const auth2 = await login();
    await request(http()).post("/mono/hold-check").set(auth2).send({ from: "2026-10-01" }).expect(503);
    expect(client.statement).not.toHaveBeenCalled();
  });

  it("в базу ничего не пишется: the tables are the same after a run to done", async () => {
    client.statement.mockResolvedValue([item("h1", FROM_S + DAY, { hold: false })]);
    const auth = await login();
    // Startup may have asked for client-info (the webhook check); the hold check itself must not.
    const infoCalls = client.clientInfo.mock.calls.length;
    const before = await snapshot();
    expect(Object.keys(before)).toContain("transactions");
    expect(Object.keys(before)).toContain("jobs");

    const idle = await request(http()).get("/mono/hold-check").set(auth).expect(200);
    expect(idle.body).toEqual({ status: "idle" });

    const started = await request(http()).post("/mono/hold-check").set(auth).send({ from: "2026-10-01" }).expect(202);
    expect(started.body.started).toBe(true);
    await app.get(HoldCheckService).settled();

    const done = await request(http()).get("/mono/hold-check").set(auth).expect(200);
    expect(done.body.status).toBe("done");
    expect(done.body.result).toMatchObject({
      period: { from: "2026-10-01" }, accounts: 1, holdRows: 1, holdSettled: 1, windowsUnread: 0,
    });
    expect(client.statement.mock.calls.every((c) => c[0] === "acc-1")).toBe(true);
    expect(client.clientInfo.mock.calls.length).toBe(infoCalls);
    expect(client.setWebhook).not.toHaveBeenCalled();

    expect(await snapshot()).toEqual(before);
  });

  it("does not start a second time after done; answers the current state", async () => {
    const auth = await login();
    await request(http()).post("/mono/hold-check").set(auth).send({ from: "2026-10-01" }).expect(202);
    await app.get(HoldCheckService).settled();
    const calls = client.statement.mock.calls.length;
    const again = await request(http()).post("/mono/hold-check").set(auth).send({ from: "2026-10-01" }).expect(202);
    expect(again.body.started).toBe(false);
    expect(again.body.state.status).toBe("done");
    await app.get(HoldCheckService).settled();
    expect(client.statement.mock.calls.length).toBe(calls);
  });
});
