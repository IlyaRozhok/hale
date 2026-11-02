import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { Clock } from "../src/today/clock";

let app: INestApplication;
let ds: DataSource;
let auth: string;
let clock: Clock;
let seq = 0;

const http = () => app.getHttpServer();
const api = {
  get: (p: string) => request(http()).get(p).set("Authorization", auth),
  post: (p: string, b: object = {}) => request(http()).post(p).set("Authorization", auth).send(b),
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
              scheduled_payments, recurring_payments, manual_balances, loans, bridge_plans, daily_snapshots
     RESTART IDENTITY CASCADE`,
  );
  await ds.query(
    `UPDATE settings SET lifestyle_cap=100000000, food_floor=45000, tax_rate_bp=600, esv_quarter=0, last_sync_at=NULL`,
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

const today = async () => (await api.get("/today").expect(200)).body;

describe("auth", () => {
  it("requires a token", async () => {
    await request(http()).get("/today").expect(401);
    await request(http()).post("/bridge").send({ dailyAmount: 1 }).expect(401);
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

  it("shares one limit between concurrent first requests", async () => {
    await account("black", 1_000_000);
    await income("fop", "2026-11-12");
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => api.get("/today")));
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
    expect((await today()).state.free).toBe(1_000_000 - 100_000);
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
    expect(r.accounts).toEqual({ own: 1_000_000 + 200_000 + 300_000 + 415_000 + 50_000, credit: 3_000_000, fop: 300_000, binance: 465_000 });

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
    await setBalance(card, 3_000_000 - 2_997_000 - 5_000);
    const r = await today();
    expect(r.state.bridge.overPlan).toBe(true);
    expect(r.badCases.map((b: { id: string }) => b.id)).toContain("bridge_over_plan");
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

  it("refuses an unaffordable plan or a plan outside bridge mode", async () => {
    await setup();
    await api.post("/bridge", { dailyAmount: 200_000 }).expect(422);
    await api.post("/bridge", { dailyAmount: 0 }).expect(400);
    await api.post("/bridge", { dailyAmount: 1.5 }).expect(400);
    expect(await plans()).toHaveLength(0);
    await ds.query(`UPDATE accounts SET balance=50000000`);
    await api.post("/bridge", { dailyAmount: 100_000 }).expect(409);
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
    expect(kinds.filter((k: string) => k === "recipient_label")).toHaveLength(3);
    expect(kinds).not.toContain("income_date");

    at("2026-11-02T10:00:00Z");
    expect((await today()).questions.map((q: { kind: string }) => q.kind)).not.toContain("usdc_arrived");
    await ds.query(`DELETE FROM income_events`);
    expect((await today()).questions.map((q: { kind: string }) => q.kind)).toContain("income_date");
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
    expect(r.upcoming).toEqual([{ id: expect.any(String), name: "Rent", amount: 100_000, dueOn: "2026-11-06", kind: "obligation" }]);
    // free = 900,000 / avg 10,000 per day = 90 days after today
    expect(r.runOutOn).toBe("2027-01-31");
  });
});
