import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insightsMonthDto } from "@hale/contracts";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { spentSql } from "../src/domain/ledger";
import { Clock, kyivDaySql } from "../src/time/clock";

// Task В1: «Итоги» for a month. Spending is the limit's one definition, so for any stretch the categories add up to
// exactly what spentSql (the «потрачено» of «Сегодня») gives over the same days, whatever else lies in the table.

let app: INestApplication;
let ds: DataSource;
let auth: string;
let seq = 0;

const NOW = new Date("2026-11-16T10:00:00Z");
const http = () => app.getHttpServer();
const get = (p: string) => request(http()).get(p).set("Authorization", auth);

beforeAll(async () => {
  const url = await createMigratedDatabase();
  ds = new DS({ type: "postgres", url });
  await ds.initialize();
  app = await createTestApp(url);
  app.get(Clock).fixed = NOW;
  const login = await request(http()).post("/auth/login").send({ password: TEST_PASSWORD, deviceName: "t" });
  auth = `Bearer ${login.body.token as string}`;
});
afterAll(async () => {
  await app.close();
  await ds.destroy();
});

async function account(kind: string): Promise<number> {
  seq++;
  return (await ds.query(`INSERT INTO accounts (external_id, kind, currency, balance) VALUES ($1,$2,'UAH',0) RETURNING id`, [`acc-${seq}`, kind]))[0].id;
}

/** `at` is an instant; its Kyiv day is the row's day. `amountUah` null is a row the rate was not known for. */
async function tx(accountId: number, at: string, amount: number, type: string, category: string | null, amountUah: number | null = amount): Promise<void> {
  seq++;
  await ds.query(
    `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, category, raw)
     VALUES ($1,$2,$3,${kyivDaySql("$3::timestamptz")},'x',$4,$5,$6,$7,'{}')`,
    [`tx-${seq}`, accountId, at, amount, amountUah, type, category],
  );
}

const limitSpent = async (from: string, to: string): Promise<number> => (await ds.query(spentSql("$1", "$2"), [from, to]))[0].s;

beforeEach(async () => {
  await ds.query(
    `TRUNCATE jobs, rules, transactions, accounts, fx_rates, income_events, expected_incomes,
              scheduled_payments, recurring_payments, manual_balances, loans, bridge_plans, daily_snapshots, goals
     RESTART IDENTITY CASCADE`,
  );
  await ds.query(`UPDATE settings SET cash_start='2026-11-10'`);
  const black = await account("black");
  const white = await account("white");
  const jar = await account("jar");

  // November, up to the 16th.
  await tx(black, "2026-11-02T10:00:00Z", -40_000, "spend", "groceries");
  await tx(black, "2026-11-03T10:00:00Z", -12_000, "spend", "groceries");
  await tx(white, "2026-11-04T10:00:00Z", -9_000, "spend", "cafe");
  await tx(black, "2026-11-05T10:00:00Z", -30_000, "spend", "shopping");
  await tx(black, "2026-11-06T10:00:00Z", 12_000, "spend", "refund"); // a refund of part of the purchase
  await tx(black, "2026-11-06T11:00:00Z", 2_000, "spend", "cafe"); // a refund inside a category
  await tx(black, "2026-11-07T10:00:00Z", -25_000, "person_transfer", "people");
  await tx(black, "2026-11-08T10:00:00Z", -5_000, "cash_out", null); // before the wallet start: counts
  await tx(black, "2026-11-11T10:00:00Z", -7_000, "cash_out", null); // after it: moves money into the wallet
  await tx(jar, "2026-11-09T10:00:00Z", -99_000, "spend", "shopping"); // a purchase from a jar
  await tx(black, "2026-11-09T12:00:00Z", -50_000, "own_transfer", "own");
  await tx(white, "2026-11-09T12:01:00Z", 50_000, "own_transfer", "own");
  await tx(black, "2026-11-10T10:00:00Z", -80_000, "obligation", "utilities"); // a payment outside the limit
  await tx(black, "2026-11-12T10:00:00Z", -3_000, "spend", "subscriptions", null); // no hryvnia amount
  await tx(black, "2026-11-13T10:00:00Z", -1_500, "spend", null);

  // October: up to the 16th by Kyiv day, and after it.
  await tx(black, "2026-10-01T10:00:00Z", -20_000, "spend", "groceries");
  await tx(white, "2026-10-10T10:00:00Z", -6_000, "spend", "transport");
  await tx(black, "2026-10-16T20:59:00Z", -4_000, "spend", "cafe"); // 23:59 in Kyiv: still the 16th
  await tx(black, "2026-10-16T21:01:00Z", -70_000, "spend", "groceries"); // 00:01 on the 17th in Kyiv
  await tx(black, "2026-10-25T10:00:00Z", -11_000, "spend", "health");
  // September.
  await tx(black, "2026-09-30T10:00:00Z", -8_000, "spend", "leisure");
});

describe("GET /insights/month", () => {
  it("needs the owner's sign-in", async () => {
    await request(http()).get("/insights/month").expect(401);
    await request(http()).get("/insights/month?month=2026-10").expect(401);
  });

  it("counts the current Kyiv month to today against the same days of the month before", async () => {
    const r = await get("/insights/month").expect(200);
    expect(insightsMonthDto.safeParse(r.body).success).toBe(true);
    expect(r.body).toEqual({
      month: "2026-11",
      through: "2026-11-16",
      previous: { from: "2026-10-01", to: "2026-10-16" },
      spent: 40_000 + 12_000 + 9_000 - 2_000 + 30_000 - 12_000 + 25_000 + 5_000 + 1_500,
      previousSpent: 20_000 + 6_000 + 4_000,
      categories: [
        { category: "groceries", spent: 52_000, previousSpent: 20_000, count: 2 },
        { category: "shopping", spent: 30_000, previousSpent: 0, count: 1 },
        { category: "people", spent: 25_000, previousSpent: 0, count: 1 },
        { category: "cafe", spent: 7_000, previousSpent: 4_000, count: 2 },
        { category: "uncategorized", spent: 6_500, previousSpent: 0, count: 2 },
        { category: "transport", spent: 0, previousSpent: 6_000, count: 0 },
        { category: "refund", spent: -12_000, previousSpent: 0, count: 1 },
      ],
    });
  });

  it("adds up to the limit's spending over the same days, for both stretches", async () => {
    for (const q of ["", "?month=2026-10", "?month=2026-09"]) {
      const { body } = await get(`/insights/month${q}`).expect(200);
      expect(insightsMonthDto.safeParse(body).success).toBe(true);
      const sum = (k: "spent" | "previousSpent") => body.categories.reduce((s: number, c: Record<string, number>) => s + c[k]!, 0);
      expect(sum("spent")).toBe(body.spent);
      expect(sum("previousSpent")).toBe(body.previousSpent);
      expect(body.spent).toBe(await limitSpent(`${body.month}-01`, body.through));
      expect(body.previousSpent).toBe(await limitSpent(body.previous.from, body.previous.to));
    }
  });

  it("counts a past month to its last day", async () => {
    const { body } = await get("/insights/month?month=2026-10").expect(200);
    expect(body).toMatchObject({ month: "2026-10", through: "2026-10-31", previous: { from: "2026-09-01", to: "2026-09-30" } });
    expect(body.spent).toBe(20_000 + 6_000 + 4_000 + 70_000 + 11_000);
    expect(body.previousSpent).toBe(8_000);
  });

  it("answers a month with nothing in it with zeros", async () => {
    const { body } = await get("/insights/month?month=2025-01").expect(200);
    expect(body).toEqual({ month: "2025-01", through: "2025-01-31", previous: { from: "2024-12-01", to: "2024-12-31" }, spent: 0, previousSpent: 0, categories: [] });
  });

  it("refuses a malformed month and a month in the future", async () => {
    for (const q of ["?month=2026-13", "?month=2026-1", "?month=nov", "?month=2026-11&x=1"]) await get(`/insights/month${q}`).expect(400);
    await get("/insights/month?month=2026-12").expect(400);
  });
});
