import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { observationTodayDto } from "@hale/contracts";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { Clock, kyivDaySql } from "../src/time/clock";
import { TodayService } from "../src/today/today.service";

// Task В7: one observation for the phrase of the day. Spending is the limit's one definition (as «Итоги»), the
// subscriptions are the ones «Итоги» find; the caps and «Не показывать такое» live in two tables (migration 0036).

let app: INestApplication;
let ds: DataSource;
let auth: string;
let clock: Clock;
let seq = 0;

const http = () => app.getHttpServer();
const get = (p: string) => request(http()).get(p).set("Authorization", auth);
const post = (p: string, b: object) => request(http()).post(p).set("Authorization", auth).send(b);
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

async function account(kind: string, balance: number, creditLimit = 0): Promise<number> {
  seq++;
  return (
    await ds.query(`INSERT INTO accounts (external_id, kind, currency, balance, credit_limit) VALUES ($1,$2,'UAH',$3,$4) RETURNING id`, [
      `acc-${seq}`,
      kind,
      balance,
      creditLimit,
    ])
  )[0].id;
}

/** A purchase at noon Kyiv time on `date`. */
async function tx(accountId: number, date: string, amount: number, category: string | null, counter: string | null = null, type = "spend"): Promise<void> {
  seq++;
  await ds.query(
    `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, counter_name, amount, amount_uah, type, category, raw)
     VALUES ($1,$2,$3,${kyivDaySql("$3::timestamptz")},'x',$4,$5,$5,$6,$7,'{}')`,
    [`tx-${seq}`, accountId, `${date}T10:00:00Z`, counter, amount, type, category],
  );
}

const observation = async () => {
  const r = await get("/observations/today").expect(200);
  expect(observationTodayDto.safeParse(r.body).success).toBe(true);
  return r.body.observation;
};
const shown = () => ds.query(`SELECT local_date::text AS date, kind, category FROM observations_shown ORDER BY local_date`);

const CAFE = { kind: "spike", period: "month", category: "cafe", spent: 482_000, usual: 310_000, amount: null, from: "2026-11-01", to: "2026-11-19" };

let black: number;

beforeEach(async () => {
  await ds.query(
    `TRUNCATE jobs, rules, transactions, accounts, fx_rates, income_events, expected_incomes, scheduled_payments,
              recurring_payments, manual_balances, loans, bridge_plans, daily_snapshots, goals, observations_shown, observation_dismissals
     RESTART IDENTITY CASCADE`,
  );
  at("2026-11-19T10:00:00Z");
  black = await account("black", 10_000_000);
  const jar = await account("jar", 0);
  // The history starts on 1 August: the three months before November are all there.
  await tx(black, "2026-08-01", -1_000, "groceries");
  // «Кафе»: the same days (1st–19th) of August, September, October, and November.
  await tx(black, "2026-08-05", -290_000, "cafe");
  await tx(black, "2026-09-05", -310_000, "cafe");
  await tx(black, "2026-10-05", -330_000, "cafe");
  await tx(black, "2026-10-25", -2_000_000, "cafe"); // after the 19th: not the same days
  await tx(black, "2026-11-05", -500_000, "cafe");
  await tx(black, "2026-11-06", 18_000, "cafe"); // money back inside the category lowers it
  await tx(jar, "2026-11-07", -900_000, "cafe"); // from a jar: not the limit's
  // Large, but never a spike.
  await tx(black, "2026-11-08", -900_000, null);
  await tx(black, "2026-11-08", 900_000, "refund");
});

describe("observations", () => {
  it("need the owner's sign-in", async () => {
    await request(http()).get("/observations/today").expect(401);
    await request(http()).post("/observations/shown").send({ kind: "spike", category: "cafe" }).expect(401);
    await request(http()).post("/observations/dismiss").send({ kind: "spike", category: "cafe" }).expect(401);
  });

  it("finds a category spent above the median of the same days of the three months before", async () => {
    expect(await observation()).toEqual(CAFE);
    // Reading writes nothing.
    expect(await shown()).toEqual([]);
  });

  it("finds nothing when the history does not reach back three months", async () => {
    await ds.query(`DELETE FROM transactions WHERE local_date < '2026-08-19'`);
    // The history now starts in September: neither the month's oldest span (from 1 August) nor the week's (from 13
    // August) is covered, so «Кафе» against September and October alone is not judged.
    expect(await observation()).toBeNull();
  });

  it("keeps the one shown today for the rest of the day, idempotently", async () => {
    expect((await post("/observations/shown", { kind: "spike", category: "cafe" }).expect(201)).body).toEqual({ observation: CAFE });
    // A larger spike later in the day does not replace it.
    await tx(black, "2026-11-18", -3_000_000, "shopping");
    await tx(black, "2026-09-10", -100_000, "shopping");
    await tx(black, "2026-10-10", -100_000, "shopping");
    await tx(black, "2026-08-10", -100_000, "shopping");
    expect(await observation()).toEqual(CAFE);
    expect((await post("/observations/shown", { kind: "spike", category: "cafe" }).expect(201)).body).toEqual({ observation: CAFE });
    expect(await shown()).toEqual([{ date: "2026-11-19", kind: "spike", category: "cafe" }]);
    // Another one cannot be marked shown the same day.
    await post("/observations/shown", { kind: "spike", category: "shopping" }).expect(409);
    // The next day: «Кафе» was shown a day ago and waits; the other one comes.
    at("2026-11-20T10:00:00Z");
    expect(await observation()).toMatchObject({ kind: "spike", category: "shopping", spent: 3_000_000, usual: 100_000 });
  });

  it("refuses to mark shown what is not today's observation", async () => {
    await post("/observations/shown", { kind: "spike", category: "groceries" }).expect(409);
    await post("/observations/shown", { kind: "subscriptions", category: null }).expect(409);
    await post("/observations/shown", { kind: "spike", category: null }).expect(400);
    await post("/observations/shown", { kind: "spike" }).expect(400);
    expect(await shown()).toEqual([]);
  });

  it("does not offer the same category again within seven days of showing it", async () => {
    await post("/observations/shown", { kind: "spike", category: "cafe" }).expect(201);
    at("2026-11-25T10:00:00Z");
    expect(await observation()).toBeNull();
    at("2026-11-26T10:00:00Z");
    expect(await observation()).toMatchObject({ kind: "spike", category: "cafe", to: "2026-11-26" });
  });

  it("offers nothing after three shown in the seven days before today", async () => {
    const mark = (date: string, category: string) =>
      ds.query(`INSERT INTO observations_shown (local_date, kind, category, observation) VALUES ($1,'spike',$2,'{}')`, [date, category]);
    await mark("2026-11-13", "a");
    await mark("2026-11-15", "b");
    await mark("2026-11-18", "c");
    expect(await observation()).toBeNull();
    await ds.query(`UPDATE observations_shown SET local_date='2026-11-12' WHERE category='a'`);
    expect(await observation()).toEqual(CAFE);
  });

  it("never offers a dismissed category again, and drops today's once it is dismissed", async () => {
    await post("/observations/shown", { kind: "spike", category: "cafe" }).expect(201);
    await post("/observations/dismiss", { kind: "spike", category: "cafe" }).expect(204);
    await post("/observations/dismiss", { kind: "spike", category: "cafe" }).expect(204);
    expect(await ds.query(`SELECT kind, category FROM observation_dismissals`)).toEqual([{ kind: "spike", category: "cafe" }]);
    expect(await observation()).toBeNull();
    at("2026-12-28T10:00:00Z");
    await tx(black, "2026-12-05", -900_000, "cafe");
    expect(await observation()).toBeNull();
    await post("/observations/dismiss", { kind: "subscriptions", category: "cafe" }).expect(400);
  });

  describe("in the shortage mode", () => {
    beforeEach(async () => {
      // Own money below zero: the card's balance is under its credit limit, the income comes on the 24th.
      await ds.query(`UPDATE accounts SET balance=1_000_000, credit_limit=3_000_000 WHERE id=$1`, [black]);
      const exp = (
        await ds.query(`INSERT INTO expected_incomes (source, pays_fop_tax, crypto, amount, currency, window_start_day, window_end_day) VALUES ('fop', true, false, 500000,'UAH',20,28) RETURNING id`)
      )[0].id;
      await ds.query(`INSERT INTO income_events (expected_income_id, period, expected_on, status) VALUES ($1,'2026-11','2026-11-24','expected')`, [exp]);
      // Netflix charges on the 20th: before the income. Spotify on the 26th: after it.
      for (const d of ["2026-08-20", "2026-09-20", "2026-10-20"]) await tx(black, d, -24_900, "subscriptions", "Netflix");
      for (const d of ["2026-08-26", "2026-09-26", "2026-10-26"]) await tx(black, d, -14_900, "subscriptions", "Spotify");
      await app.get(TodayService).ensureSnapshot();
      expect((await get("/today").expect(200)).body.state.mode).toBe("bridge");
    });

    it("offers no spike, only the subscriptions due within the week and before the income", async () => {
      expect(await observation()).toEqual({
        kind: "subscriptions",
        period: null,
        category: null,
        spent: null,
        usual: null,
        amount: 24_900,
        from: "2026-11-19",
        to: "2026-11-23",
      });
      expect((await post("/observations/shown", { kind: "subscriptions", category: null }).expect(201)).body.observation.amount).toBe(24_900);
    });

    it("offers nothing when no subscription is due before the income", async () => {
      await ds.query(`DELETE FROM transactions WHERE counter_name='Netflix'`);
      expect(await observation()).toBeNull();
    });

    it("stops the subscriptions kind once it is dismissed", async () => {
      await post("/observations/dismiss", { kind: "subscriptions", category: null }).expect(204);
      expect(await observation()).toBeNull();
    });
  });
});
