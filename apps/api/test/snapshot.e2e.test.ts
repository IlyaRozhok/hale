import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { NotificationsService } from "../src/notifications/notifications.service";
import { Clock } from "../src/time/clock";
import { TodayService } from "../src/today/today.service";

/**
 * Task Б3, invariant 8 of the audit: the same facts give the same limit, and reading «Сегодня» is apart from
 * writing the day's row. `GET /today` changes nothing; the row is written by `ensureSnapshot` (the 15-minute
 * job, the night jobs, confirming or cancelling a plan) with exactly the figures the read showed before it ran.
 */

let app: INestApplication;
let ds: DataSource;
let auth: string;
let clock: Clock;
let seq = 0;

const http = () => app.getHttpServer();
const api = {
  get: (p: string) => request(http()).get(p).set("Authorization", auth),
  post: (p: string, b: object = {}) => request(http()).post(p).set("Authorization", auth).send(b),
  delete: (p: string) => request(http()).delete(p).set("Authorization", auth),
};
const at = (iso: string) => {
  clock.fixed = new Date(iso);
};

beforeAll(async () => {
  const url = await createMigratedDatabase();
  ds = new DS({ type: "postgres", url });
  await ds.initialize();
  app = await createTestApp(url);
  clock = app.get(Clock);
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
    `UPDATE settings SET lifestyle_cap=100000000, food_floor=45000, tax_rate_bp=600, esv_quarter=0, last_sync_at=NULL, last_contact_at=NULL, tracking_start='2026-01-01'`,
  );
  at("2026-11-02T10:00:00Z");
});

async function account(kind: string, balance: number, over: { creditLimit?: number } = {}): Promise<number> {
  seq++;
  return (
    await ds.query(
      `INSERT INTO accounts (external_id, kind, currency, balance, credit_limit) VALUES ($1,$2,'UAH',$3,$4) RETURNING id`,
      [`acc-${seq}`, kind, balance, over.creditLimit ?? 0],
    )
  )[0].id;
}
const setBalance = (id: number, balance: number) => ds.query(`UPDATE accounts SET balance=$2 WHERE id=$1`, [id, balance]);

async function tx(accountId: number, amount: number, type: string, date = "2026-11-02"): Promise<void> {
  seq++;
  await ds.query(
    `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, raw)
     VALUES ($1,$2,$3,$4,'x',$5,$5,$6,'{}')`,
    [`tx-${seq}`, accountId, `${date}T10:00:00Z`, date, amount, type],
  );
}

async function income(on: string): Promise<void> {
  const exp = (
    await ds.query(
      `INSERT INTO expected_incomes (source, pays_fop_tax, crypto, amount, currency, window_start_day, window_end_day) VALUES ('fop', true, false, 500000,'UAH',15,25) RETURNING id`,
    )
  )[0].id;
  await ds.query(`INSERT INTO income_events (expected_income_id, period, expected_on, status) VALUES ($1,$2,$3,'expected')`, [exp, on.slice(0, 7), on]);
}
const payment = (name: string, amount: number, due: string) =>
  ds.query(`INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation',$1,$2,'UAH',$3)`, [name, amount, due]);
const fixed = (date: string, amount: number, mode: string) =>
  ds.query(`INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ($1,$2,$3)`, [date, amount, mode]);

const today = async () => (await api.get("/today").expect(200)).body;
const calendar = async () => (await api.get("/today/calendar?month=2026-11").expect(200)).body;
const ensure = () => app.get(TodayService).ensureSnapshot();

/** Every column of every row, as Postgres prints them. */
const snapshots = async (): Promise<string[]> =>
  ((await ds.query(`SELECT row_to_json(d)::text AS r FROM daily_snapshots d ORDER BY local_date`)) as { r: string }[]).map((x) => x.r);
/**
 * Each day's limit and mode, as Postgres prints them. Since ЧЛ2 a row also holds what its limit is made of
 * (`parts`, covered by limit-parts.e2e.test.ts), so the tests that spell a row out name these columns.
 */
const fixedDays = async (): Promise<string[]> =>
  ((await ds.query(`SELECT row_to_json(d)::text AS r FROM (SELECT local_date, daily_limit, mode FROM daily_snapshots) d ORDER BY local_date`)) as { r: string }[]).map((x) => x.r);
const plans = async (): Promise<string[]> =>
  ((await ds.query(`SELECT row_to_json(p)::text AS r FROM bridge_plans p ORDER BY id`)) as { r: string }[]).map((x) => x.r);

/** The money that makes 2 November an ordinary ₴1,000 day, with the 1st fixed as ordinary too. */
async function ordinary(): Promise<number> {
  const card = await account("black", 4_000_000, { creditLimit: 3_000_000 });
  await income("2026-11-12");
  await fixed("2026-11-01", 100_000, "normal");
  return card;
}

describe("GET /today only reads", () => {
  it("writes no row when the day has none", async () => {
    await ordinary();
    const before = await snapshots();
    const r = await today();
    expect(r.state).toMatchObject({ mode: "normal", dailyLimit: 100_000, leftToday: 100_000 });
    expect(await snapshots()).toEqual(before);
    expect(await snapshots()).toHaveLength(1); // only the 1st, seeded by the test
  });

  it("does not rewrite the row's mode when the shortage comes on", async () => {
    const card = await ordinary();
    await fixed("2026-11-02", 100_000, "normal");
    await tx(card, -1_100_000, "spend");
    await setBalance(card, 2_900_000);
    const before = await snapshots();
    const r = await today();
    expect(r.state).toMatchObject({ mode: "bridge", dailyLimit: 100_000, leftToday: -1_000_000 });
    expect(r.state.shortageStart).toEqual({ nextLimit: 45_000 });
    expect(await snapshots()).toEqual(before);
    expect(await calendar()).toMatchObject({});
    expect(await snapshots()).toEqual(before);
  });

  it("neither closes a plan that has ended nor recomputes one whose payments changed", async () => {
    const card = await account("black", 4_032_500, { creditLimit: 3_000_000 });
    await income("2026-11-20");
    await payment("Rent", 1_700_000, "2026-11-06");
    await api.post("/bridge", { dailyAmount: 100_000 }).expect(201);
    const plansBefore = await plans();
    const rowsBefore = await snapshots();

    await payment("Phone", 100_000, "2026-11-10");
    await today();
    expect(await plans()).toEqual(plansBefore);
    expect(await snapshots()).toEqual(rowsBefore);

    await setBalance(card, 10_000_000);
    expect((await today()).state.mode).toBe("normal");
    expect(await plans()).toEqual(plansBefore);
    expect(await snapshots()).toEqual(rowsBefore);
  });
});

describe("ensureSnapshot writes the day", () => {
  it("creates the row once, shares it between concurrent calls and never rewrites its limit", async () => {
    const card = await ordinary();
    await Promise.all([1, 2, 3, 4, 5].map(() => ensure()));
    expect(await fixedDays()).toEqual([`{"local_date":"2026-11-01","daily_limit":100000,"mode":"normal"}`, `{"local_date":"2026-11-02","daily_limit":100000,"mode":"normal"}`]);
    await setBalance(card, 5_000_000); // more money: a fresh limit would be ₴2,000, the fixed one stays
    await ensure();
    expect((await fixedDays())[1]).toBe(`{"local_date":"2026-11-02","daily_limit":100000,"mode":"normal"}`);
  });

  it("marks the day the shortage came on, as the read used to, and the calendar finds it", async () => {
    const card = await ordinary();
    await ensure();
    await tx(card, -1_100_000, "spend");
    await setBalance(card, 2_900_000);
    await ensure();
    expect((await fixedDays())[1]).toBe(`{"local_date":"2026-11-02","daily_limit":100000,"mode":"bridge_start"}`);
    expect((await today()).state.shortageStart).toEqual({ nextLimit: 45_000 });
    expect((await calendar()).days.at(-1)).toEqual({ date: "2026-11-02", limit: 100_000, spent: 1_100_000, status: "today", shortageStart: true });

    // The shortage ends the same day: the mark goes, as before.
    await setBalance(card, 4_500_000);
    await ensure();
    expect((await fixedDays())[1]).toBe(`{"local_date":"2026-11-02","daily_limit":100000,"mode":"normal"}`);
    expect((await today()).state.shortageStart).toBeUndefined();
  });

  it("closes a plan that has ended and fixes the day afresh; recomputes a plan whose payments changed", async () => {
    const card = await account("black", 4_032_500, { creditLimit: 3_000_000 });
    await income("2026-11-20");
    await payment("Rent", 1_700_000, "2026-11-06");
    await api.post("/bridge", { dailyAmount: 100_000 }).expect(201);
    const creditPlan = async () => (await ds.query(`SELECT credit_plan::int AS c, closed_on FROM bridge_plans`))[0];
    expect(await creditPlan()).toEqual({ c: 2_467_500, closed_on: null });

    await payment("Phone", 100_000, "2026-11-10");
    await ensure();
    // free = 1,032,500 - 1,700,000 - 100,000 = -767,500; plus 18 * 100,000
    expect(await creditPlan()).toEqual({ c: 767_500 + 1_800_000, closed_on: null });

    await setBalance(card, 10_000_000);
    await ensure();
    expect((await creditPlan()).closed_on).not.toBeNull();
    expect((await today()).state.dailyLimit).toBeGreaterThan(100_000);
    expect((await snapshots())[0]).toContain(`"mode":"normal"`);
  });

  it("the 15-minute job and confirming or cancelling a plan write the day", async () => {
    const card = await ordinary();
    await app.get(NotificationsService).tick();
    expect(await snapshots()).toHaveLength(2);

    await tx(card, -1_100_000, "spend");
    await setBalance(card, 2_900_000);
    await api.post("/bridge", { dailyAmount: 60_000 }).expect(201);
    expect((await fixedDays())[1]).toBe(`{"local_date":"2026-11-02","daily_limit":60000,"mode":"bridge_start"}`);
    await api.delete("/bridge").expect(200);
    // Fixed afresh as the day began: with today's spending added back the morning is ordinary (as before Б3).
    expect((await fixedDays())[1]).toBe(`{"local_date":"2026-11-02","daily_limit":100000,"mode":"bridge_start"}`);
  });
});

describe("the same facts give the same figures (invariant 8)", () => {
  /** What the read says before any writer ran equals what it says once the row is there. */
  async function same(): Promise<void> {
    const before = await today();
    await ensure();
    const after = await today();
    expect(after).toEqual(before);
    // and the row the writer left is what the read had shown
    const row = (await ds.query(`SELECT daily_limit::int AS daily_limit FROM daily_snapshots WHERE local_date=$1`, [before.date]))[0];
    expect(row.daily_limit).toBe(before.state.dailyLimit);
  }

  it("an ordinary day", async () => {
    await ordinary();
    await same();
  });

  it("a first request late in the day, after some spending", async () => {
    const card = await ordinary();
    await tx(card, -30_000, "spend");
    await setBalance(card, 3_970_000);
    await same();
    expect((await today()).state).toMatchObject({ dailyLimit: 100_000, leftToday: 70_000 });
  });

  it("a shortage day with no plan, and the very first day", async () => {
    await account("black", 4_032_500, { creditLimit: 3_000_000 });
    await income("2026-11-20");
    await payment("Rent", 1_700_000, "2026-11-06");
    await same();
    expect((await today()).state).toMatchObject({ mode: "bridge", dailyLimit: 45_000 });
  });

  it("the new day after a crossing nobody saw before midnight", async () => {
    const card = await ordinary();
    await ensure();
    await tx(card, -1_100_000, "spend");
    await setBalance(card, 2_900_000);
    at("2026-11-02T22:05:00Z"); // 00:05 in Kyiv on the 3rd
    await same();
    const r = await today();
    expect(r.date).toBe("2026-11-03");
    expect(r.state).toMatchObject({ mode: "bridge", dailyLimit: 45_000 });
    // The new day began in shortage on the shortage's limit: an ordinary shortage day (Б47 (4)).
    expect(r.state.shortageStart).toBeUndefined();
  });

  it("a plan that has ended, before and after the writer closes it", async () => {
    const card = await account("black", 4_032_500, { creditLimit: 3_000_000 });
    await income("2026-11-20");
    await payment("Rent", 1_700_000, "2026-11-06");
    await api.post("/bridge", { dailyAmount: 100_000 }).expect(201);
    await setBalance(card, 10_000_000);
    await same();
    expect((await today()).state.mode).toBe("normal");
  });

  it("a plan whose payments changed, before and after the writer recomputes it", async () => {
    await account("black", 4_032_500, { creditLimit: 3_000_000 });
    await income("2026-11-20");
    await payment("Rent", 1_700_000, "2026-11-06");
    await api.post("/bridge", { dailyAmount: 100_000 }).expect(201);
    await payment("Phone", 100_000, "2026-11-10");
    await same();
    expect((await today()).state.bridge).toMatchObject({ confirmed: true, creditNeeded: 767_500 + 1_800_000 });
  });
});
