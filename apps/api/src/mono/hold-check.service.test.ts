import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { createMigratedDatabase } from "../../test/app";
import { createDataSource } from "../db/data-source";
import { HoldCheckService } from "./hold-check.service";
import { SPLIT_THRESHOLD } from "./import.service";
import { kyivMidnight } from "./mono.controller";
import type { MonoClient } from "./mono.client";
import { MonoApiError } from "./mono.errors";
import type { MonoStatementItem } from "./mono.schemas";

const DAY = 86_400;
const FROM = kyivMidnight("2026-10-01")!;
const FROM_S = FROM.getTime() / 1000;
/** Kyiv midnight of 30 September 2026: where the statements must start. */
const DAY_BEFORE_S = kyivMidnight("2026-09-30")!.getTime() / 1000;
/** 2 November 2026, 12:00 Kyiv. */
const NOW_MS = Date.parse("2026-11-02T12:00:00+02:00");
const NOW_S = NOW_MS / 1000;

const item = (id: string, time: number, over: Partial<MonoStatementItem> = {}): MonoStatementItem => ({
  id, time, description: "Uklon", mcc: 4121, originalMcc: 4121, hold: true,
  amount: -15_000, operationAmount: -15_000, currencyCode: 980, commissionRate: 0, cashbackAmount: 0,
  balance: 1, ...over,
});

let ds: DataSource;
let now = NOW_MS;
const clock = { now: () => now };

beforeAll(async () => {
  ds = createDataSource(await createMigratedDatabase());
  await ds.initialize();
});
afterAll(async () => {
  await ds.destroy();
});
beforeEach(async () => {
  now = NOW_MS;
  await ds.query("TRUNCATE jobs, transactions, accounts, fx_rates RESTART IDENTITY CASCADE");
  await ds.query(
    `INSERT INTO accounts (external_id, kind, currency, balance) VALUES
       ('acc-1','black','UAH',0), ('acc-2','white','UAH',0), ('manual:cash','cash','UAH',0)`,
  );
});

async function insertHold(id: string, time: number, account = "acc-1", over: { hold?: boolean; amount?: number } = {}) {
  await ds.query(
    `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, mcc, amount, amount_uah, hold, raw)
     SELECT $1, id, to_timestamp($2), (to_timestamp($2) AT TIME ZONE 'Europe/Kyiv')::date, 'Uklon', 4121, $3, $3, $4, '{}'
       FROM accounts WHERE external_id=$5`,
    [id, time, over.amount ?? -15_000, over.hold ?? true, account],
  );
}

type Statement = (account: string, from: number, to: number) => Promise<MonoStatementItem[]>;

function make(statement: Statement = async () => [], source: DataSource = ds) {
  const client = { statement: vi.fn(statement) } as unknown as MonoClient;
  const service = new HoldCheckService(source, client, clock);
  return { client: client as unknown as { statement: ReturnType<typeof vi.fn> }, service };
}

async function runToEnd(service: HoldCheckService, from = FROM) {
  const started = service.start(from);
  await service.settled();
  return { started, state: service.state() };
}

describe("HoldCheckService: windows", () => {
  it("asks for statements from the Kyiv day before `from` to now, per account, never for cash", async () => {
    const { client, service } = make();
    const { started, state } = await runToEnd(service);
    expect(started.started).toBe(true);
    const calls = client.statement.mock.calls as [string, number, number][];
    expect(calls.map((c) => c[0]).sort()).toEqual(["acc-1", "acc-1", "acc-2", "acc-2"]);
    expect(Math.min(...calls.map((c) => c[1]))).toBe(DAY_BEFORE_S);
    expect(Math.max(...calls.map((c) => c[2]))).toBe(NOW_S);
    expect(state).toMatchObject({
      status: "done",
      result: { accounts: 2, windowsPlanned: 4, windowsSplit: 0, windowsRead: 4, windowsUnread: 0, period: { from: "2026-10-01", to: "2026-11-02" } },
    });
  });

  it("splits a window of SPLIT_THRESHOLD rows and reads both halves instead", async () => {
    const big = Array.from({ length: SPLIT_THRESHOLD }, (_, i) => item(`b${i}`, FROM_S + i, { hold: false }));
    const { client, service } = make(async (account, from, to) =>
      account === "acc-1" && from === DAY_BEFORE_S && to === DAY_BEFORE_S + 2_682_000 ? big : [item("one", from + 1, { hold: false })],
    );
    const { state } = await runToEnd(service);
    const calls = client.statement.mock.calls as [string, number, number][];
    const firstWindow = calls.filter((c) => c[0] === "acc-1" && c[1] === DAY_BEFORE_S);
    expect(firstWindow).toHaveLength(2);
    const mid = DAY_BEFORE_S + 1_341_000;
    expect(calls.some((c) => c[0] === "acc-1" && c[1] === DAY_BEFORE_S && c[2] === mid)).toBe(true);
    expect(calls.some((c) => c[0] === "acc-1" && c[1] === mid + 1 && c[2] === DAY_BEFORE_S + 2_682_000)).toBe(true);
    expect(state).toMatchObject({
      status: "done",
      result: { windowsPlanned: 6, windowsSplit: 1, windowsRead: 5, windowsUnread: 0, apiRows: 5 },
    });
  });

  it("a one-second window that still returns SPLIT_THRESHOLD rows is unread: its holds are unchecked", async () => {
    now = DAY_BEFORE_S * 1000; // the whole period is one second
    await insertHold("h1", DAY_BEFORE_S);
    const big = Array.from({ length: SPLIT_THRESHOLD }, (_, i) => item(`b${i}`, DAY_BEFORE_S, { hold: false }));
    const { service } = make(async (account) => (account === "acc-1" ? big : []));
    const { state } = await runToEnd(service);
    expect(state).toMatchObject({
      status: "done",
      result: { windowsPlanned: 2, windowsSplit: 0, windowsRead: 1, windowsUnread: 1, holdRows: 0, holdsBeforePeriod: 1 },
    });
  });

  it("a failed request is retried once; a second failure makes the window unread and the hold unchecked", async () => {
    await insertHold("h1", FROM_S + DAY);
    let failures = 0;
    const { client, service } = make(async (account) => {
      if (account !== "acc-1") return [];
      failures += 1;
      throw new MonoApiError("monobank /personal/statement/acc-1/... responded 429", 429, 60);
    });
    const { state } = await runToEnd(service);
    expect(failures).toBe(4); // two windows, each tried twice
    expect(client.statement.mock.calls.filter((c) => c[0] === "acc-2")).toHaveLength(2);
    expect(state).toMatchObject({
      status: "done",
      result: { windowsRead: 2, windowsUnread: 2, holdRows: 1, holdUnchecked: 1, holdNothingSimilar: 0 },
    });
  });

  it("a request that fails once and then succeeds reads the window", async () => {
    let first = true;
    const { service } = make(async () => {
      if (first) {
        first = false;
        throw new Error("socket hang up");
      }
      return [];
    });
    const { state } = await runToEnd(service);
    expect(state).toMatchObject({ status: "done", result: { windowsRead: 4, windowsUnread: 0 } });
  });
});

describe("HoldCheckService: what is checked", () => {
  it("checks hold rows from `from`, counts earlier ones separately, and finds a first-day hold stamped the day before", async () => {
    await insertHold("first", FROM_S + 3600);
    await insertHold("old", FROM_S - 3 * DAY);
    await insertHold("settled", FROM_S + 5 * DAY, "acc-2");
    await insertHold("not-a-hold", FROM_S + 6 * DAY, "acc-2", { hold: false });
    const { service } = make(async (account) =>
      account === "acc-1" ? [item("first", FROM_S - 1800)] : [item("settled", FROM_S + 5 * DAY, { hold: false })],
    );
    const { state } = await runToEnd(service);
    expect(state).toMatchObject({
      status: "done",
      result: { holdRows: 2, holdsBeforePeriod: 1, holdStillHold: 1, holdSettled: 1, holdNothingSimilar: 0, apiRows: 4 },
    });
  });

  it("the result is numbers and the two period dates only", async () => {
    const { service } = make(async () => [item("x", FROM_S + 1, { description: "Скасування. Uklon", amount: 15_000, hold: false })]);
    const { state } = await runToEnd(service);
    expect(state.status).toBe("done");
    if (state.status !== "done") return;
    const { period, ...rest } = state.result;
    expect(period).toEqual({ from: "2026-10-01", to: "2026-11-02" });
    for (const v of Object.values(rest)) expect(typeof v).toBe("number");
    expect(JSON.stringify(state)).not.toMatch(/Uklon|acc-1|Скасування/);
  });

  it("holdRows equals the sum of the seven hold counters", async () => {
    await insertHold("gone", FROM_S + DAY);
    await insertHold("still", FROM_S + 2 * DAY, "acc-2");
    const { service } = make(async (account) => (account === "acc-2" ? [item("still", FROM_S + 2 * DAY)] : []));
    const { state } = await runToEnd(service);
    if (state.status !== "done") throw new Error(state.status);
    const r = state.result;
    expect(
      r.holdStillHold + r.holdSettled + r.holdUnchecked + r.holdSameAmountOtherId +
        r.holdCancelled + r.holdOtherAmountNearby + r.holdNothingSimilar,
    ).toBe(r.holdRows);
    expect(r.holdRows).toBe(2);
  });
});

describe("HoldCheckService: state", () => {
  it("starts idle, reports progress while running, then done", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { service } = make(async () => {
      await gate;
      return [];
    });
    expect(service.state()).toEqual({ status: "idle" });
    service.start(FROM);
    expect(service.state()).toMatchObject({ status: "running", windowsPlanned: 0, windowsRead: 0 });
    for (let i = 0; i < 200 && (service.state() as { windowsPlanned?: number }).windowsPlanned === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(service.state()).toMatchObject({ status: "running", windowsPlanned: 4, windowsRead: 0 });
    release();
    await service.settled();
    expect(service.state()).toMatchObject({ status: "done" });
  });

  it("a second start while running or after done does not start again", async () => {
    const { client, service } = make();
    service.start(FROM);
    expect(service.start(FROM).started).toBe(false);
    await service.settled();
    const calls = client.statement.mock.calls.length;
    const again = service.start(FROM);
    expect(again.started).toBe(false);
    expect(again.state.status).toBe("done");
    await service.settled();
    expect(client.statement.mock.calls.length).toBe(calls);
  });

  it("fails with one word when the database cannot be read, and may be started again after that", async () => {
    let broken = true;
    const source = {
      query: async (...args: unknown[]) => {
        if (broken) throw new Error("connection refused to db-host:5432 user hale");
        return (ds.query as (...a: unknown[]) => Promise<unknown>)(...args);
      },
    } as unknown as DataSource;
    const { client, service } = make(async () => [], source);
    const failed = await runToEnd(service);
    expect(failed.state).toEqual({ status: "failed", reason: "database" });
    expect(client.statement).not.toHaveBeenCalled();

    broken = false;
    const { started, state } = await runToEnd(service);
    expect(started.started).toBe(true);
    expect(state.status).toBe("done");
  });
});
