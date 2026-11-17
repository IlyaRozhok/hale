import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import type { TxType } from "../src/domain/classify";
import { type AccountKind, type LedgerContext, type LedgerRow, ACCOUNT_KINDS, countsAgainstLimit, ledgerEffect, limitSpentByDay, walletChange } from "../src/domain/ledger";
import { Clock } from "../src/time/clock";

// «Потрачено» in the calendar and today's spent are counted in Postgres by the limit SQL, and the «Траты»
// group of the list is filtered by the spend-group SQL while its day totals, its summary and the inLimit
// mark of every row go by the limit SQL (Б2). These tests seed rows of every kind into the real database
// and check that what the services return is exactly what ledgerEffect says about the same rows, read
// back after the service ran.

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
    `UPDATE settings SET lifestyle_cap=100000000, food_floor=45000, tax_rate_bp=600, esv_quarter=0, cash_start=NULL, cash_started_at=NULL,
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
  /** UTC time of day; 10:00:00 (12:00 Kyiv) when left out. */
  time?: string;
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
      [`tx-${seq}`, ids.get(r.kind), `${r.date}T${r.time ?? "10:00:00"}Z`, r.date, r.amountUah ?? -1, r.amountUah, r.type],
    );
  }
}

interface StoredRow extends LedgerRow {
  id: number;
}

/** The rows as they are in the database now, in the ledger's terms. */
async function storedRows(): Promise<StoredRow[]> {
  const rows = (await ds.query(
    `SELECT t.id, t.type, a.kind, t.amount_uah::float8 AS amount_uah, t.local_date::text AS date, t.category, t.occurred_at
       FROM transactions t JOIN accounts a ON a.id=t.account_id`,
  )) as { id: number; type: TxType | null; kind: AccountKind; amount_uah: number | null; date: string; category: string | null; occurred_at: Date }[];
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    accountKind: r.kind,
    amountUah: r.amount_uah,
    localDate: r.date,
    occurredAt: r.occurred_at.getTime(),
    category: r.category,
  }));
}

async function context(): Promise<LedgerContext> {
  const s = ((await ds.query(`SELECT cash_start::text AS s, cash_started_at AS at FROM settings WHERE id=1`)) as { s: string | null; at: Date | null }[])[0]!;
  return { cashStart: s.s, cashStartedAt: s.at === null ? null : s.at.getTime() };
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
    // dailyLimit − leftToday is today's spent only because nothing else moves leftToday here:
    // no daily_snapshots and no bridge_plans are seeded.
    today: t.body.state.dailyLimit - t.body.state.leftToday,
  };
}

/** The ledger over the stored rows, laid out on the calendar's days. */
async function expected(): Promise<Map<string, number>> {
  const ctx = await context();
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

describe("the wallet in the database is the ledger's (Б39)", () => {
  /** Withdrawals on every bank account kind before, around and after a start at 11:00 Kyiv (09:00Z) on 10 November, and rows on the wallet. */
  function walletRows(): Seed[] {
    const rows: Seed[] = [];
    for (const kind of ACCOUNT_KINDS.filter((k) => k !== "cash")) {
      rows.push({ type: "cash_out", kind, amountUah: -10_000, date: "2026-11-09", time: "20:00:00" });
      rows.push({ type: "cash_out", kind, amountUah: -20_000, date: "2026-11-10", time: "07:00:00" });
      rows.push({ type: "cash_out", kind, amountUah: -40_000, date: "2026-11-10", time: "09:00:00" });
      rows.push({ type: "cash_out", kind, amountUah: -80_000, date: "2026-11-10", time: "12:00:00" });
      rows.push({ type: "cash_out", kind, amountUah: -160_000, date: "2026-11-11", time: "06:00:00" });
    }
    rows.push({ type: "own_transfer", kind: "cash", amountUah: 500_000, date: "2026-11-10", time: "09:00:00" });
    rows.push({ type: "spend", kind: "cash", amountUah: -3_000, date: "2026-11-10", time: "08:00:00" });
    return rows;
  }
  const walletServed = async () => (await get("/cash").expect(200)).body.balance as number;
  const walletExpected = async () => {
    const ctx = await context();
    return (await storedRows()).reduce((s, r) => s + walletChange(r, ctx), 0);
  };

  it("started at a moment: withdrawals before it on its day stay out of the wallet, in the database and in the ledger", async () => {
    await seed(walletRows(), "2026-11-10");
    await ds.query(`UPDATE settings SET cash_started_at='2026-11-10T09:00:00Z'`);
    // On the black, white, fop and 'other' accounts (jars never feed the wallet): 40 + 80 + 160 thousand each.
    const want = 4 * (40_000 + 80_000 + 160_000) + 500_000 - 3_000;
    expect(await walletExpected()).toBe(want);
    expect(await walletServed()).toBe(want);
    // The spending side stays by day: none of the start day's withdrawals counts.
    await check();
  });

  it("without a moment (a start before Б39) the whole start day goes into the wallet, in both", async () => {
    await seed(walletRows(), "2026-11-10");
    const want = 4 * (20_000 + 40_000 + 80_000 + 160_000) + 500_000 - 3_000;
    expect(await walletExpected()).toBe(want);
    expect(await walletServed()).toBe(want);
  });
});

interface SpendGroup {
  /** Ids on the list, sorted. */
  ids: number[];
  /** Ids of the listed rows marked as counting against the limit, sorted. */
  inLimit: number[];
  /**
   * The total of every listed day, signed as the rows are (−spent): what the day took from the limit.
   * A day none of whose rows counts against the limit has none.
   */
  dayTotals: Record<string, number>;
  /** The period summary over the whole month: the limit's sum and the count of the counted rows. */
  summary: { total: number; count: number };
}

const sortedIds = (ids: readonly number[]) => [...ids].sort((a, b) => a - b);
const pageIds = (body: { items: { id: number }[] }) => sortedIds(body.items.map((i) => i.id));
const markedIds = (body: { items: { id: number; inLimit?: boolean }[] }) => sortedIds(body.items.filter((i) => i.inLimit === true).map((i) => i.id));

/** What the list says for «Траты»: one page of everything, its day totals, and the summary over the month. */
async function servedSpendGroup(): Promise<SpendGroup> {
  const page = await get("/transactions?group=spend&limit=200");
  expect(page.status).toBe(200);
  expect(page.body.nextCursor).toBeNull();
  expect(page.body.summary).toBeNull();
  const period = await get(`/transactions?group=spend&limit=200&from=${MONTH}-01&to=${MONTH}-12`);
  expect(period.status).toBe(200);
  expect(period.body.nextCursor).toBeNull();
  // The period covers every seeded day, so the page is the same and the summary is over all of it.
  expect(pageIds(period.body)).toEqual(pageIds(page.body));
  expect(period.body.dayTotals).toEqual(page.body.dayTotals);
  expect(markedIds(period.body)).toEqual(markedIds(page.body));
  // Every listed row says whether it counts: the mark is never left out.
  for (const i of page.body.items as { inLimit?: boolean }[]) expect(typeof i.inLimit).toBe("boolean");
  return {
    ids: pageIds(page.body),
    inLimit: markedIds(page.body),
    dayTotals: page.body.dayTotals as Record<string, number>,
    summary: period.body.summary as { total: number; count: number },
  };
}

/**
 * The ledger over the stored rows: the rows in the group, and over those of them that count against
 * the limit their day sums (−limitSpentByDay), their sum and their count.
 */
async function expectedSpendGroup(): Promise<SpendGroup> {
  const ctx = await context();
  const rows = (await storedRows()).filter((r) => ledgerEffect(r, ctx).inSpendGroup);
  const counted = rows.filter((r) => countsAgainstLimit(r, ctx));
  const dayTotals: Record<string, number> = {};
  // `0 - x` rather than `-x`: a day of zero gives 0, not -0.
  for (const [date, spent] of limitSpentByDay(rows, ctx)) dayTotals[date] = 0 - spent;
  return {
    ids: sortedIds(rows.map((r) => r.id)),
    inLimit: sortedIds(counted.map((r) => r.id)),
    dayTotals,
    summary: { total: 0 - counted.reduce((s, r) => s + ledgerEffect(r, ctx).limitSpend, 0), count: counted.length },
  };
}

/** Checks the list against the ledger and returns the listed rows. */
async function checkSpendGroup(): Promise<StoredRow[]> {
  const got = await servedSpendGroup();
  const want = await expectedSpendGroup();
  expect(got.ids).toEqual(want.ids);
  expect(got.inLimit).toEqual(want.inLimit);
  expect(got.dayTotals).toEqual(want.dayTotals);
  expect(got.summary).toEqual(want.summary);
  return (await storedRows()).filter((r) => want.ids.includes(r.id));
}

/** The day totals and the summary of «Все» over the month stay the plain signed sum of every row, as before Б2. */
async function checkAllGroupUnchanged(): Promise<void> {
  const period = await get(`/transactions?group=all&limit=200&from=${MONTH}-01&to=${MONTH}-12`);
  expect(period.status).toBe(200);
  expect(period.body.nextCursor).toBeNull();
  const rows = await storedRows();
  const dayTotals: Record<string, number> = {};
  for (const r of rows) {
    if (r.amountUah === null) continue;
    dayTotals[r.localDate] = (dayTotals[r.localDate] ?? 0) + r.amountUah;
  }
  expect(pageIds(period.body)).toEqual(sortedIds(rows.map((r) => r.id)));
  expect(period.body.dayTotals).toEqual(dayTotals);
  expect(period.body.summary).toEqual({ total: rows.reduce((s, r) => s + (r.amountUah ?? 0), 0), count: rows.length });
}

describe("the «Траты» group in the database is the ledger's", () => {
  const ofType = (rows: readonly StoredRow[], type: TxType | null) => rows.filter((r) => r.type === type);
  const onEveryKind = (date: string) => Array<string>(ACCOUNT_KINDS.length).fill(date);

  it("with a cash wallet: the list equals inSpendGroup, its day totals and summary the limit, over the same rows", async () => {
    await seed(coverRows(), "2026-11-10");
    const listed = await checkSpendGroup();
    // The group is wider than the limit on purpose (Б2): payments, taxes, debts and loans out are listed but
    // marked as not counting; jars and rows without a hryvnia amount are not filtered out either.
    for (const type of ["obligation", "tax", "debt_payment", "loan_out"] as const) expect(ofType(listed, type).length, type).toBe(ACCOUNT_KINDS.length);
    const outside: readonly (TxType | null)[] = ["income", "person_in", "cash_in", "own_transfer", "loan_in", "goal_contribution", null];
    for (const type of outside) expect(ofType(listed, type), String(type)).toEqual([]);
    expect(listed.some((r) => r.accountKind === "jar" && r.type === "spend" && r.amountUah === -70_000)).toBe(true);
    expect(listed.some((r) => r.type === "person_transfer" && r.amountUah === null && r.localDate === "2026-11-05")).toBe(true);
    // A withdrawal is listed before the wallet start and not on or after it, on every kind.
    const cashOut = ofType(listed, "cash_out").filter((r) => r.amountUah === -50_000);
    expect(cashOut.map((r) => r.localDate)).toEqual(onEveryKind("2026-11-09"));
    await checkAllGroupUnchanged();
  });

  it("the day totals and the summary under «Траты» are the calendar's «потрачено» with the sign of the rows", async () => {
    await seed(coverRows(), "2026-11-10");
    const got = await servedSpendGroup();
    const calendar = (await served()).calendar;
    for (const [date, total] of Object.entries(got.dayTotals)) expect(total, date).toBe(0 - calendar.get(date)!);
    // A day whose listed rows are all outside the limit has no total; the calendar shows zero for it.
    expect(got.dayTotals["2026-11-02"]).toBeUndefined();
    expect(calendar.get("2026-11-02")).toBe(0);
    const spentInMonth = [...calendar.values()].reduce((s, x) => s + x, 0);
    expect(got.summary.total).toBe(0 - spentInMonth);
    const ctx = await context();
    expect(got.summary.count).toBe((await storedRows()).filter((r) => countsAgainstLimit(r, ctx)).length);
  });

  it("an obligation, a tax, a debt payment, a loan out and a jar row are listed, marked and left out of the total", async () => {
    await seed(
      [
        { type: "spend", kind: "black", amountUah: -10_000, date: "2026-11-06" },
        { type: "obligation", kind: "black", amountUah: -20_000, date: "2026-11-06" },
        { type: "tax", kind: "fop", amountUah: -30_000, date: "2026-11-06" },
        { type: "debt_payment", kind: "white", amountUah: -40_000, date: "2026-11-06" },
        { type: "loan_out", kind: "black", amountUah: -50_000, date: "2026-11-06" },
        { type: "spend", kind: "jar", amountUah: -60_000, date: "2026-11-06" },
        { type: "obligation", kind: "black", amountUah: -70_000, date: "2026-11-07" },
      ],
      null,
    );
    const page = await get(`/transactions?group=spend&limit=200&from=2026-11-06&to=2026-11-07`);
    expect(page.status).toBe(200);
    const items = page.body.items as { type: string; accountKind: string; inLimit: boolean }[];
    expect(items).toHaveLength(7);
    expect(items.filter((i) => i.inLimit).map((i) => i.type)).toEqual(["spend"]);
    expect(items.find((i) => i.accountKind === "jar")!.inLimit).toBe(false);
    expect(page.body.dayTotals).toEqual({ "2026-11-06": -10_000 });
    expect(page.body.summary).toEqual({ total: -10_000, count: 1 });
  });

  it("without a cash wallet every withdrawal is listed", async () => {
    await seed(coverRows(), null);
    const listed = await checkSpendGroup();
    const cashOut = ofType(listed, "cash_out").filter((r) => r.amountUah === -50_000);
    expect(cashOut.map((r) => r.localDate).sort()).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"].flatMap(onEveryKind));
  });

  it("random row sets (20 seeds) give the same list in the database and in the ledger", async () => {
    for (let s = 1; s <= 20; s++) {
      await ds.query(`TRUNCATE transactions, accounts RESTART IDENTITY CASCADE`);
      const r = rng(s);
      const dates = Array.from({ length: 12 }, (_, d) => `${MONTH}-${String(d + 1).padStart(2, "0")}`);
      const rows: Seed[] = Array.from({ length: 10 + Math.floor(r() * 30) }, () => ({
        type: pick(r, ALL_TYPES),
        kind: pick(r, ACCOUNT_KINDS),
        amountUah: r() < 0.1 ? null : Math.round((r() - 0.8) * 1_000_000),
        date: pick(r, dates),
      }));
      await seed(rows, r() < 0.3 ? null : pick(r, dates));
      expect(await servedSpendGroup(), `seed ${s}`).toEqual(await expectedSpendGroup());
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
