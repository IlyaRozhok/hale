import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { NotificationsService } from "../src/notifications/notifications.service";
import { EXPO_FETCH, type FetchLike } from "../src/notifications/expo-push";
import { PlanService } from "../src/plan/plan.service";
import { Clock } from "../src/time/clock";
import { TodayService } from "../src/today/today.service";

let app: INestApplication;
let ds: DataSource;
let auth: string;
let clock: Clock;
let svc: NotificationsService;
let sent: { to: string; title: string; body: string }[];
/** Per-token answer for the fake Expo endpoint; default ok. */
let answer: Record<string, { status: "ok" } | { status: "error"; details: { error: string } }>;
let httpFail = false;
/** Titles the fake Expo rejects, to simulate one persistently failing notification. */
let failTitles = new Set<string>();

const fakeFetch: FetchLike = async (url, init) => {
  expect(url).toBe("https://exp.host/--/api/v2/push/send");
  if (httpFail) return { ok: false, status: 500, json: async () => ({}) };
  const msgs = JSON.parse(init.body) as { to: string; title: string; body: string }[];
  sent.push(...msgs);
  return { ok: true, status: 200, json: async () => ({ data: msgs.map((m) => (failTitles.has(m.title) ? { status: "error", details: { error: "MessageRateExceeded" } } : (answer[m.to] ?? { status: "ok" }))) }) };
};

const at = (iso: string) => {
  clock.fixed = new Date(iso);
};
const post = (p: string, b: object) => request(app.getHttpServer()).post(p).set("Authorization", auth).send(b);
const device = (name: string, token: string | null) =>
  ds.query(`INSERT INTO devices (name, push_token, token_hash) VALUES ($1,$2,$3)`, [name, token, `h-${name}`]);
const tokens = async () => (await ds.query(`SELECT name, push_token FROM devices ORDER BY id`)) as { name: string; push_token: string | null }[];
const logged = async () => (await ds.query(`SELECT key FROM notifications_log ORDER BY id`)).map((r: { key: string }) => r.key) as string[];

beforeAll(async () => {
  const url = await createMigratedDatabase();
  ds = new DS({ type: "postgres", url });
  await ds.initialize();
  app = await createTestApp(url, { overrides: [[EXPO_FETCH, fakeFetch]] });
  clock = app.get(Clock);
  svc = app.get(NotificationsService);
  const login = await request(app.getHttpServer()).post("/auth/login").send({ password: TEST_PASSWORD, deviceName: "login-device" });
  auth = `Bearer ${login.body.token as string}`;
});
afterAll(async () => {
  await app.close();
  await ds.destroy();
});
beforeEach(async () => {
  await ds.query(
    `TRUNCATE notifications_log, scheduled_payments, transactions, accounts, income_events, expected_incomes, loans, bridge_plans, daily_snapshots
     RESTART IDENTITY CASCADE`,
  );
  await ds.query(`UPDATE devices SET push_token=NULL`);
  await ds.query(`DELETE FROM devices WHERE name <> 'login-device'`);
  await ds.query(`UPDATE settings SET last_sync_at='2026-11-13T07:00:00Z', tracking_start='2026-01-01', lifestyle_cap=100000000, food_floor=45000`);
  const fop = (await ds.query(`INSERT INTO expected_incomes (source, amount, currency, window_start_day, window_end_day) VALUES ('fop',500000,'UAH',15,25) RETURNING id`))[0].id;
  await ds.query(`INSERT INTO income_events (expected_income_id, period, expected_on, status) VALUES ($1,'2026-12','2026-12-20','expected')`, [fop]);
  sent = [];
  answer = {};
  httpFail = false;
  failTitles = new Set();
  at("2026-11-13T08:00:00Z"); // 10:00 Kyiv
});

const taxDue = (due: string) =>
  ds.query(`INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('tax','Единый налог',1234500,'UAH',$1)`, [due]);

describe("POST /devices/push-token", () => {
  it("requires auth and a valid token, then stores it on the calling device", async () => {
    await request(app.getHttpServer()).post("/devices/push-token").send({ token: "ExponentPushToken[a]" }).expect(401);
    await post("/devices/push-token", { token: "nope" }).expect(400);
    await post("/devices/push-token", { token: "ExponentPushToken[abc]" }).expect(204);
    expect((await tokens()).find((d) => d.name === "login-device")?.push_token).toBe("ExponentPushToken[abc]");
  });

  it("moves a token away from another device", async () => {
    await device("old", "ExponentPushToken[abc]");
    await post("/devices/push-token", { token: "ExponentPushToken[abc]" }).expect(204);
    expect((await tokens()).find((d) => d.name === "old")?.push_token).toBeNull();
  });
});

describe("tick", () => {
  it("sends a due tax reminder to every device and logs it once", async () => {
    await taxDue("2026-11-20");
    await device("a", "ExponentPushToken[a]");
    await device("b", "ExponentPushToken[b]");
    await svc.tick();
    expect(sent.map((m) => m.to).sort()).toEqual(["ExponentPushToken[a]", "ExponentPushToken[b]"]);
    expect(sent[0]!.body).toContain("₴12 345");
    expect(await logged()).toEqual(["tax:1:d7"]);
    await svc.tick();
    expect(sent).toHaveLength(2);
  });

  it("logs nothing when there are no devices, so it retries", async () => {
    await taxDue("2026-11-20");
    await svc.tick();
    expect(sent).toEqual([]);
    expect(await logged()).toEqual([]);
    await device("a", "ExponentPushToken[a]");
    await svc.tick();
    expect(await logged()).toEqual(["tax:1:d7"]);
  });

  it("does not mark as sent when every device fails, even on a transport error", async () => {
    await taxDue("2026-11-20");
    await device("a", "ExponentPushToken[a]");
    answer["ExponentPushToken[a]"] = { status: "error", details: { error: "MessageRateExceeded" } };
    await svc.tick();
    expect(await logged()).toEqual([]);
    httpFail = true;
    await svc.tick();
    expect(await logged()).toEqual([]);
    httpFail = false;
    answer = {};
    await svc.tick();
    expect(await logged()).toEqual(["tax:1:d7"]);
  });

  it("counts as sent if one device succeeds, and clears a DeviceNotRegistered token", async () => {
    await taxDue("2026-11-20");
    await device("a", "ExponentPushToken[a]");
    await device("b", "ExponentPushToken[b]");
    answer["ExponentPushToken[a]"] = { status: "error", details: { error: "DeviceNotRegistered" } };
    await svc.tick();
    expect(await logged()).toEqual(["tax:1:d7"]);
    expect((await tokens()).find((d) => d.name === "a")?.push_token).toBeNull();
    expect((await tokens()).find((d) => d.name === "b")?.push_token).toBe("ExponentPushToken[b]");
  });

  it("allows one ordinary notification a day, by log", async () => {
    await device("a", "ExponentPushToken[a]");
    const exp = (await ds.query(`INSERT INTO expected_incomes (source, amount, currency, window_start_day, window_end_day) VALUES ('usdc',270000,'USD',15,25) RETURNING id`))[0].id;
    await ds.query(`INSERT INTO income_events (expected_income_id, period, expected_on, status) VALUES ($1,'2026-11','2026-11-20','expected')`, [exp]);
    at("2026-11-16T08:00:00Z");
    await svc.tick();
    expect(await logged()).toEqual(["usdc:2:2026-11-16"]);
    at("2026-11-16T12:00:00Z");
    await svc.tick();
    expect(sent).toHaveLength(1);
    at("2026-11-17T08:00:00Z");
    await svc.tick();
    expect(await logged()).toEqual(["usdc:2:2026-11-16", "usdc:2:2026-11-17"]);
  });

  it("reports a broken sync once", async () => {
    await device("a", "ExponentPushToken[a]");
    await ds.query(`UPDATE settings SET last_sync_at='2026-11-10T07:00:00Z'`);
    await svc.tick();
    await svc.tick();
    expect(await logged()).toEqual(["sync_broken:2026-11-10"]);
  });
});

async function spendTx(accountId: number, amount: number, type: string, date: string, description = "x"): Promise<number> {
  return (
    await ds.query(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,'{}') RETURNING id`,
      [`tx-${Math.random()}`, accountId, `${date}T10:00:00Z`, date, description, amount, type],
    )
  )[0].id;
}
const usdcEvent = async () => {
  const exp = (await ds.query(`INSERT INTO expected_incomes (source, amount, currency, window_start_day, window_end_day) VALUES ('usdc',270000,'USD',15,25) RETURNING id`))[0].id;
  await ds.query(`INSERT INTO income_events (expected_income_id, period, expected_on, status) VALUES ($1,'2026-11','2026-11-20','expected')`, [exp]);
};

describe("fix round 1", () => {
  it("a failing top candidate does not starve the next one", async () => {
    await device("a", "ExponentPushToken[a]");
    await usdcEvent();
    await ds.query(`INSERT INTO loans (amount, received_on) VALUES (100000, '2026-11-15')`);
    failTitles = new Set(["Денежный план"]);
    at("2026-11-16T08:00:00Z");
    await svc.tick();
    expect(await logged()).toEqual(["usdc:2:2026-11-16"]);
    failTitles = new Set();
    at("2026-11-16T09:00:00Z");
    await svc.tick();
    // the one ordinary notification of the day went out; the loan alert waits for tomorrow
    expect(await logged()).toEqual(["usdc:2:2026-11-16"]);
    at("2026-11-17T08:00:00Z");
    await svc.tick();
    expect(await logged()).toEqual(["usdc:2:2026-11-16", "bad:loan:1"]);
  });

  it("alerts only for loans taken within the last two days", async () => {
    await device("a", "ExponentPushToken[a]");
    await ds.query(`INSERT INTO loans (amount, received_on) VALUES (100000, '2026-11-01')`);
    await svc.tick();
    expect(await logged()).toEqual([]);
    await ds.query(`INSERT INTO loans (amount, received_on) VALUES (100000, '2026-11-12')`);
    await svc.tick();
    expect(await logged()).toEqual(["bad:loan:2"]);
  });

  it("keeps the evening for the over-limit notice even after a morning one", async () => {
    await device("a", "ExponentPushToken[a]");
    await usdcEvent();
    const card = (await ds.query(`INSERT INTO accounts (external_id, kind, currency, balance) VALUES ('acc-n','black','UAH',1000000) RETURNING id`))[0].id;
    at("2026-11-16T08:00:00Z");
    await svc.tick();
    expect(await logged()).toEqual(["usdc:2:2026-11-16"]);
    await spendTx(card, -500_000, "spend", "2026-11-16");
    at("2026-11-16T19:00:00Z"); // 21:00 Kyiv
    await svc.tick();
    expect(await logged()).toEqual(["usdc:2:2026-11-16", "over_limit:2026-11-16"]);
    await svc.tick();
    expect(await logged()).toHaveLength(2);
  });

  it("keeps quiet about an overspend on the day the shortage came on, and speaks up the next day (Б17)", async () => {
    await device("a", "ExponentPushToken[a]");
    await ds.query(`TRUNCATE income_events, expected_incomes RESTART IDENTITY CASCADE`);
    const fop = (await ds.query(`INSERT INTO expected_incomes (source, amount, currency, window_start_day, window_end_day) VALUES ('fop',500000,'UAH',15,25) RETURNING id`))[0].id;
    await ds.query(`INSERT INTO income_events (expected_income_id, period, expected_on, status) VALUES ($1,'2026-11','2026-11-12','expected')`, [fop]);
    const card = (await ds.query(`INSERT INTO accounts (external_id, kind, currency, balance, credit_limit) VALUES ('acc-s','black','UAH',4000000,3000000) RETURNING id`))[0].id;
    const evening = async (day: string) => {
      at(`${day}T19:00:00Z`); // 21:00 Kyiv
      // Several passes: one ordinary notice a pass, and the over-limit one may come after another.
      for (let i = 0; i < 4; i++) await svc.tick();
    };
    at("2026-11-01T08:00:00Z");
    await svc.tick();
    at("2026-11-02T08:00:00Z");
    await svc.tick();
    expect((await app.get(TodayService).getToday()).state).toMatchObject({ mode: "normal", dailyLimit: 100_000 });
    // Spending far over the day's ₴1,000 brings on the shortage the same day.
    await spendTx(card, -1_100_000, "spend", "2026-11-02");
    await ds.query(`UPDATE accounts SET balance=2900000 WHERE id=$1`, [card]);
    await evening("2026-11-02");
    expect((await app.get(TodayService).getToday()).state).toMatchObject({ mode: "bridge", leftToday: -1_000_000, shortageStart: { nextLimit: 45_000 } });
    expect((await logged()).filter((k) => k.startsWith("over_limit:"))).toEqual([]);
    // The next day is judged by its own limit as usual.
    at("2026-11-03T08:00:00Z");
    await svc.tick();
    await spendTx(card, -100_000, "spend", "2026-11-03");
    await ds.query(`UPDATE accounts SET balance=2800000 WHERE id=$1`, [card]);
    await evening("2026-11-03");
    const next = (await app.get(TodayService).getToday()).state;
    expect(next.shortageStart).toBeUndefined();
    expect(next.leftToday).toBeLessThan(0);
    expect((await logged()).filter((k) => k.startsWith("over_limit:"))).toEqual(["over_limit:2026-11-03"]);
  });

  it("a tax payment closed by a matched transaction gets no further reminders", async () => {
    await device("a", "ExponentPushToken[a]");
    const fop = (await ds.query(`INSERT INTO accounts (external_id, kind, currency, balance) VALUES ('acc-fop','fop','UAH',5000000) RETURNING id`))[0].id;
    await taxDue("2026-11-20");
    await svc.tick();
    expect(await logged()).toEqual(["tax:1:d7"]);
    const t = await spendTx(fop, -1_234_500, "tax", "2026-11-19", "ГУ ДПС єдиний податок");
    await app.get(PlanService).onClassified(t);
    expect((await ds.query(`SELECT paid_at IS NOT NULL AS paid, transaction_id FROM scheduled_payments`))[0]).toEqual({ paid: true, transaction_id: t });
    for (const day of ["2026-11-19", "2026-11-20", "2026-11-21"]) {
      at(`${day}T08:00:00Z`);
      await svc.tick();
    }
    expect((await logged()).filter((k) => k.startsWith("tax:"))).toEqual(["tax:1:d7"]);
  });
});
