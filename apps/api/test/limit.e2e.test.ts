import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { NotificationsService } from "../src/notifications/notifications.service";
import { PlanService } from "../src/plan/plan.service";
import { Clock } from "../src/time/clock";
import { TodayService } from "../src/today/today.service";

/**
 * Task Б4 (owner's decision of 11 November, risk 7 of the audit): the day's limit changes at once when the
 * person changes the plan, the settings, Binance, a loan, or marks a payment paid. Every such change goes
 * through `LimitService.invalidate(reason)`, which fixes the day afresh in the same transaction: there is
 * never a moment without today's row, and `GET /today` shows the new limit right away.
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
  patch: (p: string, b: object = {}) => request(http()).patch(p).set("Authorization", auth).send(b),
  delete: (p: string) => request(http()).delete(p).set("Authorization", auth),
};
const at = (iso: string) => {
  clock.fixed = new Date(iso);
};
const TODAY = "2026-11-02";

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
    `TRUNCATE jobs, rules, transactions, accounts, fx_rates, income_events, expected_incomes, scheduled_payments,
              recurring_payments, manual_balances, loans, bridge_plans, daily_snapshots, goals, cash_cards, payment_links,
              notifications_log
     RESTART IDENTITY CASCADE`,
  );
  await ds.query(
    `UPDATE settings SET lifestyle_cap=100000000, food_floor=45000, tax_rate_bp=600, esv_quarter=0, limit_visual='mercury',
                         cash_start=NULL, cash_started_at=NULL, last_sync_at=NULL, last_contact_at=NULL, tracking_start='2026-01-01'`,
  );
  at(`${TODAY}T10:00:00Z`);
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

async function tx(accountId: number, amount: number, type: string, date = TODAY): Promise<number> {
  seq++;
  return (
    await ds.query(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, raw)
       VALUES ($1,$2,$3,$4,'x',$5,$5,$6,'{}') RETURNING id`,
      [`tx-${seq}`, accountId, `${date}T10:00:00Z`, date, amount, type],
    )
  )[0].id;
}

async function income(on: string, source: "fop" | "usdc" = "fop"): Promise<number> {
  const exp = (
    await ds.query(
      `INSERT INTO expected_incomes (source, pays_fop_tax, crypto, amount, currency, window_start_day, window_end_day) VALUES ($1,$1='fop',$1='usdc',$2,$3,1,28) RETURNING id`,
      [source, source === "fop" ? 500_000 : 100_000, source === "fop" ? "UAH" : "USD"],
    )
  )[0].id;
  return (
    await ds.query(`INSERT INTO income_events (expected_income_id, period, expected_on, status) VALUES ($1,$2,$3,'expected') RETURNING id`, [
      exp, on.slice(0, 7), on,
    ])
  )[0].id;
}
const payment = async (name: string, amount: number, due: string): Promise<number> =>
  (await ds.query(`INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation',$1,$2,'UAH',$3) RETURNING id`, [name, amount, due]))[0].id;
const fixed = (date: string, amount: number, mode: string) =>
  ds.query(`INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ($1,$2,$3)`, [date, amount, mode]);

/** The read alone: the app's request, with no writer run before it. */
const today = async () => (await api.get("/today").expect(200)).body;
const calendarToday = async () => (await api.get("/today/calendar?month=2026-11").expect(200)).body.days.at(-1);
const ensure = () => app.get(TodayService).ensureSnapshot();
const tick = () => app.get(NotificationsService).tick();

/** Today's row as Postgres prints it, or null. */
const row = async (): Promise<string | null> =>
  ((await ds.query(`SELECT row_to_json(d)::text AS r FROM daily_snapshots d WHERE local_date=$1`, [TODAY])) as { r: string }[])[0]?.r ?? null;

/** A row the day cannot have come by honestly: any recompute replaces it. */
const plant = () =>
  ds.query(`INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ($1, 1, 'normal') ON CONFLICT (local_date) DO UPDATE SET daily_limit=1, mode='normal'`, [TODAY]);

/**
 * What every listed change must leave behind: today's row is there with the limit the read shows and the calendar
 * shows, it is not the planted one, and neither the writer nor the 15-minute job changes it afterwards — even when
 * the facts move in the meantime (finding A on PR #57: no floating limit).
 */
async function fixedNow(expected?: number): Promise<number> {
  const r = await row();
  expect(r).not.toBeNull();
  const limit = (JSON.parse(r!) as { daily_limit: number }).daily_limit;
  expect(limit).not.toBe(1);
  if (expected !== undefined) expect(limit).toBe(expected);
  expect((await today()).state.dailyLimit).toBe(limit);
  expect(await calendarToday()).toMatchObject({ date: TODAY, limit, status: "today" });
  await ds.query(`UPDATE accounts SET balance = balance + 1000000 WHERE kind='black'`); // money lands before the next tick
  await ensure();
  await tick();
  expect(await row()).toBe(r);
  await ds.query(`UPDATE accounts SET balance = balance - 1000000 WHERE kind='black'`);
  return limit;
}

/** The money that makes 2 November an ordinary ₴1,000 day: ₴10,000 free, income in 10 days. */
async function ordinary(): Promise<number> {
  const card = await account("black", 4_000_000, { creditLimit: 3_000_000 });
  await income("2026-11-12");
  await fixed("2026-11-01", 100_000, "normal");
  return card;
}

describe("the plan", () => {
  it("a one-off payment: added, changed, deleted", async () => {
    await ordinary();
    await plant();
    const { id } = (await api.post("/plan/payments", { kind: "obligation", name: "Страховка", amount: 200_000, currency: "UAH", due_on: "2026-11-05" }).expect(201)).body;
    await fixedNow(80_000);
    await api.patch(`/plan/payments/${id}`, { amount: 300_000 }).expect(200);
    await fixedNow(70_000);
    await api.delete(`/plan/payments/${id}`).expect(200);
    await fixedNow(100_000);
  });

  it("a monthly payment: added, changed, deleted", async () => {
    await ordinary();
    await plant();
    const id = (await api.post("/plan/recurring", { name: "Квартира", amount: 100_000, currency: "UAH", day_of_month: 5 }).expect(201)).body.id as number;
    await fixedNow(90_000);
    await plant();
    await api.patch(`/plan/recurring/${id}`, { amount: 200_000 }).expect(200);
    await fixedNow(80_000);
    await plant();
    await api.delete(`/plan/recurring/${id}`).expect(200);
    await fixedNow(100_000);
  });

  it("an installment: added, changed, deleted", async () => {
    await ordinary();
    await plant();
    await api.post("/plan/installments", { name: "Телефон", amount: 100_000, currency: "UAH", remaining: 2, first_due: "2026-11-10" }).expect(201);
    await fixedNow(90_000);
    await plant();
    await api.patch(`/plan/installments/${encodeURIComponent("Телефон")}`, { amount: 200_000 }).expect(200);
    await fixedNow(80_000);
    await plant();
    await api.delete(`/plan/installments/${encodeURIComponent("Телефон")}`).expect(200);
    await fixedNow(100_000);
  });

  it("an expected income: added, changed, deleted", async () => {
    // The 30-day share (₴333) is below the plan's recommended sum, which would hide it (Б47 (3)): ₴1 here.
    await ds.query(`UPDATE settings SET food_floor=100`);
    await account("black", 4_000_000, { creditLimit: 3_000_000 });
    await fixed("2026-11-01", 100_000, "normal");
    await plant();
    const id = (await api.post("/plan/expected-incomes", { source: "fop", amount: 500_000, currency: "UAH", window_start_day: 10, window_end_day: 10 }).expect(201)).body.id as number;
    // Its event lands on its window's end, the 10th (Б28): 8 days of ₴10,000.
    await fixedNow(Math.floor(1_000_000 / 8));
    await plant();
    await api.patch(`/plan/expected-incomes/${id}`, { amount: 600_000 }).expect(200);
    await fixedNow(Math.floor(1_000_000 / 8));
    await plant();
    await api.delete(`/plan/expected-incomes/${id}`).expect(200);
    await fixedNow(Math.floor(1_000_000 / 30));
  });
});

describe("income events", () => {
  it("a new income date is in force at once", async () => {
    const eventId = await income("2026-11-12");
    await account("black", 4_000_000, { creditLimit: 3_000_000 });
    await fixed("2026-11-01", 100_000, "normal");
    await plant();
    await api.post(`/plan/incomes/${eventId}/date`, { date: "2026-11-07" }).expect(201);
    await fixedNow(200_000);
  });

  it("«Да, пришло» counts the money at once", async () => {
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-02T08:00:00Z', 40)`);
    const eventId = await income("2026-11-12", "usdc");
    await account("black", 4_000_000, { creditLimit: 3_000_000 });
    await fixed("2026-11-01", 100_000, "normal");
    await plant();
    await api.post(`/plan/incomes/${eventId}/confirm`).expect(201);
    // $1,000 at 40 on Binance, no income date left: ₴50,000 over 30 days.
    const limit = await fixedNow(Math.floor(5_000_000 / 30));
    // The second confirm changes nothing, so the row stays as it is.
    const before = await row();
    await api.post(`/plan/incomes/${eventId}/confirm`).expect(201);
    expect(await row()).toBe(before);
    expect((await today()).state.dailyLimit).toBe(limit);
  });

  it("«Пришло другое» counts the amount that arrived at once, not the expected one (Б18)", async () => {
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-02T08:00:00Z', 40)`);
    const eventId = await income("2026-11-12", "usdc"); // $1,000 expected
    await account("black", 4_000_000, { creditLimit: 3_000_000 });
    await fixed("2026-11-01", 100_000, "normal");
    await plant();
    await api.post(`/plan/incomes/${eventId}/confirm`, { amount: 90_000 }).expect(201);
    // $900 at 40 on Binance plus ₴10,000 own on the card, no income date left: ₴46,000 over 30 days.
    await fixedNow(Math.floor(4_600_000 / 30));
  });

  it("matching a bank credit to a Binance withdrawal lowers the limit at once", async () => {
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-02T08:00:00Z', 40)`);
    const eventId = await income("2026-11-12", "usdc");
    const card = await account("black", 4_000_000, { creditLimit: 3_000_000 });
    await api.post(`/plan/incomes/${eventId}/confirm`).expect(201);
    const credit = await tx(card, 2_000_000, "person_in");
    await setBalance(card, 6_000_000);
    await plant();
    await api.post(`/plan/incomes/${eventId}/match-transaction`, { transactionId: credit }).expect(201);
    // Binance falls by $500: own money is ₴30,000 + ₴20,000 on the card.
    await fixedNow(Math.floor(5_000_000 / 30));
  });
});

describe("«Оплачено»", () => {
  it("marking a payment paid by hand frees its money today", async () => {
    await ordinary();
    const id = await payment("Страховка", 200_000, "2026-11-05");
    await ensure();
    expect((await today()).state.dailyLimit).toBe(80_000);
    await api.post(`/plan/payments/${id}/mark-paid`).expect(201);
    await fixedNow(100_000);
  });

  it("a payment paid in cash, or with chosen bank rows", async () => {
    const card = await ordinary();
    await api.post("/cash/start", { amount: 300_000 }).expect(201);
    await fixedNow(130_000);
    const inCash = await payment("Квартплата", 200_000, "2026-11-05");
    const byRows = await payment("Кредит", 100_000, "2026-11-05");
    await plant();
    await api.post(`/cash/payments/${inCash}`).expect(201);
    // The wallet lost ₴2,000 and that payment is gone; the other ₴1,000 is still due.
    await fixedNow(100_000);
    const withdrawal = await tx(card, -100_000, "cash_out", "2026-11-01");
    await plant();
    await api.post(`/cash/payments/${byRows}/links`, { transactionIds: [withdrawal] }).expect(201);
    await fixedNow(110_000);
  });

  it("deleting the cash row that paid a payment puts the payment back into the limit", async () => {
    await ordinary();
    await api.post("/cash/start", { amount: 300_000 }).expect(201);
    const id = await payment("Квартплата", 200_000, "2026-11-05");
    await api.post(`/cash/payments/${id}`).expect(201);
    const txId = (await ds.query(`SELECT transaction_id FROM scheduled_payments WHERE id=$1`, [id]))[0].transaction_id as number;
    await plant();
    await api.delete(`/cash/operations/${txId}`).expect(200);
    await fixedNow(110_000);
  });
});

describe("loans", () => {
  it("a loan entered by hand lowers the limit at once; repaying or deleting it gives the money back", async () => {
    await ordinary();
    await plant();
    const id = (await api.post("/plan/loans", { amount: 100_000, received_on: TODAY, note: "manual" }).expect(201)).body.id as number;
    await fixedNow(90_000);
    await plant();
    await api.post(`/plan/loans/${id}/repay`, { amount: 40_000, date: TODAY }).expect(201);
    await fixedNow(94_000);
    await plant();
    await api.delete(`/plan/loans/${id}`).expect(200);
    await fixedNow(100_000);
  });

  it("editing a loan from the list", async () => {
    await ordinary();
    const id = (await api.post("/plan/loans", { amount: 100_000, received_on: TODAY, note: "manual" }).expect(201)).body.id as number;
    await plant();
    await api.patch(`/plan/loans/${id}`, { amount: 200_000 }).expect(200);
    await fixedNow(80_000);
  });

  it("a return date set or cleared fixes the limit afresh at once (Б7)", async () => {
    await ordinary();
    const id = (await api.post("/plan/loans", { amount: 100_000, received_on: TODAY, note: "manual" }).expect(201)).body.id as number;
    await fixedNow(90_000);
    await plant();
    // After the next income (12 November): nothing to keep for it before then.
    expect((await api.patch(`/plan/loans/${id}`, { due_on: "2026-11-20" }).expect(200)).body.due_on).toBe("2026-11-20");
    await fixedNow(100_000);
    await plant();
    await api.patch(`/plan/loans/${id}`, { due_on: "2026-11-05" }).expect(200);
    await fixedNow(90_000);
    await plant();
    await api.patch(`/plan/loans/${id}`, { due_on: "2026-11-20" }).expect(200);
    await fixedNow(100_000);
    await plant();
    expect((await api.patch(`/plan/loans/${id}`, { due_on: null }).expect(200)).body.due_on).toBeNull();
    await fixedNow(90_000);
  });
});

describe("Binance and other manual balances", () => {
  beforeEach(() => ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-02T08:00:00Z', 40)`));

  it("a balance that counts as own money: added, changed, deleted", async () => {
    await ordinary();
    await plant();
    const id = (await api.post("/plan/manual-balances", { name: "Binance", amount: 25_000, currency: "USD" }).expect(201)).body.id as number;
    // $250 at 40: ₴10,000 more over 10 days.
    await fixedNow(200_000);
    await plant();
    await api.patch(`/plan/manual-balances/${id}`, { amount: 50_000 }).expect(200);
    await fixedNow(300_000);
    await plant();
    await api.delete(`/plan/manual-balances/${id}`).expect(200);
    await fixedNow(100_000);
  });

  it("a set-aside balance is outside the limit: the day's row is left alone", async () => {
    await ordinary();
    await ensure();
    const before = await row();
    const id = (await api.post("/plan/manual-balances", { name: "Solana", amount: 75_000, currency: "USD", counts_as_own: false }).expect(201)).body.id as number;
    expect(await row()).toBe(before);
    await api.patch(`/plan/manual-balances/${id}`, { amount: 80_000 }).expect(200);
    expect(await row()).toBe(before);
    expect((await today()).state.dailyLimit).toBe(100_000);
    // Taken into own money, it counts at once; set aside again, it leaves at once.
    await api.patch(`/plan/manual-balances/${id}`, { counts_as_own: true }).expect(200);
    await fixedNow(420_000);
    await api.patch(`/plan/manual-balances/${id}`, { counts_as_own: false }).expect(200);
    await fixedNow(100_000);
    const kept = await row();
    await api.delete(`/plan/manual-balances/${id}`).expect(200);
    expect(await row()).toBe(kept);
  });
});

describe("settings", () => {
  it("a new monthly cap or food floor applies today", async () => {
    await ordinary();
    await plant();
    await api.patch("/settings", { lifestyle_cap: 1_500_000 }).expect(200);
    await fixedNow(50_000);
    await plant();
    await api.patch("/settings", { lifestyle_cap: 0 }).expect(200);
    await fixedNow(100_000);
  });

  it("the look of the limit changes nothing about the money, so the day is not refixed", async () => {
    await ordinary();
    await ensure();
    const before = await row();
    await api.patch("/settings", { limit_visual: "ring" }).expect(200);
    expect(await row()).toBe(before);
    await api.patch("/settings", {}).expect(200);
    expect(await row()).toBe(before);
  });
});

describe("the cash wallet", () => {
  it("starting the wallet counts the pocket at once", async () => {
    await ordinary();
    await plant();
    await api.post("/cash/start", { amount: 500_000 }).expect(201);
    await fixedNow(150_000);
  });
});

describe("the night jobs that used to delete the row", () => {
  it("a tax estimate for the quarter that just ended lowers the limit at once", async () => {
    const card = await account("fop", 5_000_000);
    await tx(card, 1_000_000, "income", "2026-12-20");
    await income("2027-01-20");
    at("2027-01-01T00:00:00Z"); // 02:00 in Kyiv on 1 January: the 15-minute job has already fixed the day
    await ensure();
    const early = (await today()).state.dailyLimit;
    await app.get(PlanService).ensureTaxEstimate();
    const r = await row2("2027-01-01");
    expect(r).not.toBeNull();
    const after = await today();
    expect(after.state.dailyLimit).toBeLessThan(early);
    expect((JSON.parse(r!) as { daily_limit: number }).daily_limit).toBe(after.state.dailyLimit);
  });

  it("templates that got their first rows reach the limit the same hour", async () => {
    // The 30-day share (₴333) is below the plan's recommended sum, which would hide it (Б47 (3)): ₴1 here.
    await ds.query(`UPDATE settings SET food_floor=100`);
    await account("black", 4_000_000, { creditLimit: 3_000_000 });
    await ensure();
    expect((await today()).state.dailyLimit).toBe(Math.floor(1_000_000 / 30));
    await ds.query(`INSERT INTO expected_incomes (source, pays_fop_tax, crypto, amount, currency, window_start_day, window_end_day) VALUES ('fop', true, false, 500000,'UAH',12,12)`);
    await app.get(PlanService).hourlyJob();
    // Its event lands on its window's end, the 12th (Б28): 10 days instead of 30.
    await fixedNow(Math.floor(1_000_000 / 10));
  });

  it("an income without a schedule, which never gets rows, does not fix the day afresh every hour (Д3а)", async () => {
    const card = await account("black", 1_000_000);
    await income("2026-11-20");
    await ds.query(
      `INSERT INTO expected_incomes (name, schedule, amount, currency, window_start_day, window_end_day) VALUES ('Заказчик А', 'none', 100000, 'USD', 1, 31)`,
    );
    await ensure();
    const fixed = await row2(TODAY);
    expect(fixed).not.toBeNull();
    // Money that arrives on its own keeps the day's limit; the hourly job must too.
    await setBalance(card, 4_000_000);
    await app.get(PlanService).hourlyJob();
    expect(await row2(TODAY)).toBe(fixed);
  });
});

const row2 = async (date: string): Promise<string | null> =>
  ((await ds.query(`SELECT row_to_json(d)::text AS r FROM daily_snapshots d WHERE local_date=$1`, [date])) as { r: string }[])[0]?.r ?? null;

describe("what a recompute must keep", () => {
  it("the same facts give the same row (invariant 8)", async () => {
    await ordinary();
    await ensure();
    const before = await row();
    await api.patch("/settings", { food_floor: 45_000 }).expect(200);
    expect(await row()).toBe(before);
    await api.patch("/settings", { food_floor: 45_000 }).expect(200);
    expect(await row()).toBe(before);
  });

  it("the day the shortage came on keeps its mark through a change (А9)", async () => {
    const card = await ordinary();
    await ensure();
    await tx(card, -1_100_000, "spend");
    await setBalance(card, 2_900_000);
    await ensure();
    expect(await row()).toBe(`{"local_date":"2026-11-02","daily_limit":100000,"mode":"bridge_start"}`);
    await api.post("/plan/payments", { kind: "obligation", name: "Страховка", amount: 10_000, currency: "UAH", due_on: "2026-11-05" }).expect(201);
    expect(await row()).toBe(`{"local_date":"2026-11-02","daily_limit":99000,"mode":"bridge_start"}`);
    const r = await today();
    expect(r.state.shortageStart).toEqual({ nextLimit: 45_000 });
    expect(await calendarToday()).toMatchObject({ limit: 99_000, shortageStart: true });
  });

  it("a confirmed plan keeps its limit, and its credit need follows a new payment", async () => {
    await account("black", 4_032_500, { creditLimit: 3_000_000 });
    await income("2026-11-20");
    await fixed("2026-11-01", 100_000, "normal");
    await payment("Rent", 1_700_000, "2026-11-06");
    await api.post("/bridge", { dailyAmount: 100_000 }).expect(201);
    await api.post("/plan/payments", { kind: "obligation", name: "Phone", amount: 100_000, currency: "UAH", due_on: "2026-11-10" }).expect(201);
    expect(await row()).toBe(`{"local_date":"2026-11-02","daily_limit":100000,"mode":"bridge_start"}`);
    expect((await ds.query(`SELECT credit_plan::int AS c FROM bridge_plans`))[0].c).toBe(767_500 + 1_800_000);
    expect((await today()).state.dailyLimit).toBe(100_000);
  });
});
