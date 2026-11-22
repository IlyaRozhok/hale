import request from "supertest";
import { DataSource } from "typeorm";
import { createDataSource, migrations } from "../src/db/data-source";
import { IncomeSources1796860800000 } from "../src/db/migrations/0039-income-sources";
import { PlanService } from "../src/plan/plan.service";
import { Clock } from "../src/time/clock";
import { TodayService } from "../src/today/today.service";
import { createTestApp, TEST_PASSWORD } from "./app";
import { fillOwnerAccounts } from "./owner-accounts";
import { createTestDatabase } from "./db";

// The owner's accounts (owner-accounts.ts) with incomes shaped like his (Д3а): the fop income with its October money on
// the fop account (so the quarter's tax accrues) and its November month still waiting, and a USDC income received in
// October, expected in a window around the day read, with an incoming transfer after it that may be the money from
// Binance. Rows are written the way a database before 0039 holds them: by `source` alone. The migration test fills a
// database at 0038 with it and checks that the limit, free money, the tax and the questions read the same after 0039.
type Query = (sql: string, args?: unknown[]) => Promise<unknown>;

export async function fillOwnerIncomes(q: Query): Promise<void> {
  await fillOwnerAccounts(q);
  const id = async (sql: string, args?: unknown[]) => ((await q(sql, args)) as { id: number }[])[0]!.id;
  const account = (ext: string) => id(`SELECT id FROM accounts WHERE external_id=$1`, [ext]);
  const fop = (await q(`SELECT id FROM expected_incomes WHERE source='fop'`)) as { id: number }[];
  const fopIncome = fop[0]!.id;
  const october = await id(
    `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, raw)
     VALUES ('fop-oct', $1, '2026-10-27T10:00:00Z', '2026-10-27', 'x', 20000000, 20000000, 'income', '{}') RETURNING id`,
    [await account("fop")],
  );
  await q(
    `INSERT INTO income_events (expected_income_id, period, expected_on, status, received_at, amount_uah, matched_transaction_id)
     VALUES ($1, '2026-10', '2026-10-28', 'received', '2026-10-27T10:00:00Z', 20000000, $2)`,
    [fopIncome, october],
  );
  const usdc = await id(
    `INSERT INTO expected_incomes (source, amount, currency, window_start_day, window_end_day) VALUES ('usdc', 120000, 'USD', 8, 12) RETURNING id`,
  );
  await q(
    `INSERT INTO income_events (expected_income_id, period, expected_on, status, received_at, amount_uah) VALUES
       ($1, '2026-10', '2026-10-12', 'received', '2026-10-09T10:00:00Z', 4980000),
       ($1, '2026-11', '2026-11-12', 'expected', NULL, NULL)`,
    [usdc],
  );
  await q(
    `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, raw)
     VALUES ('in-white', $1, '2026-11-05T10:00:00Z', '2026-11-05', 'x', 5000000, 5000000, 'person_in', '{}')`,
    [await account("white")],
  );
}

/** A new database with the owner's incomes filled at 0038 and every migration since run over them, 0039 included. */
export async function createOwnerIncomesDatabase(): Promise<string> {
  const url = await createTestDatabase();
  const before = new DataSource({ type: "postgres", url, migrations: migrations.slice(0, migrations.indexOf(IncomeSources1796860800000)) });
  await before.initialize();
  await before.runMigrations();
  await fillOwnerIncomes((sql, args) => before.query(sql, args));
  await before.destroy();
  const ds = createDataSource(url);
  await ds.initialize();
  await ds.runMigrations();
  await ds.destroy();
  return url;
}

/** The moment the comparison is read at: a Kyiv day inside the USDC window, before the fop window. */
export const OWNER_INCOMES_NOW = "2026-11-10T12:00:00Z";

/**
 * What the owner sees of his incomes, read through the API at OWNER_INCOMES_NOW after the hourly job: the day's money,
 * the questions, the income dates, what is left for goals, the incomes as an older app reads them, and the tax row the
 * quarter's rollover would write. The app starts on that moment's clock, so what its start generates does not depend
 * on the day the test runs.
 */
export async function ownerIncomesView(url: string): Promise<unknown> {
  const clock = new Clock();
  clock.fixed = new Date(OWNER_INCOMES_NOW);
  const app = await createTestApp(url, { overrides: [[Clock, clock]] });
  await app.get(PlanService).hourlyJob();
  const login = await request(app.getHttpServer()).post("/auth/login").send({ password: TEST_PASSWORD, deviceName: "t" });
  const auth = `Bearer ${login.body.token as string}`;
  const get = async (path: string) => (await request(app.getHttpServer()).get(path).set("Authorization", auth).expect(200)).body;
  await app.get(TodayService).ensureSnapshot();
  const today = await get("/today");
  const preview = (await request(app.getHttpServer()).post("/settings/preview").set("Authorization", auth).send({ lifestyleCap: 5_000_000 }).expect(201)).body;
  const events = (await get("/plan/incomes")) as { id: number; expected_income_id: number; period: string; expected_on: string; status: string; amount_uah: number | null }[];
  const incomes = (await get("/plan/expected-incomes")) as Record<string, unknown>[];
  await app.get(PlanService).ensureTaxEstimate("2027-01-02");
  const tax = await app.get(DataSource).query(`SELECT name, amount::float8 AS amount, tax_quarter FROM scheduled_payments WHERE kind='tax' ORDER BY id`);
  await app.close();
  return {
    state: { free: today.state.free, dailyLimit: today.state.dailyLimit, leftToday: today.state.leftToday, needsIncomeDate: today.state.needsIncomeDate },
    runway: { reserve: today.runway.reserve, endOn: today.runway.endOn, incomeOn: today.runway.incomeOn },
    accounts: { own: today.accounts.own, fop: today.accounts.fop, binance: today.accounts.binance },
    questions: (today.questions as { id: string; kind: string; text: string; expectedAmount?: number }[]).map((q) => [q.id, q.kind, q.text, q.expectedAmount ?? null]),
    leftForGoalsMonthly: preview.leftForGoalsMonthly,
    events: events.map((e) => [e.id, e.expected_income_id, e.period, e.expected_on, e.status, e.amount_uah]),
    incomes: incomes.map((i) => [i.id, i.source, i.amount, i.currency, i.window_start_day, i.window_end_day]),
    tax,
  };
}
