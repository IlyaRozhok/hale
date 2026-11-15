import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { LedgerCheckService } from "../src/check/check.service";
import { Clock, kyivDaySql } from "../src/time/clock";
import { counterKeySql } from "../src/transactions/counter-key";

// Task Б11: the nightly ledger check. It reads every accounting table and writes only ledger_checks. The rows below
// make a clean ledger: the black card's bank balances chain to the bank's balance, a transfer to the white card has
// both legs, every purchase has a category, and the wallet holds ₴300.

let on: INestApplication;
let off: INestApplication;
let ds: DataSource;
let auth: string;

const NOW = new Date("2026-11-12T10:00:00Z");
const http = (app: INestApplication) => app.getHttpServer();

async function login(app: INestApplication): Promise<string> {
  const r = await request(http(app)).post("/auth/login").send({ password: TEST_PASSWORD, deviceName: "t" });
  return `Bearer ${r.body.token as string}`;
}

beforeAll(async () => {
  const url = await createMigratedDatabase();
  ds = new DS({ type: "postgres", url });
  await ds.initialize();
  on = await createTestApp(url, { config: { LEDGER_CHECK_ENABLED: true } });
  off = await createTestApp(url);
  on.get(Clock).fixed = NOW;
  off.get(Clock).fixed = NOW;
  auth = await login(on);
});
afterAll(async () => {
  await on.close();
  await off.close();
  await ds.destroy();
});

let black: number;
let white: number;
let cash: number;

async function account(externalId: string, kind: string, balance: number | null): Promise<number> {
  const r = await ds.query(
    `INSERT INTO accounts (external_id, kind, currency, balance, balance_at) VALUES ($1,$2,'UAH',$3,$4) RETURNING id`,
    [externalId, kind, balance ?? 0, balance === null ? null : "2026-11-12T09:00:00Z"],
  );
  return r[0].id as number;
}

let seq = 0;
async function tx(
  accountId: number,
  at: string,
  amount: number,
  type: string,
  category: string | null,
  balanceAfter: number | null,
  description = "Операция",
): Promise<number> {
  seq++;
  const r = await ds.query(
    `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, category, balance_after, raw)
     VALUES ($1,$2,$3,${kyivDaySql("$3::timestamptz")},$4,$5,$5,$6,$7,$8,'{}') RETURNING id`,
    [`c-${seq}`, accountId, at, description, amount, type, category, balanceAfter],
  );
  return r[0].id as number;
}

let silpo: number;
let toWhite: number;
let fromBlack: number;

beforeEach(async () => {
  await ds.query(
    `TRUNCATE ledger_checks, jobs, rules, transactions, accounts, fx_rates, income_events, expected_incomes, cash_cards,
              scheduled_payments, recurring_payments, manual_balances, loans, bridge_plans, daily_snapshots, goals
     RESTART IDENTITY CASCADE`,
  );
  await ds.query(`UPDATE settings SET cash_start='2026-11-01', tracking_start='2026-10-01'`);
  black = await account("black", "black", 45_000);
  white = await account("white", "white", 8_000);
  cash = await account("manual:cash", "cash", null);
  await tx(black, "2026-11-05T08:00:00Z", -10_000, "spend", "cafe", 90_000, "Кофейня");
  silpo = await tx(black, "2026-11-07T09:00:00Z", -32_000, "spend", "groceries", 58_000, "Сільпо");
  toWhite = await tx(black, "2026-11-08T10:00:00Z", -8_000, "own_transfer", "own", 50_000, "На білу картку");
  fromBlack = await tx(white, "2026-11-08T10:01:00Z", 8_000, "own_transfer", "own", 8_000, "З чорної картки");
  await tx(black, "2026-11-09T11:00:00Z", -5_000, "spend", "cafe", 45_000, "Кофейня");
  await tx(cash, "2026-11-01T08:00:00Z", 50_000, "own_transfer", "own", null, "Начальный остаток");
  await tx(cash, "2026-11-06T12:00:00Z", -20_000, "spend", "groceries", null, "Рынок");
});

const run = () => request(http(on)).post("/check/run").set("Authorization", auth);
const latest = (app = on) => request(http(app)).get("/check/latest").set("Authorization", auth);

/** A fingerprint of every table but the check's own. */
async function accountingChecksum(): Promise<Record<string, string>> {
  const tables: { table_name: string }[] = await ds.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name NOT IN ('migrations','ledger_checks') ORDER BY 1`,
  );
  const out: Record<string, string> = {};
  for (const { table_name } of tables) {
    const r = await ds.query(`SELECT count(*)::int AS n, md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM ${table_name} x`);
    out[table_name] = `${r[0].n}:${r[0].h}`;
  }
  return out;
}

describe("POST /check/run and GET /check/latest", () => {
  it("finds nothing wrong in a clean ledger and changes no accounting table", async () => {
    const before = await accountingChecksum();
    const r = await run();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ranAt: NOW.toISOString(), issues: [] });
    expect(await accountingChecksum()).toEqual(before);
    expect((await latest()).body).toEqual({ ranAt: NOW.toISOString(), issues: [] });
    const rows: { invariant: string; ok: boolean; account_id: number | null }[] = await ds.query(
      `SELECT invariant, ok, account_id FROM ledger_checks ORDER BY id`,
    );
    // The black and white cards both chain; the wallet has no bank statement.
    expect(rows).toEqual([
      { invariant: "bank_balance", ok: true, account_id: black },
      { invariant: "bank_balance", ok: true, account_id: white },
      { invariant: "own_transfers", ok: true, account_id: null },
      { invariant: "categories", ok: true, account_id: null },
      { invariant: "day_spent", ok: true, account_id: null },
      { invariant: "cash_wallet", ok: true, account_id: null },
    ]);
  });

  it("a deleted operation breaks the bank balance by its amount from the next operation's day", async () => {
    await ds.query(`DELETE FROM transactions WHERE id=$1`, [silpo]);
    const before = await accountingChecksum();
    const r = await run();
    expect(r.body.issues).toEqual([
      { kind: "bank_balance", amount: -32_000, currency: "UAH", since: "2026-11-08", accountKind: "black", accountTitle: null },
    ]);
    expect(await accountingChecksum()).toEqual(before);
  });

  it("a wallet below zero is named with its balance and the day it went below", async () => {
    await tx(cash, "2026-11-09T12:00:00Z", -40_000, "spend", "groceries", null, "Рынок");
    const r = await run();
    expect(r.body.issues).toEqual([{ kind: "cash_wallet", amount: -10_000, currency: "UAH", since: "2026-11-09" }]);
  });

  it("counts a leg of a transfer between own accounts with no other leg, with the oldest day", async () => {
    await ds.query(`DELETE FROM transactions WHERE id=$1`, [fromBlack]);
    const r = await run();
    expect(r.body.issues).toEqual([{ kind: "own_transfers", amount: 0, currency: "UAH", since: "2026-11-08", count: 1 }]);
  });

  it("a transfer to the owner's card at another bank (he answered about it) is not a lone leg", async () => {
    await ds.query(`DELETE FROM transactions WHERE id=$1`, [fromBlack]);
    await ds.query(
      `INSERT INTO cash_cards (counter_key, withdraws) SELECT ${counterKeySql("t")}, false FROM transactions t WHERE t.id=$1`,
      [toWhite],
    );
    const r = await run();
    expect(r.body.issues).toEqual([]);
  });

  it("spending with no category shows as categories not adding up", async () => {
    await tx(black, "2026-11-10T08:00:00Z", -1_000, "spend", null, 44_000);
    await ds.query(`UPDATE accounts SET balance=44000 WHERE id=$1`, [black]);
    const r = await run();
    expect(r.body.issues).toEqual([{ kind: "categories", amount: 1_000, currency: "UAH", since: "2026-11-10" }]);
  });

  it("returns only the latest run, and a run at the same moment replaces the earlier one", async () => {
    await run();
    await ds.query(`DELETE FROM transactions WHERE id=$1`, [silpo]);
    on.get(Clock).fixed = new Date("2026-11-12T11:00:00Z");
    try {
      await run();
    } finally {
      on.get(Clock).fixed = NOW;
    }
    const r = await latest();
    expect(r.body.ranAt).toBe("2026-11-12T11:00:00.000Z");
    expect(r.body.issues).toHaveLength(1);
    await run(); // at NOW again
    const runs: { n: number }[] = await ds.query(`SELECT count(DISTINCT ran_at)::int AS n FROM ledger_checks`);
    expect(runs[0]!.n).toBe(2);
  });

  it("keeps 30 days of runs", async () => {
    await ds.query(
      `INSERT INTO ledger_checks (ran_at, invariant, ok) VALUES ('2026-10-12T09:00:00Z','categories',true), ('2026-10-14T09:00:00Z','categories',true)`,
    );
    await run();
    const kept: { ran_at: Date }[] = await ds.query(`SELECT DISTINCT ran_at FROM ledger_checks ORDER BY ran_at`);
    expect(kept.map((k) => k.ran_at.toISOString())).toEqual(["2026-10-14T09:00:00.000Z", NOW.toISOString()]);
  });

  it("asks for the owner's sign-in", async () => {
    expect((await request(http(on)).post("/check/run")).status).toBe(401);
    expect((await request(http(on)).get("/check/latest")).status).toBe(401);
  });
});

describe("the LEDGER_CHECK_ENABLED flag", () => {
  it("off: the nightly run does nothing and the latest result is not given out", async () => {
    expect(await off.get(LedgerCheckService).scheduledRun()).toBe(false);
    expect(await ds.query(`SELECT * FROM ledger_checks`)).toEqual([]);
    // A run by hand still works, but the app is shown nothing while the check is off.
    const r = await request(http(off)).post("/check/run").set("Authorization", auth);
    expect(r.status).toBe(200);
    const l = await latest(off);
    expect(l.status).toBe(200);
    expect(l.text).toBe("");
  });

  it("on: the nightly run stores a result", async () => {
    expect(await on.get(LedgerCheckService).scheduledRun()).toBe(true);
    expect((await latest()).body).toEqual({ ranAt: NOW.toISOString(), issues: [] });
  });

  it("on, before any run: nothing to show", async () => {
    const l = await latest();
    expect(l.status).toBe(200);
    expect(l.text).toBe("");
  });
});
