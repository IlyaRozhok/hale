import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { createMigratedDatabase } from "../../test/app";
import { createDataSource } from "../db/data-source";
import { FxService } from "./fx.service";
import { ImportService } from "./import.service";
import { JobRunner } from "./jobs/job-runner";
import type { MonoClient } from "./mono.client";
import type { MonoStatementItem } from "./mono.schemas";
import { ReconcileService } from "./reconcile.service";

const NOW_MS = Date.UTC(2026, 10, 2, 12, 0, 0);
const clock = { now: () => NOW_MS };
const SECRET = "webhook-secret-0123456789abcdef";
const OUR_URL = `https://tablo.example.com/mono/webhook/${SECRET}`;

const stmt = (id: string, over: Partial<MonoStatementItem> = {}): MonoStatementItem => ({
  id, time: NOW_MS / 1000 - 3600, description: "Shop", mcc: 5411, originalMcc: 5411, hold: false,
  amount: -1000, operationAmount: -1000, currencyCode: 980, commissionRate: 0, cashbackAmount: 0,
  balance: 1, ...over,
});

let ds: DataSource;
beforeAll(async () => {
  ds = createDataSource(await createMigratedDatabase());
  await ds.initialize();
});
afterAll(async () => {
  await ds.destroy();
});
beforeEach(async () => {
  await ds.query("TRUNCATE jobs, transactions, accounts, fx_rates RESTART IDENTITY CASCADE");
  await ds.query("UPDATE settings SET last_sync_at = NULL, last_contact_at = NULL");
});

function make(
  over: { webHookUrl?: string; statement?: (...a: unknown[]) => Promise<MonoStatementItem[]> } = {},
  cfg: { MONOBANK_TOKEN?: string; MONO_WEBHOOK_SECRET?: string; PUBLIC_URL?: string } = {
    MONOBANK_TOKEN: "tok", MONO_WEBHOOK_SECRET: SECRET, PUBLIC_URL: "https://tablo.example.com",
  },
) {
  const client = {
    clientInfo: vi.fn(async () => ({
      clientId: "c", name: "n", webHookUrl: over.webHookUrl ?? OUR_URL,
      accounts: [{ id: "acc-1", balance: 777, creditLimit: 5000, type: "black", currencyCode: 980, maskedPan: [] }],
      jars: [],
    })),
    statement: vi.fn(over.statement ?? (async () => [])),
    setWebhook: vi.fn(async () => {}),
    currency: vi.fn(async () => []),
  };
  const runner = new JobRunner(ds, clock);
  const imports = new ImportService(ds, client as unknown as MonoClient, runner, clock);
  const service = new ReconcileService(ds, client as unknown as MonoClient, imports, clock, cfg as never);
  return { client, service, imports };
}

describe("ReconcileService.runDaily", () => {
  it("inserts a transaction missed by the webhook, asks for the last 7 days", async () => {
    const { client, service } = make({ statement: async () => [stmt("missed")] });
    await service.runDaily();
    const rows = await ds.query("SELECT external_id FROM transactions");
    expect(rows).toEqual([{ external_id: "missed" }]);
    const [, from, to] = client.statement.mock.calls[0] as [string, number, number];
    expect(to).toBe(NOW_MS / 1000);
    expect(to - from).toBe(7 * 86400);
    const [s] = await ds.query("SELECT last_sync_at FROM settings");
    expect(new Date(s.last_sync_at).getTime()).toBe(NOW_MS);
  });

  it("refreshes balance and credit_limit from client-info", async () => {
    const { service } = make();
    await service.runDaily();
    const [a] = await ds.query("SELECT balance, credit_limit FROM accounts WHERE external_id='acc-1'");
    expect(a).toEqual({ balance: "777", credit_limit: "5000" });
  });

  it("re-installs the webhook when client-info reports a foreign url, not when ours", async () => {
    const foreign = make({ webHookUrl: "https://elsewhere.example/hook" });
    await foreign.service.runDaily();
    expect(foreign.client.setWebhook).toHaveBeenCalledWith(OUR_URL);
    const ours = make();
    await ours.service.runDaily();
    expect(ours.client.setWebhook).not.toHaveBeenCalled();
  });

  it("skips everything with no token: no monobank call, no throw", async () => {
    const { client, service } = make({}, { MONO_WEBHOOK_SECRET: SECRET, PUBLIC_URL: "https://x.example" });
    await service.runDaily();
    expect(client.clientInfo).not.toHaveBeenCalled();
    expect(await ds.query("SELECT 1 FROM jobs")).toHaveLength(0);
  });

  it("with a token but no secret still reconciles, but never installs a webhook", async () => {
    const { client, service } = make({ webHookUrl: "" }, { MONOBANK_TOKEN: "tok" });
    await service.runDaily();
    expect(client.statement).toHaveBeenCalled();
    expect(client.setWebhook).not.toHaveBeenCalled();
  });

  it("does not record last_sync_at when a statement call fails, and reports the failure", async () => {
    const { service } = make({ statement: async () => { throw new Error("boom"); } });
    await expect(service.runDaily()).rejects.toThrow(/boom/);
    const [s] = await ds.query("SELECT last_sync_at FROM settings");
    expect(s.last_sync_at).toBeNull();
  });
});

describe("ReconcileService.refreshBalances", () => {
  it("updates balances and the contact time with one client-info call, nothing else", async () => {
    const { client, service } = make();
    await service.refreshBalances();
    expect(client.clientInfo).toHaveBeenCalledTimes(1);
    expect(client.statement).not.toHaveBeenCalled();
    expect(client.setWebhook).not.toHaveBeenCalled();
    const [a] = await ds.query("SELECT balance::int AS balance FROM accounts");
    expect(a.balance).toBe(777);
    const [s] = await ds.query("SELECT last_contact_at, last_sync_at FROM settings");
    expect(new Date(s.last_contact_at).getTime()).toBe(NOW_MS);
    expect(s.last_sync_at).toBeNull();
  });

  it("does nothing without a token and records no contact on failure", async () => {
    const none = make({}, {});
    await none.service.hourlyRefresh();
    expect(none.client.clientInfo).not.toHaveBeenCalled();

    const { client, service } = make();
    client.clientInfo.mockRejectedValueOnce(new Error("down"));
    await expect(service.hourlyRefresh()).resolves.toBeUndefined();
    const [s] = await ds.query("SELECT last_contact_at FROM settings");
    expect(s.last_contact_at).toBeNull();
  });
});

describe("FxService.refresh", () => {
  const rates = [
    { currencyCodeA: 840, currencyCodeB: 980, date: 1, rateBuy: 41, rateSell: 42 },
    { currencyCodeA: 978, currencyCodeB: 980, date: 1, rateCross: 48 },
    { currencyCodeA: 978, currencyCodeB: 840, date: 1, rateBuy: 1.1, rateSell: 1.2 },
    { currencyCodeA: 392, currencyCodeB: 980, date: 1, rateBuy: 0.3, rateSell: 0.3 },
  ];

  it("stores UAH-per-unit rates for known currencies, no token needed", async () => {
    const client = { currency: vi.fn(async () => rates) };
    await new FxService(ds, client as unknown as MonoClient, clock).refresh();
    const rows = await ds.query("SELECT currency, rate FROM fx_rates ORDER BY currency");
    expect(rows).toEqual([
      { currency: "EUR", rate: "48.00000000" },
      { currency: "USD", rate: "41.50000000" },
    ]);
  });

  it("keeps the old rows and does not throw when the fetch fails", async () => {
    await ds.query("INSERT INTO fx_rates VALUES ('USD','2026-01-01',40)");
    const client = { currency: vi.fn(async () => { throw new Error("429"); }) };
    await new FxService(ds, client as unknown as MonoClient, clock).refresh();
    expect(await ds.query("SELECT currency, rate FROM fx_rates")).toEqual([
      { currency: "USD", rate: "40.00000000" },
    ]);
  });
});
