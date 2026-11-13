import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { applySeed, parseSeed } from "../../../scripts/seed-private";
import { PlanService } from "../src/plan/plan.service";
import { Clock } from "../src/today/clock";
import { TodayService } from "../src/today/today.service";

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

async function account(kind: string, balance: number, over: { currency?: string; creditLimit?: number } = {}): Promise<number> {
  seq++;
  return (
    await ds.query(
      `INSERT INTO accounts (external_id, kind, currency, balance, credit_limit) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`acc-${seq}`, kind, over.currency ?? "UAH", balance, over.creditLimit ?? 0],
    )
  )[0].id;
}
const setBalance = (id: number, balance: number) => ds.query(`UPDATE accounts SET balance=$2 WHERE id=$1`, [id, balance]);

async function tx(
  accountId: number,
  amount: number,
  type: string,
  over: { date?: string; needsLabel?: boolean; counter?: string | null; description?: string } = {},
): Promise<number> {
  seq++;
  const date = over.date ?? "2026-11-02";
  return (
    await ds.query(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, counter_name, amount, amount_uah, type, needs_label, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,'{}') RETURNING id`,
      [`tx-${seq}`, accountId, `${date}T10:00:00Z`, date, over.description ?? "x", over.counter ?? null, amount, type, over.needsLabel ?? false],
    )
  )[0].id;
}

/** Expected income plus its event on the given day. */
async function income(source: "fop" | "usdc", on: string, over: { status?: string; start?: number; end?: number } = {}): Promise<number> {
  const exp = (
    await ds.query(
      `INSERT INTO expected_incomes (source, amount, currency, window_start_day, window_end_day) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [source, 500_000, source === "usdc" ? "USD" : "UAH", over.start ?? 15, over.end ?? 25],
    )
  )[0].id;
  return (
    await ds.query(
      `INSERT INTO income_events (expected_income_id, period, expected_on, status) VALUES ($1,$2,$3,$4) RETURNING id`,
      [exp, on.slice(0, 7), on, over.status ?? "expected"],
    )
  )[0].id;
}
const payment = (name: string, amount: number, due: string, kind = "obligation") =>
  ds.query(`INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ($1,$2,$3,'UAH',$4)`, [kind, name, amount, due]);

/** The day's row is written by the jobs, never by a read (task Б3); `snapshot.e2e.test.ts` checks that. */
const fix = () => app.get(TodayService).ensureSnapshot();
/** What the owner sees: the 15-minute job has fixed the day, then the app read it. */
const today = async () => {
  await fix();
  return (await api.get("/today").expect(200)).body;
};

describe("auth", () => {
  it("requires a token", async () => {
    await request(http()).get("/today").expect(401);
    await request(http()).post("/bridge").send({ dailyAmount: 1 }).expect(401);
  });
});

describe("limit calendar", () => {
  const limit = (date: string, amount: number) => ds.query(`INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ($1,$2,'normal')`, [date, amount]);
  const month = async (m: string) => (await api.get(`/today/calendar?month=${m}`).expect(200)).body;

  it("rejects a bad month and requires a token", async () => {
    await api.get("/today/calendar?month=2026-13").expect(400);
    await api.get("/today/calendar").expect(400);
    await request(http()).get("/today/calendar?month=2026-11").expect(401);
  });

  it("colours each past day from its fixed limit and what counted against it, with today apart", async () => {
    const card = await account("black", 1_000_000);
    at("2026-11-05T10:00:00Z");
    await limit("2026-11-01", 100_000);
    await tx(card, -80_000, "spend", { date: "2026-11-01" });
    await limit("2026-11-02", 100_000);
    await tx(card, -90_000, "person_transfer", { date: "2026-11-02" });
    await tx(card, -30_000, "cash_out", { date: "2026-11-02" });
    await limit("2026-11-03", 100_000);
    await tx(card, -160_000, "spend", { date: "2026-11-03" });
    await tx(card, -5_000, "spend", { date: "2026-11-04" }); // no limit that day
    await tx(card, -900_000, "own_transfer", { date: "2026-11-01" }); // does not count
    await tx(card, -900_000, "loan_out", { date: "2026-11-01" });
    await limit("2026-11-05", 100_000);
    await tx(card, -999_000, "spend", { date: "2026-11-05" });
    const body = await month("2026-11");
    expect(body).toMatchObject({ month: "2026-11", today: "2026-11-05" });
    expect(body.days).toEqual([
      { date: "2026-11-01", limit: 100_000, spent: 80_000, status: "within" },
      { date: "2026-11-02", limit: 100_000, spent: 120_000, status: "over" },
      { date: "2026-11-03", limit: 100_000, spent: 160_000, status: "far_over" },
      { date: "2026-11-04", limit: null, spent: 5_000, status: "no_limit" },
      { date: "2026-11-05", limit: 100_000, spent: 999_000, status: "today" },
    ]);
  });

  it("has only the days of that month, none from the future", async () => {
    at("2026-11-02T10:00:00Z");
    expect((await month("2026-11")).days.map((d: { date: string }) => d.date)).toEqual(["2026-11-01", "2026-11-02"]);
    expect((await month("2026-12")).days).toEqual([]);
    expect((await month("2026-02")).days).toHaveLength(28);
  });

  it("gives the current streak, on the calendar and on Today", async () => {
    const card = await account("black", 1_000_000);
    at("2026-11-05T10:00:00Z");
    await limit("2026-11-01", 100_000);
    await tx(card, -200_000, "spend", { date: "2026-11-01" });
    await limit("2026-11-02", 100_000);
    await limit("2026-11-04", 100_000);
    await tx(card, -100_000, "spend", { date: "2026-11-04" });
    expect((await month("2026-11")).streak).toBe(2);
    expect((await today()).streak).toBe(2);
  });
});

describe("goals on the home screen", () => {
  it("lists goals in sort order, in USD cents", async () => {
    await ds.query(`INSERT INTO goals (name, target_cents, saved_cents, sort) VALUES ('Машина',1000000,0,2),('Подушка',500000,50000,1)`);
    const body = await today();
    expect(body.goals).toEqual([
      { id: 2, name: "Подушка", saved: 50000, target: 500000 },
      { id: 1, name: "Машина", saved: 0, target: 1000000 },
    ]);
  });
});

describe("daily limit snapshot", () => {
  it("keeps the limit for the day while leftToday falls, then recomputes and spreads an overspend", async () => {
    const card = await account("black", 1_000_000);
    await income("fop", "2026-11-12"); // 10 days
    const a = await today();
    expect(a.state).toMatchObject({ mode: "normal", daysLeft: 10, dailyLimit: 100_000, leftToday: 100_000 });
    expect(a.date).toBe("2026-11-02");

    await tx(card, -30_000, "spend");
    await setBalance(card, 970_000);
    const b = await today();
    expect(b.state.dailyLimit).toBe(100_000);
    expect(b.state.leftToday).toBe(70_000);

    await tx(card, -120_000, "spend");
    await setBalance(card, 850_000);
    expect((await today()).state.leftToday).toBe(-50_000);

    at("2026-11-03T10:00:00Z");
    const c = await today();
    expect(c.state.dailyLimit).toBe(Math.floor(850_000 / 9));
    expect(c.state.leftToday).toBe(c.state.dailyLimit);
    expect(await ds.query(`SELECT 1 FROM daily_snapshots`)).toHaveLength(2);
  });

  it("shares one limit between concurrent first writers and requests", async () => {
    await account("black", 1_000_000);
    await income("fop", "2026-11-12");
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => fix().then(() => api.get("/today"))));
    for (const r of rs) {
      expect(r.status).toBe(200);
      expect(r.body.state.dailyLimit).toBe(100_000);
    }
    expect(await ds.query(`SELECT 1 FROM daily_snapshots`)).toHaveLength(1);
  });

  it("adds back what was already spent when the first request comes late in the day", async () => {
    const card = await account("black", 970_000);
    await income("fop", "2026-11-12");
    await tx(card, -30_000, "spend");
    const r = await today();
    expect(r.state.dailyLimit).toBe(100_000);
    expect(r.state.leftToday).toBe(70_000);
  });
});

describe("the first day", () => {
  // Anonymised: shapes and arithmetic only.
  const seed = parseSeed(
    JSON.stringify({
      expected_incomes: [{ source: "fop", amount: 500_000, currency: "UAH", window_start_day: 15, window_end_day: 25 }],
      recurring: [{ name: "Rent", amount: 100_000, currency: "UAH", day_of_month: 6 }],
    }),
  );
  const NOW = new Date("2026-11-02T10:00:00Z");
  // 25 November is 23 days away; the rent on the 6th comes out first.
  const correct = Math.floor((1_000_000 - 100_000) / 23);

  it("before the seed the job freezes a 30-day limit; after seed and restart the same day has the right one", async () => {
    await account("black", 1_000_000);
    const before = await today();
    expect(before.state).toMatchObject({ daysLeft: 30, dailyLimit: Math.floor(1_000_000 / 30), needsIncomeDate: true });
    expect(before.questions).toEqual([]);

    await applySeed(ds, seed, NOW);
    expect(await ds.query(`SELECT 1 FROM daily_snapshots`)).toHaveLength(0);
    await app.get(PlanService).onApplicationBootstrap(); // the restart in checklist step 11

    const after = await today();
    expect(after.state).toMatchObject({ daysLeft: 23, dailyLimit: correct, needsIncomeDate: false });
    expect(after.questions).toEqual([]);
  });

  it("a job that freezes the limit between the seed and the generation does not keep it wrong", async () => {
    await account("black", 1_000_000);
    await today();
    await applySeed(ds, seed, NOW);
    expect((await today()).state.dailyLimit).toBe(Math.floor(1_000_000 / 30)); // the 15-minute job, nothing generated yet
    await app.get(PlanService).hourlyJob();
    expect((await today()).state).toMatchObject({ daysLeft: 23, dailyLimit: correct });
  });

  it("repeated generation does not rewrite the day's limit or add rows", async () => {
    await account("black", 1_000_000);
    await applySeed(ds, seed, NOW);
    const plan = app.get(PlanService);
    await plan.hourlyJob();
    const fixed = (await today()).state.dailyLimit;
    const count = async () => (await ds.query(`SELECT (SELECT count(*) FROM income_events)::int + (SELECT count(*) FROM scheduled_payments)::int AS n`))[0].n;
    const rows = await count();
    await ds.query(`UPDATE accounts SET balance=500000`);
    await plan.hourlyJob();
    expect(await count()).toBe(rows);
    expect((await today()).state.dailyLimit).toBe(fixed);
  });
});

describe("what counts as spending today", () => {
  it("counts spend with refunds, cash out and labelled or unlabelled person transfers only", async () => {
    const card = await account("black", 5_000_000);
    const jar = await account("jar", 100_000);
    await income("fop", "2026-11-12");
    await tx(card, -10_000, "spend");
    await tx(card, 4_000, "spend"); // refund
    await tx(card, -2_000, "cash_out");
    await tx(card, -3_000, "person_transfer", { counter: "Maria" }); // labelled by a rule
    await tx(card, -5_000, "person_transfer", { counter: "Ivan", needsLabel: true });
    // none of these count
    await tx(card, -50_000, "obligation");
    await tx(card, -60_000, "tax");
    await tx(card, -70_000, "debt_payment");
    await tx(card, -80_000, "own_transfer");
    await tx(card, -90_000, "goal_contribution");
    await tx(card, 40_000, "income");
    await tx(jar, -99_000, "spend");
    await tx(card, -7_000, "spend", { date: "2026-11-01" });
    const r = await today();
    expect(r.state.leftToday).toBe(r.state.dailyLimit - (10_000 - 4_000 + 2_000 + 3_000 + 5_000));
  });
});

describe("borrowed", () => {
  it("does not let a received loan raise free", async () => {
    const card = await account("black", 1_000_000);
    await income("fop", "2026-11-12");
    const before = await today();
    await setBalance(card, 3_000_000);
    await ds.query(`INSERT INTO loans (amount, received_on) VALUES (2000000, '2026-11-02')`);
    const after = await today();
    expect(after.state.free).toBe(before.state.free);
    expect(after.badCases).toHaveLength(1);
  });

  it("ignores loans from before the last received income", async () => {
    await account("black", 1_000_000);
    await income("fop", "2026-10-20", { status: "received" });
    await ds.query(`UPDATE income_events SET received_at='2026-10-20T09:00:00Z'`);
    await income("usdc", "2026-11-12");
    await ds.query(`INSERT INTO loans (amount, received_on) VALUES (200000, '2026-10-05')`);
    await ds.query(`INSERT INTO loans (amount, received_on) VALUES (100000, '2026-10-25')`);
    const r = await today();
    expect(r.state.free).toBe(1_000_000 - 100_000);
    expect(r.badCases).toHaveLength(1);
    expect(r.badCases[0].text).toContain("₴1,000");
  });

  it("lists only unrepaid loans as bad cases", async () => {
    await account("black", 1_000_000);
    await income("fop", "2026-11-12");
    await ds.query(`INSERT INTO loans (amount, received_on, repaid_at) VALUES (100000, '2026-11-01', now())`);
    expect((await today()).badCases).toEqual([]);
    await ds.query(`INSERT INTO loans (amount, received_on) VALUES (100000, '2026-11-01')`);
    const r = await today();
    expect(r.badCases).toHaveLength(1);
    expect(r.badCases[0].id).toMatch(/^loan:/);
  });

  it("states a loan neutrally and offers removal only for one entered by hand", async () => {
    const card = await account("black", 1_000_000);
    await income("fop", "2026-11-12");
    const bank = await tx(card, 200_000, "loan_in", { date: "2026-11-01" });
    await ds.query(`INSERT INTO loans (amount, received_on) VALUES (1000, '2026-11-01')`);
    await ds.query(`INSERT INTO loans (amount, received_on, source_transaction_id) VALUES (500000, '2026-11-02', $1)`, [bank]);
    const r = await today();
    expect(r.badCases[0]).toMatchObject({ text: "Займ ₴10 от 01.11" });
    expect(r.badCases[0].removableLoanId).toEqual(expect.any(Number));
    expect(r.badCases[1].text).toMatch(/^Займ ₴5,000 от 02\.11/);
    expect(r.badCases[1].removableLoanId).toBeUndefined();
    for (const b of r.badCases) expect(b.text).not.toMatch(/не хватало/);
  });

  it("offers repaying any open loan, and shows what is still owed after a part was repaid", async () => {
    const card = await account("black", 1_000_000);
    await income("fop", "2026-11-12");
    const bank = await tx(card, 200_000, "loan_in", { date: "2026-11-01" });
    await ds.query(`INSERT INTO loans (amount, received_on, source_transaction_id, repaid_amount) VALUES (500000, '2026-11-01', $1, 200000)`, [bank]);
    const id = (await ds.query(`SELECT id FROM loans`))[0].id as number;
    const r = await today();
    expect(r.badCases[0].repayLoan).toEqual({ id, remaining: 300_000, receivedOn: "2026-11-01" });
    expect(r.badCases[0].text).toMatch(/^Займ ₴5,000 от 01\.11, осталось ₴3,000/);
  });
});

describe("loan tracking", () => {
  it("an imported loan from before tracking neither alerts nor changes free; a new one does both", async () => {
    await account("black", 1_000_000);
    await income("fop", "2026-11-12");
    await ds.query(`UPDATE settings SET tracking_start='2026-11-01'`);
    const before = await today();
    await ds.query(`INSERT INTO loans (amount, received_on) VALUES (500000, '2025-12-10')`);
    const old = await today();
    expect(old.badCases).toEqual([]);
    expect(old.state.free).toBe(before.state.free);
    await ds.query(`INSERT INTO loans (amount, received_on) VALUES (100000, '2026-11-02')`);
    const fresh = await today();
    expect(fresh.badCases).toHaveLength(1);
    expect(fresh.state.free).toBe(before.state.free - 100_000);
  });

  it("a repayment of a short loan (2010 against 2000) leaves nothing borrowed", async () => {
    const card = await account("black", 1_000_000);
    await income("fop", "2026-11-12");
    const base = await today();
    const plan = app.get(PlanService);
    const loan = await tx(card, 200_000, "loan_in", { description: "Кредит До завтра на 7 днів" });
    await plan.onClassified(loan);
    expect((await ds.query(`SELECT kind FROM loans`))[0].kind).toBe("short");
    const mid = await today();
    expect(mid.state.free).toBe(base.state.free - 200_000);
    const rep = await tx(card, -201_000, "debt_payment", { description: "Погашення Кредит До завтра на 7 днів" });
    await plan.onClassified(rep);
    await plan.onClassified(rep);
    const loans = await ds.query(`SELECT repaid_amount::int AS r, repaid_at IS NOT NULL AS done FROM loans`);
    expect(loans).toEqual([{ r: 200_000, done: true }]);
    const after = await today();
    expect(after.badCases).toEqual([]);
    expect(after.state.free).toBe(base.state.free);
  });

  it("a partial repayment keeps the rest borrowed and covers the oldest loan first", async () => {
    const card = await account("black", 1_000_000);
    await income("fop", "2026-11-12");
    const base = await today();
    const plan = app.get(PlanService);
    await plan.onClassified(await tx(card, 200_000, "loan_in", { description: "Кредит До завтра", date: "2026-11-01" }));
    await plan.onClassified(await tx(card, 100_000, "loan_in", { description: "Moneyveo", date: "2026-11-02" }));
    await plan.onClassified(await tx(card, -250_000, "debt_payment", { description: "Погашення Кредит До завтра", date: "2026-11-02" }));
    expect(await ds.query(`SELECT repaid_amount::int AS r, repaid_at IS NOT NULL AS done FROM loans ORDER BY id`)).toEqual([
      { r: 200_000, done: true }, { r: 50_000, done: false },
    ]);
    expect((await today()).state.free).toBe(base.state.free - 50_000);
  });
});

describe("tax reserve and own money", () => {
  it("subtracts a quarterly estimate, unpaid scheduled tax and takes off unlinked tax payments", async () => {
    await account("black", 1_000_000);
    const fop = await account("fop", 500_000);
    await income("usdc", "2026-11-12");
    await tx(fop, 1_000_000, "income", { date: "2026-10-20" });
    await tx(fop, 900_000, "income", { date: "2026-06-20" }); // earlier quarter
    await payment("War levy", 223_932, "2026-11-20", "tax");
    const base = await today();
    // 6% of 1,000,000 = 60,000
    expect(base.state.free).toBe(1_000_000 + 500_000 - 60_000 - 223_932);
    await tx(fop, -20_000, "tax", { date: "2026-10-25" });
    const paid = await today();
    expect(paid.state.free).toBe(1_000_000 + 500_000 - (60_000 - 20_000) - 223_932);
  });

  describe("a prior quarter's tax paid this quarter", () => {
    const Q3_TAX = 500_000;
    const paidRow = () =>
      ds.query(
        `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, paid_at, tax_quarter)
         VALUES ('tax','Q3 tax',$1,'UAH','2026-11-20','2026-11-20','2026-Q3') RETURNING id`,
        [Q3_TAX],
      );
    const plan = () => app.get(PlanService);

    it("does not reduce this quarter's reserve once its row claims it (bank row first, then the seeded row)", async () => {
      await account("black", 1_000_000);
      const fop = await account("fop", 500_000);
      await income("usdc", "2026-11-12");
      await tx(fop, 1_000_000, "income", { date: "2026-10-05" });
      const t = await tx(fop, -Q3_TAX, "tax", { date: "2026-10-19" });
      expect((await today()).state.free).toBe(1_500_000); // the accrual of 60,000 wiped out by last quarter's payment
      await plan().onClassified(t, "tax");
      const [row] = await paidRow();
      await plan().linkTaxTransactions();
      expect((await ds.query(`SELECT transaction_id FROM scheduled_payments WHERE id=$1`, [row.id]))[0].transaction_id).toBe(t);
      expect((await today()).state.free).toBe(1_500_000 - 60_000);
    });

    it("links at once when the row is already there, keeping its paid date", async () => {
      await account("black", 1_000_000);
      const fop = await account("fop", 500_000);
      await income("usdc", "2026-11-12");
      await tx(fop, 1_000_000, "income", { date: "2026-10-05" });
      const [row] = await paidRow();
      const t = await tx(fop, -Q3_TAX, "tax", { date: "2026-10-19" });
      await plan().onClassified(t, "tax");
      const linked = (await ds.query(`SELECT transaction_id, paid_at::date::text AS d FROM scheduled_payments WHERE id=$1`, [row.id]))[0];
      expect(linked).toEqual({ transaction_id: t, d: "2026-11-20" });
      expect((await today()).state.free).toBe(1_500_000 - 60_000);
    });

    it("still counts a truly unmatched tax payment against this quarter", async () => {
      await account("black", 1_000_000);
      const fop = await account("fop", 500_000);
      await income("usdc", "2026-11-12");
      await tx(fop, 1_000_000, "income", { date: "2026-10-05" });
      await paidRow();
      const t = await tx(fop, -20_000, "tax", { date: "2026-10-19" });
      await plan().onClassified(t, "tax");
      expect((await today()).state.free).toBe(1_500_000 - (60_000 - 20_000));
    });
  });

  describe("quarter rollover", () => {
    const ESV = 570_702;
    const plan = () => app.get(PlanService);
    const setup = async (esv = 0) => {
      await ds.query(`UPDATE settings SET esv_quarter=$1`, [esv]);
      await account("black", 5_000_000);
      const fop = await account("fop", 0);
      await income("usdc", "2027-01-25");
      await tx(fop, 1_000_000, "income", { date: "2026-11-05" }); // 6% = 60,000
    };
    const taxRows = () =>
      ds.query(
        `SELECT name, amount::int AS amount, due_on::text AS due_on, tax_quarter, is_estimate, paid_at FROM scheduled_payments WHERE kind='tax' ORDER BY id`,
      );

    it("keeps the reserve from 31 December to 1 January", async () => {
      await setup();
      at("2026-12-31T10:00:00Z");
      const dec = await today();
      expect(dec.state.free).toBe(5_000_000 - 60_000);
      at("2027-01-01T10:00:00Z");
      expect(await plan().ensureTaxEstimate()).toBe(true);
      expect((await today()).state.free).toBe(dec.state.free);
      expect(await taxRows()).toEqual([
        { name: "Налог за 4 кв. 2026 (оценка)", amount: 60_000, due_on: "2027-02-20", tax_quarter: "2026-Q4", is_estimate: true, paid_at: null },
      ]);
    });

    it("moves the reserve by one day of ESV at most, and is idempotent", async () => {
      await setup(ESV);
      at("2026-12-31T10:00:00Z");
      const dec = await today();
      expect(dec.state.free).toBe(5_000_000 - 60_000 - ESV);
      at("2027-01-01T00:01:00Z");
      await plan().ensureTaxEstimate();
      expect(await plan().ensureTaxEstimate()).toBe(false);
      expect(await taxRows()).toHaveLength(1);
      expect(dec.state.free - (await today()).state.free).toBe(Math.round(ESV / 90));
    });

    it("recomputes a limit fixed just after midnight, before the estimate existed", async () => {
      await setup();
      at("2027-01-01T00:00:00Z"); // 02:00 in Kyiv: the 15-minute job has already fixed the day
      const early = await today();
      expect(early.state.free).toBe(5_000_000);
      await plan().ensureTaxEstimate();
      const after = await today();
      expect(after.state.free).toBe(5_000_000 - 60_000);
      expect(after.state.dailyLimit).toBeLessThan(early.state.dailyLimit);
    });

    it("takes off unmatched payments of the ended quarter, and writes nothing when nothing accrued", async () => {
      await setup();
      const fop = (await ds.query(`SELECT id FROM accounts WHERE kind='fop'`))[0].id;
      await tx(fop, -20_000, "tax", { date: "2026-12-01" });
      at("2027-01-01T10:00:00Z");
      await plan().ensureTaxEstimate();
      expect((await taxRows())[0].amount).toBe(40_000);

      await ds.query(`DELETE FROM scheduled_payments`);
      await ds.query(`DELETE FROM transactions`);
      expect(await plan().ensureTaxEstimate()).toBe(false);
      expect(await taxRows()).toHaveLength(0);
    });

    it("does not count rows entered on 20 December on top of the accrual", async () => {
      await setup();
      at("2026-12-20T10:00:00Z");
      expect((await today()).state.free).toBe(5_000_000 - 60_000);
      await api.post("/plan/payments", { kind: "tax", name: "Q4 tax", amount: 75_000, currency: "UAH", due_on: "2027-02-20" }).expect(201);
      expect((await today()).state.free).toBe(5_000_000 - 75_000);
      expect((await taxRows())[0].tax_quarter).toBe("2026-Q4");
      at("2027-01-01T10:00:00Z");
      expect(await plan().ensureTaxEstimate()).toBe(false); // the real row stands
      expect((await today()).state.free).toBe(5_000_000 - 75_000);
    });

    it("a real row for an ended quarter replaces its estimate, with no gap", async () => {
      await setup();
      at("2027-01-05T10:00:00Z");
      await plan().ensureTaxEstimate();
      const id = (await ds.query(`SELECT id FROM scheduled_payments WHERE is_estimate`))[0].id;
      expect((await today()).state.free).toBe(5_000_000 - 60_000);
      await api.post("/plan/payments", { kind: "tax", name: "Levy", amount: 11_000, currency: "UAH", due_on: "2027-02-20" }).expect(201);
      await api.post("/plan/payments", { kind: "tax", name: "Tax", amount: 52_000, currency: "UAH", due_on: "2027-02-20" }).expect(201);
      expect(await ds.query(`SELECT 1 FROM scheduled_payments WHERE id=$1`, [id])).toHaveLength(0);
      expect((await today()).state.free).toBe(5_000_000 - 63_000);
      expect(await plan().ensureTaxEstimate()).toBe(false);
    });

    it("keeps a bridge plan's credit needed across the rollover", async () => {
      await setup();
      await ds.query(`UPDATE accounts SET balance=10000 WHERE kind='black'`);
      at("2026-12-31T10:00:00Z");
      const before = (await api.post("/bridge/preview", { dailyAmount: 45_000 }).expect(201)).body.creditNeeded as number;
      at("2027-01-01T10:00:00Z");
      await plan().ensureTaxEstimate();
      const after = (await api.post("/bridge/preview", { dailyAmount: 45_000 }).expect(201)).body.creditNeeded as number;
      expect(before - after).toBe(45_000); // one day fewer to the income, nothing else
    });
  });

  it("shows cards, fop, credit and binance converted at the USD rate, and flags a stale rate", async () => {
    await account("black", 4_000_000, { creditLimit: 3_000_000 });
    await account("white", 200_000);
    await account("fop", 300_000);
    await account("jar", 9_999_999);
    await ds.query(`INSERT INTO manual_balances (name, amount, currency) VALUES ('Binance', 10000, 'USD')`);
    await ds.query(`INSERT INTO manual_balances (name, amount, currency) VALUES ('Cash box', 50000, 'UAH')`);
    await ds.query(`INSERT INTO manual_balances (name, amount, currency, counts_as_own) VALUES ('Not mine', 77777, 'UAH', false)`);
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-02T08:00:00Z', 41.5)`);
    const r = await today();
    expect(r.usdRate).toBe(41.5);
    expect(r.rateStale).toBe(false);
    expect(r.accounts).toEqual({ own: 1_000_000 + 200_000 + 300_000 + 415_000 + 50_000, credit: 3_000_000, fop: 300_000, binance: 465_000, cash: 0 });

    await ds.query(`UPDATE fx_rates SET fetched_at='2026-10-20T08:00:00Z'`);
    expect((await today()).rateStale).toBe(true);
  });
});

describe("bridge mode", () => {
  async function setup() {
    const card = await account("black", 4_032_500, { creditLimit: 3_000_000 });
    await income("fop", "2026-11-20");
    await payment("Rent", 1_700_000, "2026-11-06");
    await payment("Store installment", 529_500, "2026-11-18", "installment");
    return card;
  }
  const plans = () => ds.query(`SELECT daily_amount::int AS daily_amount, credit_plan::int AS credit_plan, closed_on FROM bridge_plans ORDER BY id`);

  it("recommends a plan from the food floor", async () => {
    await setup();
    const r = await today();
    expect(r.state).toMatchObject({ mode: "bridge", daysLeft: 18, free: -1_197_000, dailyLimit: 45_000 });
    expect(r.state.bridge).toMatchObject({ creditNeeded: 2_007_000, shortfall: 0, recommendedDaily: 45_000 });
    expect(r.state.bridge.confirmed).toBe(false);
    expect(await plans()).toHaveLength(0);
  });

  it("reports the plan as confirmed once one is saved", async () => {
    await setup();
    const saved = await api.post("/bridge", { dailyAmount: 100_000 }).expect(201);
    expect(saved.body.state.bridge.confirmed).toBe(true);
    expect((await today()).state.bridge.confirmed).toBe(true);
  });

  it("cancelling closes the plan and returns to the recommendation; a new plan can follow", async () => {
    await setup();
    await api.post("/bridge", { dailyAmount: 100_000 }).expect(201);
    const cancelled = await api.delete("/bridge").expect(200);
    expect(cancelled.body.state.bridge.confirmed).toBe(false);
    expect(cancelled.body.state.dailyLimit).toBe(45_000);
    expect((await plans())[0].closed_on).not.toBeNull();

    const again = await api.post("/bridge", { dailyAmount: 60_000 }).expect(201);
    expect(again.body.state.bridge.confirmed).toBe(true);
    expect(await plans()).toHaveLength(2);
  });

  it("cancelling with no open plan changes nothing, the day's limit stays fixed", async () => {
    const card = await setup();
    const before = await today();
    await setBalance(card, 4_532_500);
    const r = await api.delete("/bridge").expect(200);
    expect(r.body.state.dailyLimit).toBe(before.state.dailyLimit);
    expect(await plans()).toHaveLength(0);
  });

  it("saves the choice, keeps credit_plan on ordinary spending, and recomputes it on new payments or a new income date", async () => {
    const card = await setup();
    const saved = await api.post("/bridge", { dailyAmount: 100_000 }).expect(201);
    expect(saved.body.state.dailyLimit).toBe(100_000);
    expect(await plans()).toEqual([{ daily_amount: 100_000, credit_plan: 2_997_000, closed_on: null }]);

    await tx(card, -30_000, "spend");
    await setBalance(card, 4_002_500);
    const r = await today();
    expect(r.state.dailyLimit).toBe(100_000);
    expect(r.state.leftToday).toBe(70_000);
    expect((await plans())[0].credit_plan).toBe(2_997_000);

    await payment("Phone", 100_000, "2026-11-10");
    await today();
    // free = 1,002,500 - 1,700,000 - 529,500 - 100,000 = -1,327,000; plus 18 * 100,000
    expect((await plans())[0].credit_plan).toBe(1_327_000 + 1_800_000);

    await ds.query(`UPDATE income_events SET expected_on='2026-11-24'`);
    await today();
    // 22 days left
    expect((await plans())[0].credit_plan).toBe(1_327_000 + 2_200_000);
  });

  it("flags going past the plan as a bad case", async () => {
    const card = await setup();
    await api.post("/bridge", { dailyAmount: 100_000 }).expect(201);
    await tx(card, -10_000, "spend", { date: "2026-11-01" });
    await setBalance(card, 3_000_000 - 2_997_000 - 5_000);
    const r = await today();
    expect(r.state.bridge.overPlan).toBe(true);
    const bad = r.badCases.find((b: { id: string }) => b.id.startsWith("bridge_over_plan:"));
    // the id carries the plan id, so a later plan that goes over alerts again
    expect(bad.id).toBe(`bridge_over_plan:${(await ds.query(`SELECT id FROM bridge_plans`))[0].id}`);
    expect(bad.text).toContain("Минус вышел за план моста на ₴");
    expect(bad.text).toMatch(/закончатся|уже нет/);
  });

  it("closes the plan once free is no longer negative", async () => {
    const card = await setup();
    await api.post("/bridge", { dailyAmount: 100_000 }).expect(201);
    await setBalance(card, 10_000_000);
    const r = await today();
    expect(r.state.mode).toBe("normal");
    expect((await plans())[0].closed_on).not.toBeNull();
    expect(r.state.dailyLimit).toBeGreaterThan(100_000);
  });

  it("confirms a plan the credit limit does not cover: the day's limit is the chosen amount (А22)", async () => {
    await setup();
    // 18 * 200,000 + 1,197,000 = 4,797,000 needed, 3,000,000 of credit: 1,797,000 short
    const saved = await api.post("/bridge", { dailyAmount: 200_000 }).expect(201);
    expect(saved.body.state).toMatchObject({ dailyLimit: 200_000, leftToday: 200_000 });
    expect(saved.body.state.bridge).toMatchObject({ confirmed: true, shortfall: 1_797_000 });
    expect(await plans()).toEqual([{ daily_amount: 200_000, credit_plan: 4_797_000, closed_on: null }]);
    expect((await today()).state.dailyLimit).toBe(200_000);
  });

  it("confirms a plan when the account has no credit limit at all (А22)", async () => {
    await setup();
    await ds.query(`UPDATE accounts SET credit_limit=0, balance=1032500`); // the same own money, no credit
    const saved = await api.post("/bridge", { dailyAmount: 10_000 }).expect(201);
    expect(saved.body.state.dailyLimit).toBe(10_000);
    expect(saved.body.state.bridge).toMatchObject({ confirmed: true, shortfall: 1_197_000 + 18 * 10_000 });
    expect((await today()).state.dailyLimit).toBe(10_000);
  });

  it("refuses a malformed plan or a plan outside bridge mode", async () => {
    await setup();
    await api.post("/bridge", { dailyAmount: 0 }).expect(400);
    await api.post("/bridge", { dailyAmount: 1.5 }).expect(400);
    expect(await plans()).toHaveLength(0);
    await ds.query(`UPDATE accounts SET balance=50000000`);
    await api.post("/bridge", { dailyAmount: 100_000 }).expect(409);
  });

  it("keeps the owner's choice when today's own spending caused bridge mode", async () => {
    const card = await account("black", 4_000_000, { creditLimit: 3_000_000 });
    await income("fop", "2026-11-12");
    expect((await today()).state).toMatchObject({ mode: "normal", dailyLimit: 100_000 });
    await tx(card, -1_100_000, "spend");
    await setBalance(card, 2_900_000);
    const crossed = await today();
    expect(crossed.state.mode).toBe("bridge");
    expect(crossed.state.dailyLimit).toBe(100_000); // fixed for the day until a plan is chosen
    const chosen = await api.post("/bridge", { dailyAmount: 45_000 }).expect(201);
    expect(chosen.body.state.dailyLimit).toBe(45_000);
    expect((await today()).state.dailyLimit).toBe(45_000);
  });

  describe("the day the shortage came on", () => {
    const calendar = async () => (await api.get("/today/calendar?month=2026-11").expect(200)).body;
    const month = async () => (await calendar()).days;
    const fixed = (date: string, amount: number, mode: string) =>
      ds.query(`INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ($1,$2,$3)`, [date, amount, mode]);
    /** An ordinary 1 November, then 2 November begins ordinary too: ₴1,000 for the day. */
    async function ordinaryMorning() {
      const card = await account("black", 4_000_000, { creditLimit: 3_000_000 });
      await income("fop", "2026-11-12");
      at("2026-11-01T10:00:00Z");
      expect((await today()).state.shortageStart).toBeUndefined();
      at("2026-11-02T10:00:00Z");
      const morning = await today();
      expect(morning.state).toMatchObject({ mode: "normal", dailyLimit: 100_000 });
      expect(morning.state.shortageStart).toBeUndefined();
      return card;
    }

    it("while the day keeps its morning limit, names the limit that applies from tomorrow", async () => {
      const card = await ordinaryMorning();
      await tx(card, -1_100_000, "spend");
      await setBalance(card, 2_900_000);
      // The numbers are the same as before: only the mark is new.
      const crossed = await today();
      expect(crossed.state).toMatchObject({ mode: "bridge", dailyLimit: 100_000, leftToday: -1_000_000 });
      expect(crossed.state.shortageStart).toEqual({ nextLimit: 45_000 });
      // Today's cell keeps its limit: nothing judges today, and an older app shows it as before.
      expect((await month()).at(-1)).toEqual({ date: "2026-11-02", limit: 100_000, spent: 1_100_000, status: "today", shortageStart: true });
    });

    it("once a plan is confirmed the day's limit already is the new one: marked, with no limit for tomorrow to announce", async () => {
      const card = await ordinaryMorning();
      await tx(card, -1_100_000, "spend");
      await setBalance(card, 2_900_000);
      await today();
      const chosen = (await api.post("/bridge", { dailyAmount: 60_000 }).expect(201)).body;
      expect(chosen.state).toMatchObject({ dailyLimit: 60_000, leftToday: 60_000 - 1_100_000 });
      expect(chosen.state.shortageStart).toEqual({});
      expect((await today()).state.shortageStart).toEqual({});
    });

    it("the same when the day's limit was fixed again mid-day as the shortage one", async () => {
      const card = await ordinaryMorning();
      await tx(card, -30_000, "spend");
      await setBalance(card, 3_970_000);
      await payment("Rent", 1_700_000, "2026-11-06");
      await ds.query(`DELETE FROM daily_snapshots WHERE local_date='2026-11-02'`); // what adding a payment in the app does
      const r = await today();
      expect(r.state).toMatchObject({ mode: "bridge", dailyLimit: 45_000, leftToday: 15_000 });
      expect(r.state.shortageStart).toEqual({});
      // Fixed once more the same day, it is still that day.
      await ds.query(`DELETE FROM daily_snapshots WHERE local_date='2026-11-02'`);
      expect((await today()).state.shortageStart).toEqual({});
    });

    it("the next day is an ordinary shortage day; the calendar and the streak both leave the marked day unjudged", async () => {
      const card = await ordinaryMorning();
      await tx(card, -1_100_000, "spend");
      await setBalance(card, 2_900_000);
      await api.post("/bridge", { dailyAmount: 60_000 }).expect(201);

      at("2026-11-03T10:00:00Z");
      const next = await today();
      expect(next.state).toMatchObject({ mode: "bridge", dailyLimit: 60_000 });
      expect(next.state.shortageStart).toBeUndefined();
      await tx(card, -10_000, "spend", { date: "2026-11-03" });

      at("2026-11-04T10:00:00Z");
      const later = await today();
      const body = await calendar();
      expect(body.days[0]).toMatchObject({ date: "2026-11-01", status: "within" });
      // Grey for the app: no limit to judge the day by, though far more was spent than the new limit.
      expect(body.days[1]).toEqual({ date: "2026-11-02", limit: null, spent: 1_100_000, status: "no_limit", shortageStart: true });
      expect(body.days[2]).toEqual({ date: "2026-11-03", limit: 60_000, spent: 10_000, status: "within" });
      // 1 and 3 November count; the 2nd neither breaks the row nor adds to it.
      expect(body.streak).toBe(2);
      expect(later.streak).toBe(2);

      await tx(card, -70_000, "spend", { date: "2026-11-04" });
      at("2026-11-05T10:00:00Z");
      await today();
      const after = await calendar();
      expect(after.days[3]).toEqual({ date: "2026-11-04", limit: 60_000, spent: 70_000, status: "over" });
      expect(after.streak).toBe(0);
    });

    it("is not marked when the shortage ended the same day", async () => {
      const card = await ordinaryMorning();
      await tx(card, -1_100_000, "spend");
      await setBalance(card, 2_900_000);
      expect((await today()).state.shortageStart).toBeDefined();
      await setBalance(card, 4_500_000);
      expect((await today()).state.shortageStart).toBeUndefined();
      at("2026-11-03T10:00:00Z");
      await today();
      expect((await month())[1]).toEqual({ date: "2026-11-02", limit: 100_000, spent: 1_100_000, status: "far_over" });
    });

    it("a day that began in shortage is not marked when the money rises above zero and falls back", async () => {
      const card = await account("black", 2_900_000, { creditLimit: 3_000_000 });
      await income("fop", "2026-11-12");
      await fixed("2026-11-01", 45_000, "bridge");
      expect((await today()).state).toMatchObject({ mode: "bridge", dailyLimit: 45_000 });
      await tx(card, -60_000, "spend");
      await setBalance(card, 2_840_000);
      const over = await today();
      expect(over.state.leftToday).toBe(-15_000);
      expect(over.state.shortageStart).toBeUndefined();

      await setBalance(card, 4_500_000);
      const up = await today();
      expect(up.state).toMatchObject({ mode: "normal", dailyLimit: 45_000, leftToday: -15_000 });
      expect(up.state.shortageStart).toBeUndefined();
      await setBalance(card, 2_840_000);
      const back = await today();
      expect(back.state).toMatchObject({ mode: "bridge", dailyLimit: 45_000, leftToday: -15_000 });
      expect(back.state.shortageStart).toBeUndefined();

      at("2026-11-03T10:00:00Z");
      const next = await today();
      const body = await calendar();
      expect(body.days[1]).toEqual({ date: "2026-11-02", limit: 45_000, spent: 60_000, status: "over" });
      expect(body.streak).toBe(0);
      expect(next.streak).toBe(0);
    });

    // Pins a known limit, not a wanted behaviour: this is a real transition day and it stays red.
    // Yesterday was a shortage day, today began ordinary, and the day's row was deleted at the moment
    // of crossing (an action in the plan). Nothing stored tells it from a day that began in shortage;
    // telling them apart needs a stored fact, that is a migration.
    it("known limit: after a shortage day, a day re-fixed at the crossing is not marked", async () => {
      const card = await account("black", 4_000_000, { creditLimit: 3_000_000 });
      await income("fop", "2026-11-12");
      await fixed("2026-11-01", 45_000, "bridge");
      expect((await today()).state).toMatchObject({ mode: "normal", dailyLimit: 100_000 });
      await tx(card, -60_000, "spend");
      await setBalance(card, 3_940_000);
      await payment("Rent", 1_700_000, "2026-11-06");
      await ds.query(`DELETE FROM daily_snapshots WHERE local_date='2026-11-02'`); // what adding a payment in the app does
      const r = await today();
      expect(r.state).toMatchObject({ mode: "bridge", dailyLimit: 45_000, leftToday: -15_000 });
      expect(r.state.shortageStart).toBeUndefined();

      at("2026-11-03T10:00:00Z");
      await today();
      const body = await calendar();
      expect(body.days[1]).toEqual({ date: "2026-11-02", limit: 45_000, spent: 60_000, status: "over" });
      expect(body.streak).toBe(0);
    });

    it("is not marked on the very first day: there was no limit before it", async () => {
      await setup();
      const r = await today();
      expect(r.state.mode).toBe("bridge");
      expect(r.state.shortageStart).toBeUndefined();
      expect((await month()).at(-1)).toEqual({ date: "2026-11-02", limit: 45_000, spent: 0, status: "today" });
    });

    it("days fixed by the server before this rule stay as they were, in the calendar and in the streak", async () => {
      // As the old server wrote them: the mode a day began in. The shortage came on on the 2nd, the 3rd began in it.
      const card = await account("black", 2_900_000, { creditLimit: 3_000_000 });
      await income("fop", "2026-11-12");
      await fixed("2026-11-01", 100_000, "normal");
      await fixed("2026-11-02", 100_000, "normal");
      await tx(card, -1_100_000, "spend", { date: "2026-11-02" });
      await fixed("2026-11-03", 45_000, "bridge");
      await tx(card, -40_000, "spend", { date: "2026-11-03" });
      at("2026-11-04T10:00:00Z");
      const r = await today();
      expect(r.state.mode).toBe("bridge");
      expect(r.state.shortageStart).toBeUndefined();
      const body = await calendar();
      expect(body.days).toEqual([
        { date: "2026-11-01", limit: 100_000, spent: 0, status: "within" },
        { date: "2026-11-02", limit: 100_000, spent: 1_100_000, status: "far_over" },
        { date: "2026-11-03", limit: 45_000, spent: 40_000, status: "within" },
        { date: "2026-11-04", limit: 45_000, spent: 0, status: "today" },
      ]);
      expect(body.streak).toBe(1);
      expect(r.streak).toBe(1);
    });

    it("a crossing the server did not see before midnight puts the mark on the new day, whose limit is the new one from its start", async () => {
      const card = await ordinaryMorning();
      await tx(card, -1_100_000, "spend"); // late in the evening: no request follows that day
      await setBalance(card, 2_900_000);
      at("2026-11-02T22:05:00Z"); // 00:05 in Kyiv on the 3rd
      const r = await today();
      expect(r.date).toBe("2026-11-03");
      expect(r.state).toMatchObject({ mode: "bridge", dailyLimit: 45_000, leftToday: 45_000 });
      expect(r.state.shortageStart).toEqual({});
      expect((await month())[1]).toEqual({ date: "2026-11-02", limit: 100_000, spent: 1_100_000, status: "far_over" });
    });
  });

  it("does not rewrite the day's limit when a payment appears mid-day, but does when the income date is set", async () => {
    await account("black", 1_000_000);
    const eventId = await income("fop", "2026-11-12");
    expect((await today()).state.dailyLimit).toBe(100_000);
    await payment("Phone", 200_000, "2026-11-05");
    const after = await today();
    expect(after.state.dailyLimit).toBe(100_000);
    expect(after.state.free).toBe(800_000);
    await api.post(`/plan/incomes/${eventId}/date`, { date: "2026-11-07" }).expect(201);
    const moved = await today();
    expect(moved.state.daysLeft).toBe(5);
    expect(moved.state.dailyLimit).toBe(160_000);
  });

  it("leaves credit_plan alone on a rate change or on paying a payment, but not on a new payment", async () => {
    await setup();
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-02T08:00:00Z', 40)`);
    await ds.query(`INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation','Abroad',1000,'USD','2026-11-10')`);
    await api.post("/bridge", { dailyAmount: 45_000 }).expect(201);
    const plan0 = (await plans())[0].credit_plan;
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-02T09:00:00Z', 41)`);
    await today();
    expect((await plans())[0].credit_plan).toBe(plan0);
    const paidId = (await ds.query(`SELECT id FROM scheduled_payments WHERE name='Abroad'`))[0].id;
    await api.post(`/plan/payments/${paidId}/mark-paid`).expect(201);
    await today();
    expect((await plans())[0].credit_plan).toBe(plan0);
    await payment("Phone", 100_000, "2026-11-10");
    await today();
    expect((await plans())[0].credit_plan).not.toBe(plan0);
  });

  it("falls back to 45,000 a day when no food floor is set", async () => {
    await setup();
    await ds.query(`UPDATE settings SET food_floor=0`);
    const r = await today();
    expect(r.state.bridge.recommendedDaily).toBe(45_000);
    expect(r.state.dailyLimit).toBe(45_000);
  });

  it("leaves accrued quarter tax out of the credit needed (design example)", async () => {
    await setup();
    await ds.query(`UPDATE settings SET esv_quarter=570702`);
    await payment("Q3 levy and ESV", 794_634, "2026-11-20", "tax");
    const p = await api.post("/bridge/preview", { dailyAmount: 45_000 }).expect(201);
    expect(p.body).toEqual({ dailyAmount: 45_000, creditNeeded: 2_801_634, shortfall: 0 });
  });

  it("previews without saving anything", async () => {
    await setup();
    const ok = await api.post("/bridge/preview", { dailyAmount: 100_000 }).expect(201);
    expect(ok.body).toEqual({ dailyAmount: 100_000, creditNeeded: 2_997_000, shortfall: 0 });
    const over = await api.post("/bridge/preview", { dailyAmount: 200_000 }).expect(201);
    expect(over.body).toEqual({ dailyAmount: 200_000, creditNeeded: 4_797_000, shortfall: 1_797_000 });
    expect(await plans()).toHaveLength(0);
    expect(await ds.query(`SELECT 1 FROM daily_snapshots`)).toHaveLength(0);
  });
});

describe("sync status", () => {
  it("marks stale after six hours but still calculates", async () => {
    await account("black", 1_000_000);
    await income("fop", "2026-11-12");
    await ds.query(`UPDATE settings SET last_sync_at='2026-11-02T03:00:00Z'`);
    const old = await today();
    expect(old.syncStale).toBe(true);
    expect(old.syncedAt).toBe("2026-11-02T03:00:00.000Z");
    expect(old.state.dailyLimit).toBe(100_000);
    await ds.query(`UPDATE settings SET last_sync_at='2026-11-02T08:00:00Z'`);
    expect((await today()).syncStale).toBe(false);
  });

  it("is not stale on a quiet day when the bank still answers the balance refresh", async () => {
    await account("black", 1_000_000);
    await income("fop", "2026-11-12");
    await ds.query(`UPDATE settings SET last_sync_at='2026-11-01T20:00:00Z', last_contact_at='2026-11-02T09:30:00Z'`);
    const r = await today();
    expect(r.syncStale).toBe(false);
    expect(r.syncedAt).toBe("2026-11-02T09:30:00.000Z");
    await ds.query(`UPDATE settings SET last_contact_at='2026-11-02T03:00:00Z'`);
    expect((await today()).syncStale).toBe(true);
  });
});

describe("questions, upcoming and run-out", () => {
  it("asks about USDC inside its window, once the date is unknown, and about up to three recipients", async () => {
    const card = await account("black", 5_000_000);
    at("2026-11-16T10:00:00Z");
    await income("usdc", "2026-11-25");
    for (const [n, name] of ["A", "B", "C", "D"].entries()) {
      await tx(card, -1_000, "person_transfer", { counter: name, needsLabel: true, date: "2026-11-1" + String(n + 1) });
    }
    await tx(card, -1_000, "person_transfer", { counter: "A", needsLabel: true, date: "2026-11-16" });
    const r = await today();
    const kinds = r.questions.map((q: { kind: string }) => q.kind);
    expect(kinds.filter((k: string) => k === "usdc_arrived")).toHaveLength(1);
    // The card offers «Да, $5,000»: the question carries the expected amount in cents (Б18).
    expect(r.questions.find((q: { kind: string }) => q.kind === "usdc_arrived")).toMatchObject({ text: "Пришло на Binance?", expectedAmount: 500_000 });
    expect(kinds.filter((k: string) => k === "recipient_label")).toHaveLength(3);
    expect(kinds).not.toContain("income_date");

    at("2026-11-02T10:00:00Z");
    expect((await today()).questions.map((q: { kind: string }) => q.kind)).not.toContain("usdc_arrived");
    await ds.query(`DELETE FROM income_events`);
    // needsIncomeDate stays, but with no expected income there is nothing to answer.
    const none = await today();
    expect(none.state.needsIncomeDate).toBe(true);
    expect(none.questions.map((q: { kind: string }) => q.kind)).not.toContain("income_date");
  });

  it("asks only about real names from the last 30 days, with count and total", async () => {
    const card = await account("black", 5_000_000);
    at("2026-11-16T10:00:00Z");
    await tx(card, -100_000, "person_transfer", { counter: "Таечка", needsLabel: true, date: "2026-11-10" });
    await tx(card, -150_000, "person_transfer", { counter: "Таечка", needsLabel: true, date: "2026-11-12" });
    await tx(card, -150_000, "person_transfer", { counter: "Таечка", needsLabel: true, date: "2026-10-01" }); // older than 30 days
    await tx(card, -5_000, "person_transfer", { counter: "Переказ на картку", needsLabel: true, date: "2026-11-14" });
    await tx(card, -5_000, "person_transfer", { counter: "545708****4563", needsLabel: true, date: "2026-11-15" });
    await tx(card, -5_000, "person_transfer", { counter: "Старий Знайомий", needsLabel: true, date: "2026-10-01" });
    const people = (await today()).questions.filter((q: { kind: string }) => q.kind === "recipient_label");
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ subject: "Таечка", text: "Таечка: 2 перевода, ₴2,500, последний 12.11" });
  });

  it("money lent does not use up the day's limit", async () => {
    const card = await account("black", 5_000_000);
    at("2026-11-16T10:00:00Z");
    await tx(card, -100_000, "loan_out", { date: "2026-11-16" });
    const { state } = await today();
    expect(state.leftToday).toBe(state.dailyLimit);
  });

  it("a later generic row does not hide a person known by the same IBAN", async () => {
    const card = await account("black", 5_000_000);
    at("2026-11-16T10:00:00Z");
    await tx(card, -1_000, "person_transfer", { counter: "Таечка", needsLabel: true, date: "2026-11-10" });
    await tx(card, -2_000, "person_transfer", { counter: "Переказ на картку", needsLabel: true, date: "2026-11-15" });
    await ds.query(`UPDATE transactions SET counter_iban='UA00PERSON'`);
    const people = (await today()).questions.filter((q: { kind: string }) => q.kind === "recipient_label");
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ subject: "Таечка", text: "Таечка: 2 перевода, ₴30, последний 15.11" });
  });

  it("a generic text does not use up one of the three question slots", async () => {
    const card = await account("black", 5_000_000);
    at("2026-11-16T10:00:00Z");
    for (const [n, name] of ["Анна", "Борис", "Віра"].entries()) {
      await tx(card, -1_000, "person_transfer", { counter: name, needsLabel: true, date: `2026-11-0${n + 1}` });
    }
    await tx(card, -1_000, "person_transfer", { counter: "Переказ на картку", needsLabel: true, date: "2026-11-15" });
    const people = (await today()).questions.filter((q: { kind: string }) => q.kind === "recipient_label");
    expect(people.map((q: { subject: string }) => q.subject).sort()).toEqual(["Анна", "Борис", "Віра"]);
  });

  describe("is this credit from Binance", () => {
    const RATE = 40;
    const received = async () => {
      await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-16T09:00:00Z', $1)`, [RATE]);
      const ev = await income("usdc", "2026-11-25");
      await api.post(`/plan/incomes/${ev}/confirm`).expect(201); // 500,000 cents on Binance
      return ev;
    };
    const matchQs = (r: { questions: { id: string; kind: string; text: string }[] }) => r.questions.filter((q) => q.kind === "usdc_match");

    beforeEach(() => at("2026-11-16T10:00:00Z"));

    it("after a match free falls by exactly the amount that was counted twice", async () => {
      const card = await account("black", 1_000_000);
      const ev = await received();
      await setBalance(card, 1_000_000 + 12_000_000); // ₴120,000 lands on the card
      const t = await tx(card, 12_000_000, "person_in", { date: "2026-11-16" });

      const before = await today();
      expect(matchQs(before)).toEqual([
        { id: `usdc_match:${ev}:${t}`, kind: "usdc_match", text: "Пришло ₴120,000 (16.11). Это вывод с Binance?" },
      ]);
      expect(before.accounts.binance).toBe(500_000 * RATE);

      await api.post(`/plan/incomes/${ev}/match-transaction`, { transactionId: t }).expect(201);
      const after = await today();
      expect(before.state.free - after.state.free).toBe(12_000_000);
      expect(after.accounts.binance).toBe(500_000 * RATE - 12_000_000);
      expect(matchQs(after)).toEqual([]);
      expect((await api.get("/transactions").expect(200)).body.items[0]).toMatchObject({ id: t, type: "own_transfer" });
    });

    it("answering no leaves free alone and does not ask again", async () => {
      const card = await account("black", 1_000_000);
      await received();
      const t = await tx(card, 100_000, "cash_in", { date: "2026-11-16" });
      const before = await today();
      expect(matchQs(before)).toHaveLength(1);
      await api.post(`/plan/transactions/${t}/not-usdc`).expect(201);
      const after = await today();
      expect(matchQs(after)).toEqual([]);
      expect(after.state.free).toBe(before.state.free);
    });

    it("asks about three at most, the oldest first, then the next", async () => {
      const card = await account("black", 1_000_000);
      await received();
      const ids: number[] = [];
      for (const d of ["10", "11", "12", "13"]) ids.push(await tx(card, 200_000, "person_in", { date: `2026-11-${d}` }));
      const shown = matchQs(await today()).map((q) => Number(q.id.split(":")[2]));
      expect(shown).toEqual(ids.slice(0, 3));
      await api.post(`/plan/transactions/${ids[0]}/not-usdc`).expect(201);
      expect(matchQs(await today()).map((q) => Number(q.id.split(":")[2]))).toEqual(ids.slice(1));
    });

    it("stays silent below ₴1,000, with nothing on Binance, without a received event, or for history", async () => {
      const card = await account("black", 1_000_000);
      await tx(card, 500_000, "person_in", { date: "2026-11-16" });
      await ds.query(`INSERT INTO manual_balances (name, amount, currency) VALUES ('Binance', 100, 'USD')`);
      await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-16T09:00:00Z', $1)`, [RATE]);
      expect(matchQs(await today())).toEqual([]); // no USDC received yet

      await ds.query(`DELETE FROM transactions`);
      await ds.query(`DELETE FROM fx_rates`);
      await ds.query(`DELETE FROM manual_balances`);
      await received();
      await tx(card, 99_999, "person_in", { date: "2026-11-16" });
      await tx(card, 500_000, "person_in", { date: "2026-10-31" }); // before the income's month
      expect(matchQs(await today())).toEqual([]);

      const t = await tx(card, 100_000, "person_in", { date: "2026-11-16" });
      expect(matchQs(await today())).toHaveLength(1);
      await ds.query(`UPDATE settings SET tracking_start='2026-11-17'`);
      expect(matchQs(await today())).toEqual([]); // before tracking began
      await ds.query(`UPDATE settings SET tracking_start='2026-01-01'`);
      await ds.query(`UPDATE manual_balances SET amount=0 WHERE name='Binance'`);
      expect(matchQs(await today())).toEqual([]);
      await ds.query(`UPDATE manual_balances SET amount=100 WHERE name='Binance'`);
      await ds.query(`DELETE FROM fx_rates`);
      expect(matchQs(await today())).toEqual([]); // no rate, nothing could be lowered
      expect(t).toBeGreaterThan(0);
    });
  });

  it("converts upcoming foreign payments with the engine and flags a stale rate", async () => {
    await account("black", 1_000_000);
    await income("fop", "2026-11-12");
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-10-20T08:00:00Z', 40)`);
    await ds.query(`INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation','Abroad',1000,'USD','2026-11-10')`);
    const r = await today();
    expect(r.upcoming).toMatchObject([{ name: "Abroad", amount: 40_000 }]);
    expect(r.rateStale).toBe(true);
  });

  it("lists upcoming payments and the date the money runs out", async () => {
    const card = await account("black", 1_000_000);
    await income("fop", "2026-11-12");
    await payment("Rent", 100_000, "2026-11-06");
    await payment("After income", 100_000, "2026-11-15");
    await payment("Paid", 100_000, "2026-11-04");
    await ds.query(`UPDATE scheduled_payments SET paid_at=now() WHERE name='Paid'`);
    // 7 days of 10,000 spend ending yesterday
    for (let d = 26; d <= 31; d++) await tx(card, -10_000, "spend", { date: `2026-10-${d}` });
    await tx(card, -10_000, "spend", { date: "2026-11-01" });
    const r = await today();
    expect(r.upcoming).toEqual([{ id: expect.any(String), name: "Rent", amount: 100_000, dueOn: "2026-11-06", kind: "obligation", currency: "UAH" }]);
    // free = 900,000 / avg 10,000 per day = 90 days after today
    expect(r.runOutOn).toBe("2027-01-31");
  });
});

describe("runway to the next income", () => {
  it("draws the money day by day: down by the limit, a step on the payment's day", async () => {
    await account("black", 1_000_000);
    await income("fop", "2026-11-12");
    await payment("Rent", 100_000, "2026-11-06");
    await payment("After income", 100_000, "2026-11-15");
    await ds.query(`INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('tax','ЄП',50000,'UAH','2026-11-08')`);
    const r = await today();
    const limit = r.state.dailyLimit;
    const run = r.runway;
    expect(run.endOn).toBe("2026-11-12");
    expect(run.incomeOn).toBe("2026-11-12");
    expect(run.points).toHaveLength(11);
    expect(run.points[0]).toEqual({ date: "2026-11-02", balance: r.state.free + 100_000 });
    expect(run.points[4]).toEqual({ date: "2026-11-06", balance: r.state.free + 100_000 - 4 * limit });
    expect(run.points[5]).toEqual({ date: "2026-11-07", balance: r.state.free - 5 * limit });
    expect(run.reserve).toBe(r.state.free - 10 * limit);
    expect(run.points[10]).toEqual({ date: "2026-11-12", balance: run.reserve });
    expect(run.zeroOn).toBeNull();
    // Taxes are inside the reserve, payments after the income are not in this stretch.
    expect(run.events).toEqual([{ id: r.upcoming.find((u: { name: string }) => u.name === "Rent").id, date: "2026-11-06", name: "Rent", amount: 100_000 }]);
  });

  it("counts what is already spent today and puts an overdue payment on today", async () => {
    const card = await account("black", 1_000_000);
    await income("fop", "2026-11-04");
    await payment("Late", 30_000, "2026-10-28");
    await tx(card, -10_000, "spend", { date: "2026-11-02" });
    const r = await today();
    expect(r.runway.events).toEqual([{ id: r.upcoming[0].id, date: "2026-11-02", name: "Late", amount: 30_000 }]);
    expect(r.runway.points.map((p: { balance: number }) => p.balance)).toEqual([
      r.state.free + 30_000,
      r.state.free - r.state.leftToday,
      r.state.free - r.state.leftToday - r.state.dailyLimit,
    ]);
  });

  it("looks 30 days ahead without an income date and names the day the money ends", async () => {
    await account("black", 100_000);
    await payment("Big", 500_000, "2026-11-10");
    const r = await today();
    expect(r.state.mode).toBe("bridge");
    expect(r.runway.incomeOn).toBeNull();
    expect(r.runway.endOn).toBe("2026-12-02");
    expect(r.runway.points).toHaveLength(31);
    expect(r.runway.reserve).toBeLessThan(0);
    expect(r.runway.zeroOn).not.toBeNull();
    // ₴1,000 at ₴450 a day: the third day, the 4th, spends the last of it.
    expect(r.runway.zeroOn).toBe("2026-11-04");
  });
});

describe("settings preview", () => {
  const recurring = (kind: string, amount: number) =>
    ds.query(`INSERT INTO recurring_payments (kind, name, amount, currency, day_of_month) VALUES ($1,'x',$2,'UAH',6)`, [kind, amount]);
  const preview = async (cap: number) => (await api.post("/settings/preview", { lifestyleCap: cap }).expect(201)).body;

  async function seed() {
    await account("black", 30_000_000);
    await income("fop", "2026-11-12"); // 10 days, ₴5,000 expected
    await income("usdc", "2026-11-20"); // $5,000 expected
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-02T08:00:00Z', 40)`);
    await recurring("obligation", 2_000_000);
    await recurring("tax", 999_999); // recurring tax is not an obligation here: tax comes from the rate
  }

  it("computes the daily limit and what is left for goals under a cap, saving nothing", async () => {
    await seed();
    const before = (await api.get("/settings").expect(200)).body;

    // income 500,000 + 500,000 * 40 = 20,500,000; tax 6% of FOP 500,000 = 30,000; recurring 2,000,000; cap 3,000,000
    const wide = await preview(3_000_000);
    expect(wide).toEqual({ dailyLimit: 100_000, leftForGoalsMonthly: 15_470_000, rateStale: false });
    const roomy = await preview(100_000_000);
    expect(roomy.leftForGoalsMonthly).toBe(0); // floored, never negative
    expect(roomy.dailyLimit).toBeGreaterThan(wide.dailyLimit);

    expect((await api.get("/settings").expect(200)).body).toEqual(before);
    await api.post("/settings/preview", { lifestyleCap: -1 }).expect(400);
    await api.post("/settings/preview", {}).expect(400);
  });

  it("subtracts installments due this month, paid or not, and ignores other months", async () => {
    await seed();
    await payment("Phone", 1_000_000, "2026-11-18", "installment");
    await payment("Laptop", 400_000, "2026-11-05", "installment");
    await ds.query(`UPDATE scheduled_payments SET paid_at=now() WHERE name='Laptop'`);
    await payment("Later", 700_000, "2026-12-05", "installment");
    await payment("Rent", 700_000, "2026-11-05", "obligation");
    expect((await preview(3_000_000)).leftForGoalsMonthly).toBe(15_470_000 - 1_400_000);
  });

  it("subtracts tax on FOP income and a third of the quarterly ESV", async () => {
    await seed();
    await ds.query(`UPDATE settings SET tax_rate_bp=1000, esv_quarter=300000`);
    // tax 10% of 500,000 = 50,000; ESV 100,000
    expect((await preview(3_000_000)).leftForGoalsMonthly).toBe(20_500_000 - 50_000 - 100_000 - 2_000_000 - 3_000_000);
  });

  it("uses a template for a source with no event yet, and skips a source whose events are all in other months", async () => {
    await account("black", 30_000_000);
    await ds.query(`INSERT INTO expected_incomes (source, amount, currency, window_start_day, window_end_day) VALUES ('fop', 1000000, 'UAH', 15, 25)`);
    await ds.query(`UPDATE settings SET tax_rate_bp=0`);
    const low = await preview(100_000);
    expect(low.leftForGoalsMonthly).toBe(900_000); // template counted: 1,000,000 - cap 100,000
    await ds.query(`INSERT INTO income_events (expected_income_id, period, expected_on, status) VALUES (1, '2026-10', '2026-10-20', 'received')`);
    expect((await preview(100_000)).leftForGoalsMonthly).toBe(0); // only October has an event: no income this month
  });

  it("flags the figure when a foreign amount has no rate instead of silently using 0", async () => {
    await account("black", 30_000_000);
    await income("usdc", "2026-11-20");
    const r = await preview(100_000);
    expect(r.rateStale).toBe(true);
    expect(r.leftForGoalsMonthly).toBe(0);
  });
});
