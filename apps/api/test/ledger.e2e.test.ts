import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import type { TxType } from "../src/domain/classify";
import { type AccountKind, type LedgerContext, type LedgerRow, ACCOUNT_KINDS, limitSpentByDay } from "../src/domain/ledger";
import { Clock } from "../src/today/clock";

// «Потрачено» in the calendar and today's spent are counted in Postgres by the limit SQL. These tests
// seed rows of every kind into the real database and check that what the service returns is exactly
// what ledgerEffect says about the same rows, read back after the service ran.

let app: INestApplication;
let ds: DataSource;
let auth: string;
let seq = 0;

const TODAY = "2026-11-12";
const MONTH = "2026-11";
const http = () => app.getHttpServer();
const get = (p: string) => request(http()).get(p).set("Authorization", auth);

beforeAll(async () => {
  const url = await createMigratedDatabase();
  ds = new DS({ type: "postgres", url });
  await ds.initialize();
  app = await createTestApp(url);
  app.get(Clock).fixed = new Date(`${TODAY}T10:00:00Z`);
  const login = await request(http()).post("/auth/login").send({ password: TEST_PASSWORD, deviceName: "t" });
  auth = `Bearer ${login.body.token as string}`;
});
afterAll(async () => {
  await app.close();
  await ds.destroy();
});
beforeEach(async () => {
  await ds.query(
    `TRUNCATE jobs, rules, transactions, accounts, fx_rates, income_events, expected_incomes,
              scheduled_payments, recurring_payments, manual_balances, loans, bridge_plans, daily_snapshots, goals
     RESTART IDENTITY CASCADE`,
  );
  await ds.query(
    `UPDATE settings SET lifestyle_cap=100000000, food_floor=45000, tax_rate_bp=600, esv_quarter=0, cash_start=NULL,
       last_sync_at=NULL, last_contact_at=NULL, tracking_start='2026-01-01'`,
  );
});

const ALL_TYPES: readonly (TxType | null)[] = [
  "income", "spend", "obligation", "tax", "debt_payment", "loan_in", "own_transfer", "person_transfer",
  "person_in", "cash_in", "cash_out", "goal_contribution", "loan_out", null,
];

interface Seed {
  type: TxType | null;
  kind: AccountKind;
  amountUah: number | null;
  date: string;
}

/** One account of every kind; returns the id by kind. */
async function accounts(): Promise<Map<AccountKind, number>> {
  const ids = new Map<AccountKind, number>();
  for (const kind of ACCOUNT_KINDS) {
    seq++;
    const r = await ds.query(`INSERT INTO accounts (external_id, kind, currency, balance, credit_limit) VALUES ($1,$2,'UAH',1000000,0) RETURNING id`, [`acc-${seq}`, kind]);
    ids.set(kind, r[0].id);
  }
  return ids;
}

async function seed(rows: readonly Seed[], cashStart: string | null): Promise<void> {
  await ds.query(`UPDATE settings SET cash_start=$1`, [cashStart]);
  const ids = await accounts();
  for (const r of rows) {
    seq++;
    await ds.query(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, raw)
       VALUES ($1,$2,$3,$4,'x',$5,$6,$7,'{}')`,
      [`tx-${seq}`, ids.get(r.kind), `${r.date}T10:00:00Z`, r.date, r.amountUah ?? -1, r.amountUah, r.type],
    );
  }
}

/** The rows as they are in the database now, in the ledger's terms. */
async function storedRows(): Promise<LedgerRow[]> {
  const rows = (await ds.query(
    `SELECT t.type, a.kind, t.amount_uah::float8 AS amount_uah, t.local_date::text AS date, t.category
       FROM transactions t JOIN accounts a ON a.id=t.account_id`,
  )) as { type: TxType | null; kind: AccountKind; amount_uah: number | null; date: string; category: string | null }[];
  return rows.map((r) => ({ type: r.type, accountKind: r.kind, amountUah: r.amount_uah, localDate: r.date, category: r.category }));
}

/** What the service says: the calendar's spent for every day up to today, and today's spent on «Сегодня». */
async function served(): Promise<{ calendar: Map<string, number>; today: number }> {
  const t = await get("/today");
  expect(t.status).toBe(200);
  const c = await get(`/today/calendar?month=${MONTH}`);
  expect(c.status).toBe(200);
  const days = c.body.days as { date: string; spent: number }[];
  return {
    calendar: new Map(days.map((d) => [d.date, d.spent])),
    today: t.body.state.dailyLimit - t.body.state.leftToday,
  };
}

/** The ledger over the stored rows, laid out on the calendar's days. */
async function expected(): Promise<Map<string, number>> {
  const cashStart = ((await ds.query(`SELECT cash_start::text AS s FROM settings WHERE id=1`)) as { s: string | null }[])[0]!.s;
  const ctx: LedgerContext = { cashStart };
  const byDay = limitSpentByDay(await storedRows(), ctx);
  const out = new Map<string, number>();
  for (let d = 1; d <= 12; d++) {
    const date = `${MONTH}-${String(d).padStart(2, "0")}`;
    out.set(date, byDay.get(date) ?? 0);
  }
  return out;
}

async function check(): Promise<Map<string, number>> {
  const got = await served();
  const want = await expected();
  expect(got.calendar).toEqual(want);
  expect(got.today).toBe(want.get(TODAY));
  expect(got.calendar.get(TODAY)).toBe(got.today);
  return want;
}

const COVER_DATES = ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"];

/**
 * Every type on every account kind, spread over the days around the wallet start, with refunds,
 * rows without a hryvnia amount and a zero amount among them; then fixed probes on days of their own.
 */
function coverRows(): Seed[] {
  const rows: Seed[] = [];
  let i = 0;
  for (const type of ALL_TYPES) {
    for (const kind of ACCOUNT_KINDS) {
      const amountUah = i % 11 === 0 ? null : i % 13 === 0 ? 0 : i % 5 === 0 ? (i + 1) * 700 : -(i + 1) * 1_000;
      rows.push({ type, kind, amountUah, date: COVER_DATES[i % COVER_DATES.length]! });
      i++;
    }
  }
  // A withdrawal from a card before, on and after the wallet start (10 November), on every non-jar kind.
  for (const date of ["2026-11-09", "2026-11-10", "2026-11-11"]) {
    for (const kind of ACCOUNT_KINDS) rows.push({ type: "cash_out", kind, amountUah: -50_000, date });
  }
  // A day with only a refund on it goes below zero, as it does on the server now (an open question).
  rows.push({ type: "spend", kind: "black", amountUah: 5_000, date: "2026-11-03" });
  // A counted row of zero still makes the day; a row without a hryvnia amount alone does not.
  rows.push({ type: "spend", kind: "white", amountUah: 0, date: "2026-11-04" });
  rows.push({ type: "person_transfer", kind: "black", amountUah: null, date: "2026-11-05" });
  // Jars never count, and the 'other' kind does.
  rows.push({ type: "spend", kind: "jar", amountUah: -70_000, date: "2026-11-02" });
  rows.push({ type: "spend", kind: "other", amountUah: -8_000, date: "2026-11-01" });
  return rows;
}

describe("the limit in the database is the ledger's", () => {
  it("with a cash wallet: calendar and today's spent equal limitSpentByDay over the same rows", async () => {
    await seed(coverRows(), "2026-11-10");
    const want = await check();
    expect(want.get("2026-11-01")).toBe(8_000);
    expect(want.get("2026-11-02")).toBe(0);
    expect(want.get("2026-11-03")).toBe(-5_000);
    expect(want.get("2026-11-04")).toBe(0);
    expect(want.get("2026-11-05")).toBe(0);
  });

  it("without a cash wallet every withdrawal counts", async () => {
    await seed(coverRows(), null);
    const withoutWallet = await check();
    await ds.query(`UPDATE settings SET cash_start='2026-11-10'`);
    const withWallet = await expected();
    // The day before the wallet start is the same either way; from the start the withdrawals stop counting.
    expect(withoutWallet.get("2026-11-09")).toBe(withWallet.get("2026-11-09"));
    for (const d of ["2026-11-10", "2026-11-11"]) expect(withoutWallet.get(d), d).not.toBe(withWallet.get(d));
  });

  it("random row sets (20 seeds) give the same days in the database and in the ledger", async () => {
    for (let s = 1; s <= 20; s++) {
      await ds.query(`TRUNCATE transactions, accounts, daily_snapshots RESTART IDENTITY CASCADE`);
      const r = rng(s);
      const dates = Array.from({ length: 12 }, (_, d) => `${MONTH}-${String(d + 1).padStart(2, "0")}`);
      const rows: Seed[] = Array.from({ length: 10 + Math.floor(r() * 30) }, () => ({
        type: pick(r, ALL_TYPES),
        kind: pick(r, ACCOUNT_KINDS),
        amountUah: r() < 0.1 ? null : Math.round((r() - 0.8) * 1_000_000),
        date: pick(r, dates),
      }));
      await seed(rows, r() < 0.3 ? null : pick(r, dates));
      const got = await served();
      const want = await expected();
      expect(got.calendar, `seed ${s}`).toEqual(want);
      expect(got.today, `seed ${s}`).toBe(want.get(TODAY));
    }
  });
});

/** mulberry32, as in ledger.test.ts: a failure prints a seed that reproduces it. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
