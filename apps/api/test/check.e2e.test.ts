import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import type { EntityManager } from "typeorm";
import { LedgerCheckService } from "../src/check/check.service";
import { ScreenSpent } from "../src/check/screen-spent";
import { Clock, kyivDaySql } from "../src/time/clock";
import { counterKeySql } from "../src/transactions/counter-key";

// Task Б11: the nightly ledger check. It reads every accounting table and writes only ledger_checks. The rows below
// make a clean ledger: the black card's bank balances chain to the bank's balance, a transfer to the white card has
// both legs, every purchase has a category, and the wallet holds ₴300.

let on: INestApplication;
let off: INestApplication;
/** On, with a «Сегодня» that shows ₴5 more spent on 7 November than the ledger. */
let odd: INestApplication;
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
  on = await createTestApp(url, { config: { LEDGER_CHECK_ENABLED: true, OWNER_NAMES: ["Test Owner"] } });
  off = await createTestApp(url);
  const skewed = {
    byDay: async (m: EntityManager, from: string, to: string) => {
      const maps = await new ScreenSpent().byDay(m, from, to);
      maps[1]!.set("2026-11-07", (maps[1]!.get("2026-11-07") ?? 0) + 500);
      return maps;
    },
  };
  odd = await createTestApp(url, { config: { LEDGER_CHECK_ENABLED: true }, overrides: [[ScreenSpent, skewed]] });
  for (const app of [on, off, odd]) app.get(Clock).fixed = NOW;
  auth = await login(on);
});
afterAll(async () => {
  await on.close();
  await off.close();
  await odd.close();
  await ds.destroy();
});

let black: number;
let white: number;
let cash: number;

async function account(externalId: string, kind: string, balance: number | null, creditLimit = 0): Promise<number> {
  const r = await ds.query(
    `INSERT INTO accounts (external_id, kind, currency, balance, credit_limit, balance_at) VALUES ($1,$2,'UAH',$3,$4,$5) RETURNING id`,
    [externalId, kind, balance ?? 0, creditLimit, balance === null ? null : "2026-11-12T09:00:00Z"],
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
  creditLimitAt: number | null = null,
): Promise<number> {
  seq++;
  const r = await ds.query(
    `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, category, balance_after, credit_limit_at, raw)
     VALUES ($1,$2,$3,${kyivDaySql("$3::timestamptz")},$4,$5,$5,$6,$7,$8,$9,'{}') RETURNING id`,
    [`c-${seq}`, accountId, at, description, amount, type, category, balanceAfter, creditLimitAt],
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
  await ds.query(`UPDATE settings SET cash_start='2026-11-01', cash_started_at=NULL, tracking_start='2026-10-01'`);
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

const run = (app = on) => request(http(app)).post("/check/run").set("Authorization", auth);
const nightly = (app = on) => app.get(LedgerCheckService).scheduledRun();
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
    expect(await nightly()).toBe(true);
    expect(await accountingChecksum()).toEqual(before);
    expect((await latest()).body).toEqual({ ranAt: NOW.toISOString(), issues: [] });
  });

  it("a card's raised credit limit, known on both sides, is not a difference", async () => {
    // ₴20,000 raised to ₴25,000 between two webhook operations; monobank's balances include the limit.
    const credit = await account("credit", "black", 2_489_000, 2_500_000);
    await tx(credit, "2026-11-05T08:00:00Z", -10_000, "spend", "cafe", 1_990_000, "Кофейня", 2_000_000);
    await tx(credit, "2026-11-08T08:00:00Z", -1_000, "spend", "cafe", 2_489_000, "Кофейня", 2_500_000);
    expect((await run()).body.issues).toEqual([]);
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

  it("a withdrawal on the start day before the start moment is neither spending nor wallet: nothing is found (Б39)", async () => {
    // The wallet started at 12:00 Kyiv on 1 November; its opening balance already holds cash taken at 09:00.
    await ds.query(`UPDATE settings SET cash_started_at='2026-11-01T10:00:00Z'`);
    const other = await account("other-bank", "white", null);
    await tx(other, "2026-11-01T07:00:00Z", -100_000, "cash_out", null, null, "Банкомат");
    const wallet = async () => (await request(http(on)).get("/cash").set("Authorization", auth).expect(200)).body.balance as number;
    expect(await wallet()).toBe(30_000);
    expect((await run()).body.issues).toEqual([]);
    await tx(other, "2026-11-01T11:00:00Z", -40_000, "cash_out", null, null, "Банкомат");
    expect(await wallet()).toBe(70_000);
    expect((await run()).body.issues).toEqual([]);
  });

  it("counts a leg of a transfer between own accounts with no other leg, with the oldest day", async () => {
    await ds.query(`DELETE FROM transactions WHERE id=$1`, [fromBlack]);
    // Money in from the owner's card at another bank never has its other leg here: not counted.
    await tx(white, "2026-11-03T08:00:00Z", 20_000, "own_transfer", "own", null, "Від: Іван Петренко");
    const r = await run();
    expect(r.body.issues).toEqual([{ kind: "own_transfers", amount: 0, currency: "UAH", since: "2026-11-08", count: 1 }]);
  });

  it("money in with the owner's own name only in the bank's counterparty field is not a lone leg; a stranger's is (Б38)", async () => {
    const own = await tx(white, "2026-11-03T08:00:00Z", 20_000, "own_transfer", "own", null, "Переказ коштів");
    await ds.query(`UPDATE transactions SET counter_name='OWNER TEST' WHERE id=$1`, [own]);
    expect((await run()).body.issues).toEqual([]);
    const stranger = await tx(white, "2026-11-04T08:00:00Z", 20_000, "own_transfer", "own", null, "Переказ коштів");
    await ds.query(`UPDATE transactions SET counter_name='Test Client' WHERE id=$1`, [stranger]);
    expect((await run()).body.issues).toEqual([{ kind: "own_transfers", amount: 0, currency: "UAH", since: "2026-11-04", count: 1 }]);
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

  it("USDC exchanged for cash, a wallet row with no bank leg, is not a lone leg (Б22)", async () => {
    await ds.query(`INSERT INTO manual_balances (name, amount, currency, counts_as_own) VALUES ('Binance', 500000, 'USD', true)`);
    await request(http(on)).post("/cash/operations").set("Authorization", auth).send({ kind: "exchange", usdc: 140_000, amount: 6_543_000 }).expect(201);
    const r = await run();
    expect(r.body.issues).toEqual([]);
  });

  describe("a cash deposit answered «Откуда наличные?» (Б51)", () => {
    const api = (path: string, body: object) => request(http(on)).post(path).set("Authorization", auth).send(body);
    /** ₴200 paid in on the white card at a terminal on 4 November, before its known bank balance. */
    const deposit = async () => {
      const id = await tx(white, "2026-11-04T08:00:00Z", 20_000, "cash_in", "cash", null, "Термінал City24");
      await ds.query(`UPDATE transactions SET mcc=4829 WHERE id=$1`, [id]);
      return id;
    };
    /** Binance holds $5,000 at ₴40, and the USDC income of November is received. */
    const binance = async () => {
      await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-03T09:00:00Z', 40)`);
      await ds.query(`INSERT INTO manual_balances (name, amount, currency, counts_as_own) VALUES ('Binance', 500000, 'USD', true)`);
      const exp = (
        await ds.query(
          `INSERT INTO expected_incomes (source, amount, currency, window_start_day, window_end_day) VALUES ('usdc', 500000, 'USD', 1, 5) RETURNING id`,
        )
      )[0].id;
      return (
        await ds.query(
          `INSERT INTO income_events (expected_income_id, period, expected_on, status, received_at) VALUES ($1,'2026-11','2026-11-03','received','2026-11-03T10:00:00Z') RETURNING id`,
          [exp],
        )
      )[0].id as number;
    };

    it("«Из кошелька»: an own transfer whose other leg is the wallet is not a lone leg", async () => {
      const id = await deposit();
      await api(`/cash/deposits/${id}/answer`, { answer: "wallet" }).expect(201);
      expect((await ds.query(`SELECT type FROM transactions WHERE id=$1`, [id]))[0].type).toBe("own_transfer");
      expect((await run()).body.issues).toEqual([]);
    });

    it("«Вывод с Binance»: an own transfer whose other leg is Binance is not a lone leg", async () => {
      await binance();
      const id = await deposit();
      await api(`/cash/deposits/${id}/answer`, { answer: "binance" }).expect(201);
      expect((await ds.query(`SELECT type FROM transactions WHERE id=$1`, [id]))[0].type).toBe("own_transfer");
      expect((await run()).body.issues).toEqual([]);
    });

    it("a second part of the same Binance withdrawal, and a card credit matched to it, are not lone legs either", async () => {
      const ev = await binance();
      const first = await deposit();
      await api(`/cash/deposits/${first}/answer`, { answer: "binance" }).expect(201);
      const second = await deposit();
      await api(`/cash/deposits/${second}/answer`, { answer: "binance" }).expect(201);
      const credit = await tx(white, "2026-11-04T09:00:00Z", 30_000, "person_in", "transfer", null, "Переказ коштів");
      await api(`/plan/incomes/${ev}/match-transaction`, { transactionId: credit }).expect(201);
      expect((await ds.query(`SELECT type FROM transactions WHERE id=$1`, [credit]))[0].type).toBe("own_transfer");
      expect((await run()).body.issues).toEqual([]);
    });

    it("a lone own transfer the owner said is not from Binance is still a lone leg", async () => {
      await ds.query(`DELETE FROM transactions WHERE id=$1`, [fromBlack]);
      await api(`/plan/transactions/${toWhite}/not-usdc`, {}).expect(201);
      expect((await ds.query(`SELECT usdc_checked FROM transactions WHERE id=$1`, [toWhite]))[0].usdc_checked).toBe(true);
      expect((await run()).body.issues).toEqual([{ kind: "own_transfers", amount: 0, currency: "UAH", since: "2026-11-08", count: 1 }]);
    });
  });

  it("spending with no category shows as categories not adding up", async () => {
    await tx(black, "2026-11-10T08:00:00Z", -1_000, "spend", null, 44_000);
    await ds.query(`UPDATE accounts SET balance=44000 WHERE id=$1`, [black]);
    const r = await run();
    expect(r.body.issues).toEqual([{ kind: "categories", amount: 1_000, currency: "UAH", since: "2026-11-10" }]);
  });

  it("a screen that shows another spent for a day than the ledger breaks invariant 4 on that day", async () => {
    const r = await run(odd);
    expect(r.body.issues).toEqual([{ kind: "day_spent", amount: 500, currency: "UAH", since: "2026-11-07" }]);
  });

  it("gives out only the latest nightly run, and a nightly run at the same moment replaces the earlier one", async () => {
    await nightly();
    await ds.query(`DELETE FROM transactions WHERE id=$1`, [silpo]);
    on.get(Clock).fixed = new Date("2026-11-12T11:00:00Z");
    try {
      await nightly();
      await tx(cash, "2026-11-12T09:00:00Z", -40_000, "spend", "groceries", null, "Рынок"); // a second problem, seen only by hand
      expect((await run()).body.issues).toHaveLength(2);
      const r = await latest();
      expect(r.body.ranAt).toBe("2026-11-12T11:00:00.000Z");
      expect(r.body.issues).toHaveLength(1);
    } finally {
      on.get(Clock).fixed = NOW;
    }
    await nightly(); // at NOW again
    const runs: { n: number }[] = await ds.query(`SELECT count(DISTINCT (ran_at, scheduled))::int AS n FROM ledger_checks`);
    expect(runs[0]!.n).toBe(3);
  });

  it("gives out nothing once the latest nightly run is more than two days old", async () => {
    await nightly();
    try {
      on.get(Clock).fixed = new Date("2026-11-14T09:00:00Z");
      expect((await latest()).body.ranAt).toBe(NOW.toISOString());
      on.get(Clock).fixed = new Date("2026-11-14T11:00:00Z");
      expect((await latest()).text).toBe("");
    } finally {
      on.get(Clock).fixed = NOW;
    }
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
    expect(await nightly(off)).toBe(false);
    expect(await ds.query(`SELECT * FROM ledger_checks`)).toEqual([]);
    // A run by hand still works, but the app is shown nothing while the check is off.
    const r = await request(http(off)).post("/check/run").set("Authorization", auth);
    expect(r.status).toBe(200);
    const l = await latest(off);
    expect(l.status).toBe(200);
    expect(l.text).toBe("");
  });

  it("on: the nightly run stores a result", async () => {
    expect(await nightly()).toBe(true);
    expect((await latest()).body).toEqual({ ranAt: NOW.toISOString(), issues: [] });
  });

  it("on: a run by hand (made while the check was off, or now) is never what the app is shown", async () => {
    expect((await run(off)).status).toBe(200);
    expect((await run()).status).toBe(200);
    expect((await latest()).text).toBe("");
  });

  it("on, before any run: nothing to show", async () => {
    const l = await latest();
    expect(l.status).toBe(200);
    expect(l.text).toBe("");
  });
});
