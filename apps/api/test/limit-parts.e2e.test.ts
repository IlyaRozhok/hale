import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { NotificationsService } from "../src/notifications/notifications.service";
import { Clock } from "../src/time/clock";
import { TodayService } from "../src/today/today.service";

/**
 * Task ЧЛ2 (the owner's decision of 24 November, «А: хранить»): what the day's limit is made of is stored with the
 * limit, from the computation that gave it, and `GET /today` gives it as `state.parts` from the same source as the
 * limit on the screen. The parts always add up to that limit; they do not move with spending or a sync, and are
 * written again exactly where the limit is.
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

async function tx(accountId: number, amount: number, type: string, date = TODAY): Promise<void> {
  seq++;
  await ds.query(
    `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, raw)
     VALUES ($1,$2,$3,$4,'x',$5,$5,$6,'{}')`,
    [`tx-${seq}`, accountId, `${date}T10:00:00Z`, date, amount, type],
  );
}

async function income(on: string): Promise<number> {
  const exp = (
    await ds.query(
      `INSERT INTO expected_incomes (source, pays_fop_tax, crypto, amount, currency, window_start_day, window_end_day) VALUES ('fop', true, false, 500000,'UAH',1,28) RETURNING id`,
    )
  )[0].id;
  return (
    await ds.query(`INSERT INTO income_events (expected_income_id, period, expected_on, status) VALUES ($1,$2,$3,'expected') RETURNING id`, [
      exp, on.slice(0, 7), on,
    ])
  )[0].id;
}
const payment = (name: string, amount: number, due: string) =>
  ds.query(`INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation',$1,$2,'UAH',$3)`, [name, amount, due]);
const fixed = (date: string, amount: number, mode: string) =>
  ds.query(`INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ($1,$2,$3)`, [date, amount, mode]);

interface Parts {
  own: number; taxReserve: number; obligationsDue: number; goalDue: number; borrowed: number; free: number;
  daysLeft: number; share: number; rule: string; dailyLimit: number; capDefault?: true; noIncomeDate?: true;
}
interface State { mode: string; dailyLimit: number; leftToday: number; free: number; daysLeft: number; needsIncomeDate: boolean; parts?: Parts; shortageStart?: { nextLimit?: number } }

/** The read alone: the app's request, with no writer run before it. */
const state = async (): Promise<State> => (await api.get("/today").expect(200)).body.state;
const ensure = () => app.get(TodayService).ensureSnapshot();
const tick = () => app.get(NotificationsService).tick();
/** Today's row: its limit and what is stored with it. */
const row = async (): Promise<{ limit: number; mode: string; parts: Parts | null } | null> =>
  ((await ds.query(`SELECT daily_limit::float8 AS "limit", mode, parts FROM daily_snapshots WHERE local_date=$1`, [TODAY])) as {
    limit: number; mode: string; parts: Parts | null;
  }[])[0] ?? null;
const rows = async (): Promise<string[]> =>
  ((await ds.query(`SELECT row_to_json(d)::text AS r FROM daily_snapshots d ORDER BY local_date`)) as { r: string }[]).map((x) => x.r);

/** The parts add up, and their limit is the one on the screen. */
function sound(s: State): Parts {
  expect(s.parts).toBeDefined();
  const p = s.parts!;
  expect(p.own - p.taxReserve - p.obligationsDue - p.goalDue - p.borrowed).toBe(p.free);
  expect(p.dailyLimit).toBe(s.dailyLimit);
  expect(p.share).toBe(Math.floor(p.free / p.daysLeft));
  return p;
}

/** The money that makes 2 November an ordinary ₴1,000 day: ₴10,000 free, income in 10 days; the 1st fixed as ordinary. */
async function ordinary(): Promise<number> {
  const card = await account("black", 4_000_000, { creditLimit: 3_000_000 });
  await income("2026-11-12");
  await fixed("2026-11-01", 100_000, "normal");
  return card;
}
const ORDINARY: Parts = {
  own: 1_000_000, taxReserve: 0, obligationsDue: 0, goalDue: 0, borrowed: 0, free: 1_000_000, daysLeft: 10, share: 100_000, rule: "share", dailyLimit: 100_000,
};

/** The shortage: own ₴10,325 against ₴17,000 of rent before the income of the 20th. */
async function shortage(): Promise<number> {
  const card = await account("black", 4_032_500, { creditLimit: 3_000_000 });
  await income("2026-11-20");
  await payment("Rent", 1_700_000, "2026-11-06");
  return card;
}

describe("a day with no row: the parts of the morning computation that gave the limit shown", () => {
  it("the first request of the day, after some spending, and nothing is written", async () => {
    const card = await ordinary();
    await tx(card, -20_000, "spend");
    await setBalance(card, 3_980_000);
    const before = await rows();
    const s = await state();
    // The parts are the morning's (today's spending added back); what is spent and left is live, in the state itself.
    expect(sound(s)).toEqual(ORDINARY);
    expect(s).toMatchObject({ dailyLimit: 100_000, leftToday: 80_000, free: 980_000 });
    expect(await rows()).toEqual(before);
  });

  it("the writer stores exactly what the read showed, and the read then gives it back", async () => {
    const card = await ordinary();
    await tx(card, -20_000, "spend");
    await setBalance(card, 3_980_000);
    const shown = await state();
    await ensure();
    expect(await row()).toEqual({ limit: 100_000, mode: "normal", parts: ORDINARY });
    expect(await state()).toEqual(shown);
  });

  it("a plan that is closing: the row of the plan's limit does not count, and neither do its parts", async () => {
    const card = await shortage();
    await api.post("/bridge", { dailyAmount: 100_000 }).expect(201);
    expect((await row())!.parts).toMatchObject({ rule: "plan", dailyLimit: 100_000 });
    await setBalance(card, 10_000_000); // the shortage is over; the writer has not run yet
    const before = await rows();
    const s = await state();
    expect(s.mode).toBe("normal");
    // own ₴70,000 − rent ₴17,000 = ₴53,000 over 18 days
    expect(sound(s)).toEqual({ ...ORDINARY, own: 7_000_000, obligationsDue: 1_700_000, free: 5_300_000, daysLeft: 18, share: 294_444, dailyLimit: 294_444 });
    expect(await rows()).toEqual(before);
    expect((await row())!.parts).toMatchObject({ rule: "plan", dailyLimit: 100_000 });
    // The writer closes the plan and fixes the day afresh with what the read showed.
    await ensure();
    expect((await row())!.parts).toEqual(s.parts);
    expect(await state()).toEqual(s);
  });
});

describe("a day with its row: the parts stored with the limit", () => {
  it("do not move with spending, a sync or the jobs, while the live figures do", async () => {
    const card = await ordinary();
    await ensure();
    const stored = await row();
    expect(stored).toEqual({ limit: 100_000, mode: "normal", parts: ORDINARY });

    await tx(card, -30_000, "spend");
    await setBalance(card, 3_970_000);
    await ensure();
    await tick();
    let s = await state();
    expect(sound(s)).toEqual(ORDINARY);
    expect(s).toMatchObject({ leftToday: 70_000, free: 970_000 });

    // Money lands (a sync brings a new balance): a fresh limit would be ₴3,970, the fixed one and its parts stay.
    await setBalance(card, 6_970_000);
    await ensure();
    await tick();
    s = await state();
    expect(sound(s)).toEqual(ORDINARY);
    expect(s.free).toBe(3_970_000);
    expect(await row()).toEqual(stored);
  });

  it("a row without parts (fixed before they were stored) gives no field, and the writer does not add them", async () => {
    await ordinary();
    await fixed(TODAY, 100_000, "normal");
    expect(await state()).not.toHaveProperty("parts");
    await ensure();
    await tick();
    expect((await row())!.parts).toBeNull();
    const s = await state();
    expect(s).not.toHaveProperty("parts");
    expect(s.dailyLimit).toBe(100_000);
  });

  it("parts that do not explain the row's limit are not shown", async () => {
    await ordinary();
    await ensure();
    await ds.query(`UPDATE daily_snapshots SET daily_limit=90000 WHERE local_date=$1`, [TODAY]);
    const s = await state();
    expect(s.dailyLimit).toBe(90_000);
    expect(s).not.toHaveProperty("parts");
    await ds.query(`UPDATE daily_snapshots SET daily_limit=100000, parts='{"rule":"other"}' WHERE local_date=$1`, [TODAY]);
    expect(await state()).not.toHaveProperty("parts");
  });

  it("the day the shortage came on keeps the parts of the limit it began with", async () => {
    const card = await ordinary();
    await ensure();
    await tx(card, -1_100_000, "spend");
    await setBalance(card, 2_900_000);
    await ensure();
    const s = await state();
    expect(s).toMatchObject({ mode: "bridge", dailyLimit: 100_000, shortageStart: { nextLimit: 45_000 } });
    expect(sound(s)).toEqual(ORDINARY);
    expect((await row())!.mode).toBe("bridge_start");
  });

  it("days are the computation's: fixed on the income day it is 1, and stays 1 once the income has come", async () => {
    await account("black", 4_000_000, { creditLimit: 3_000_000 });
    const event = await income(TODAY);
    await ensure();
    expect(sound(await state())).toMatchObject({ daysLeft: 1, share: 1_000_000, rule: "share" });
    await ds.query(`UPDATE income_events SET status='received', received_at=now() WHERE id=$1`, [event]);
    const s = await state();
    expect(s).toMatchObject({ daysLeft: 30, needsIncomeDate: true });
    const p = sound(s);
    expect(p.daysLeft).toBe(1);
    expect(p).not.toHaveProperty("noIncomeDate");
  });

  it("no income date: 30 days and a mark", async () => {
    await account("black", 4_000_000, { creditLimit: 3_000_000 });
    await ensure();
    expect(sound(await state())).toMatchObject({ daysLeft: 30, noIncomeDate: true, rule: "floor", share: 33_333, dailyLimit: 45_000 });
  });
});

describe("the rule", () => {
  it("the shortage without a confirmed plan is the recommended sum, not the plan", async () => {
    await shortage();
    const s = await state();
    expect(s.mode).toBe("bridge");
    expect(sound(s)).toMatchObject({ rule: "floor", dailyLimit: 45_000, own: 1_032_500, obligationsDue: 1_700_000, free: -667_500, daysLeft: 18 });
    await ensure();
    expect((await row())!.parts).toEqual(s.parts);
  });

  it("a cap the person set, and the default one nobody chose", async () => {
    await ordinary();
    await ensure();
    await api.patch("/settings", { lifestyle_cap: 1_500_000 }).expect(200);
    let s = await state();
    expect(sound(s)).toEqual({ ...ORDINARY, rule: "cap", dailyLimit: 50_000 });
    // Never set: ₴100,000 a month is ₴3,333 a day, above the share here, and marked as nobody's choice.
    await api.patch("/settings", { lifestyle_cap: 0 }).expect(200);
    s = await state();
    expect(sound(s)).toEqual({ ...ORDINARY, capDefault: true });
    await ds.query(`UPDATE accounts SET balance=13000000`);
    await app.get(TodayService).refix();
    s = await state();
    expect(sound(s)).toEqual({ ...ORDINARY, own: 10_000_000, free: 10_000_000, share: 1_000_000, rule: "cap", dailyLimit: 333_333, capDefault: true });
  });
});

describe("the parts are written again exactly where the limit is", () => {
  it("a change by the person's hand (LimitService.invalidate) replaces both", async () => {
    await ordinary();
    await ensure();
    await api.post("/plan/payments", { kind: "obligation", name: "Страховка", amount: 200_000, currency: "UAH", due_on: "2026-11-05" }).expect(201);
    expect(await row()).toEqual({ limit: 80_000, mode: "normal", parts: { ...ORDINARY, obligationsDue: 200_000, free: 800_000, share: 80_000, dailyLimit: 80_000 } });
    expect(sound(await state()).dailyLimit).toBe(80_000);
  });

  it("a row without parts gets them when the limit is fixed afresh", async () => {
    await ordinary();
    await fixed(TODAY, 100_000, "normal");
    await api.post("/plan/payments", { kind: "obligation", name: "Страховка", amount: 200_000, currency: "UAH", due_on: "2026-11-05" }).expect(201);
    expect(sound(await state())).toMatchObject({ dailyLimit: 80_000, obligationsDue: 200_000 });
  });

  it("confirming a plan stores the plan's sum as the rule; cancelling it stores the morning's parts again", async () => {
    const card = await shortage();
    await ensure();
    expect((await row())!.parts).toMatchObject({ rule: "floor", dailyLimit: 45_000 });
    // Spent since the morning: the parts stay the morning's, own money with today's spending added back.
    await tx(card, -10_000, "spend");
    await setBalance(card, 4_022_500);
    await api.post("/bridge", { dailyAmount: 60_000 }).expect(201);
    let s = await state();
    expect(s).toMatchObject({ mode: "bridge", dailyLimit: 60_000, leftToday: 50_000, free: -677_500 });
    expect(sound(s)).toEqual({ ...ORDINARY, own: 1_032_500, obligationsDue: 1_700_000, free: -667_500, daysLeft: 18, share: Math.floor(-667_500 / 18), rule: "plan", dailyLimit: 60_000 });
    expect((await row())!.parts).toEqual(s.parts);

    // Another sum: written again.
    await api.post("/bridge", { dailyAmount: 70_000 }).expect(201);
    expect(sound(await state())).toMatchObject({ rule: "plan", dailyLimit: 70_000 });

    await api.delete("/bridge").expect(200);
    s = await state();
    expect(sound(s)).toMatchObject({ rule: "floor", dailyLimit: 45_000, own: 1_032_500, free: -667_500 });
    expect((await row())!.parts).toEqual(s.parts);
  });

  it("a plan confirmed on a day that began ordinary: the parts are of the computation the plan's sum came from", async () => {
    const card = await ordinary();
    await ensure();
    await tx(card, -1_100_000, "spend");
    await setBalance(card, 2_900_000);
    await api.post("/bridge", { dailyAmount: 60_000 }).expect(201);
    let s = await state();
    expect(s).toMatchObject({ mode: "bridge", dailyLimit: 60_000 });
    // The morning was not a shortage, so it cannot give the plan's sum: the parts are of the money as it is now.
    expect(sound(s)).toEqual({ ...ORDINARY, own: -100_000, free: -100_000, share: -10_000, rule: "plan", dailyLimit: 60_000 });
    expect(await row()).toEqual({ limit: 60_000, mode: "bridge_start", parts: s.parts });

    await api.delete("/bridge").expect(200);
    s = await state();
    expect(s.dailyLimit).toBe(100_000);
    expect(sound(s)).toEqual(ORDINARY);
  });
});
