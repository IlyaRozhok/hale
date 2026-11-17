import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { Clock } from "../src/time/clock";
import { TodayService } from "../src/today/today.service";
import { ReclassifyService } from "../src/transactions/reclassify.service";
import { PlanService } from "../src/plan/plan.service";
import { LimitService } from "../src/today/limit.service";

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
  del: (p: string) => request(http()).delete(p).set("Authorization", auth),
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
              scheduled_payments, recurring_payments, manual_balances, loans, bridge_plans, daily_snapshots, goals, cash_cards
     RESTART IDENTITY CASCADE`,
  );
  await ds.query(`UPDATE settings SET lifestyle_cap=100000000, food_floor=45000, tax_rate_bp=600, esv_quarter=0, cash_start=NULL, cash_started_at=NULL, tracking_start='2026-01-01'`);
  at("2026-11-10T10:00:00Z");
});

async function card(balance = 10_000_000): Promise<number> {
  seq++;
  return (await ds.query(`INSERT INTO accounts (external_id, kind, currency, balance) VALUES ($1,'black','UAH',$2) RETURNING id`, [`acc-${seq}`, balance]))[0].id;
}
async function bankTx(
  accountId: number,
  amount: number,
  type: string,
  date: string,
  over: { usdcChecked?: boolean; description?: string; time?: string; name?: string; mcc?: number } = {},
): Promise<number> {
  seq++;
  return (
    await ds.query(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, type_source, usdc_checked, counter_name, mcc, raw)
       VALUES ($1,$2,$3,$4,$8,$5,$5,$6,'rule',$7,$9,$10,'{}') RETURNING id`,
      [`tx-${seq}`, accountId, `${date}T${over.time ?? "10:00:00"}Z`, date, amount, type, over.usdcChecked ?? false, over.description ?? "Банкомат", over.name ?? null, over.mcc ?? null],
    )
  )[0].id;
}
const wallet = async () => (await api.get("/cash").expect(200)).body;
/** What the owner sees: the 15-minute job has fixed the day (a read writes nothing, task Б3), then the app read it. */
const today = async () => {
  await app.get(TodayService).ensureSnapshot();
  return (await api.get("/today").expect(200)).body;
};
const start = (amount = 500_000, date?: string) => api.post("/cash/start", date ? { amount, date } : { amount });
const op = (body: object) => api.post("/cash/operations", body);
const row = async (sql: string, args: unknown[] = []) => (await ds.query(sql, args))[0];

describe("starting the wallet", () => {
  it("is not started at first", async () => {
    expect(await wallet()).toEqual({ started: false, start: null, balance: 0 });
  });

  it("starts with what is in the pocket, today, once", async () => {
    await start(500_000).expect(201);
    expect(await wallet()).toEqual({ started: true, start: "2026-11-10", balance: 500_000 });
    await start(1).expect(409);
  });

  it("validates", async () => {
    await start(-1).expect(400);
    await api.post("/cash/start", { amount: 1, date: "10.11.2026" }).expect(400);
    await op({ kind: "spend", amount: 100, category: "cafe" }).expect(409);
  });

  it("counts as own money, and gives the day a fresh limit", async () => {
    await card(1_000_000);
    const before = await today();
    await start(600_000).expect(201);
    const after = await today();
    expect(after.accounts.cash).toBe(600_000);
    expect(after.accounts.own).toBe(before.accounts.own + 600_000);
    expect(after.state.dailyLimit).toBeGreaterThan(before.state.dailyLimit);
  });

  it("is left out of the monobank sync", async () => {
    await start(1).expect(201);
    expect(await row(`SELECT kind, external_id FROM accounts WHERE kind='cash'`)).toEqual({ kind: "cash", external_id: "manual:cash" });
  });
});

describe("cash withdrawals", () => {
  it("before the start stay spending; from the start they go to the wallet and leave the limit alone", async () => {
    const c = await card();
    await bankTx(c, -100_000, "cash_out", "2026-11-09");
    await start(0, "2026-11-10").expect(201);
    await bankTx(c, -200_000, "cash_out", "2026-11-10");
    expect((await wallet()).balance).toBe(200_000);
    expect((await today()).state.leftToday).toBe((await today()).state.dailyLimit);
    const days = (await api.get("/today/calendar?month=2026-11").expect(200)).body.days as { date: string; spent: number }[];
    expect(days.find((d) => d.date === "2026-11-09")!.spent).toBe(100_000);
    expect(days.find((d) => d.date === "2026-11-10")!.spent).toBe(0);
  });

  // Б39: the wallet starts at a moment, not a day. Kyiv is UTC+2 in November: 10:00 Kyiv is 08:00Z.
  describe("on the day the wallet starts (Б39)", () => {
    const spentOn = async (date: string) =>
      ((await api.get("/today/calendar?month=2026-11").expect(200)).body.days as { date: string; spent: number }[]).find((d) => d.date === date)!.spent;

    it("a withdrawal at 10:00 and a start at 15:00 with ₴1,000: the wallet is ₴1,000, the day spent nothing", async () => {
      const c = await card();
      await bankTx(c, -100_000, "cash_out", "2026-11-10", { time: "08:00:00" });
      at("2026-11-10T13:00:00Z");
      await start(100_000).expect(201);
      expect(await wallet()).toEqual({ started: true, start: "2026-11-10", balance: 100_000 });
      expect(await spentOn("2026-11-10")).toBe(0);
      const t = await today();
      expect(t.state.leftToday).toBe(t.state.dailyLimit);
      expect(t.accounts.cash).toBe(100_000);
      // Neither spending nor a wallet change: not in «Траты».
      expect((await api.get("/transactions?group=spend").expect(200)).body.items).toEqual([]);
    });

    it("a start at 09:00 and a withdrawal at 10:00: the withdrawal adds to the wallet", async () => {
      const c = await card();
      at("2026-11-10T07:00:00Z");
      await start(100_000).expect(201);
      at("2026-11-10T08:00:00Z");
      await bankTx(c, -100_000, "cash_out", "2026-11-10", { time: "08:00:00" });
      expect((await wallet()).balance).toBe(200_000);
      expect(await spentOn("2026-11-10")).toBe(0);
    });

    it("a start dated today, given its date, starts now too", async () => {
      const c = await card();
      await bankTx(c, -100_000, "cash_out", "2026-11-10", { time: "08:00:00" });
      at("2026-11-10T13:00:00Z");
      await start(100_000, "2026-11-10").expect(201);
      expect((await wallet()).balance).toBe(100_000);
    });

    it("a start dated an earlier day takes the whole of that day, as before", async () => {
      const c = await card();
      await bankTx(c, -100_000, "cash_out", "2026-11-09", { time: "20:00:00" });
      at("2026-11-10T13:00:00Z");
      await start(100_000, "2026-11-09").expect(201);
      expect((await wallet()).balance).toBe(200_000);
      expect(await spentOn("2026-11-09")).toBe(0);
    });

    it("a transfer to the owner's card at another bank before the start is not asked about and does not reach the wallet", async () => {
      const c = await card();
      const before = await bankTx(c, -300_000, "own_transfer", "2026-11-10", { description: "545708****4563", time: "08:00:00" });
      at("2026-11-10T13:00:00Z");
      await start(100_000).expect(201);
      const questions = async () => ((await today()).questions as { id: string; kind: string }[]).filter((q) => q.kind === "cash_card");
      expect(await questions()).toEqual([]);
      await api.post(`/cash/cards/${before}`, { answer: "yes" }).expect(422);
      at("2026-11-10T14:00:00Z");
      const after = await bankTx(c, -200_000, "own_transfer", "2026-11-10", { description: "545708****4563", time: "14:00:00" });
      expect((await questions()).map((q) => q.id)).toEqual([`cash_card:${after}`]);
      await api.post(`/cash/cards/${after}`, { answer: "yes" }).expect(201);
      // The card is now «yes», and still only the transfer after the start fills the wallet.
      expect((await wallet()).balance).toBe(300_000);
    });
  });
});

describe("the operations list", () => {
  it("shows a withdrawal into the wallet under everything, not under spending", async () => {
    const c = await card();
    const before = await bankTx(c, -100_000, "cash_out", "2026-11-09");
    await start(0, "2026-11-10").expect(201);
    const after = await bankTx(c, -200_000, "cash_out", "2026-11-10");
    const spend = (await api.get("/transactions?group=spend").expect(200)).body as { items: { id: number }[]; dayTotals: Record<string, number> };
    expect(spend.items.map((i) => i.id)).toEqual([before]);
    expect(spend.dayTotals).toEqual({ "2026-11-09": -100_000 });
    const all = (await api.get("/transactions?group=all").expect(200)).body as { items: { id: number }[] };
    expect(all.items.map((i) => i.id)).toContain(after);
  });
});

describe("operations entered by hand", () => {
  beforeEach(async () => {
    await start(500_000).expect(201);
  });

  it("a cash purchase spends the day's limit and comes out of the wallet", async () => {
    const before = (await today()).state.leftToday;
    const created = (await op({ kind: "spend", amount: 30_000, category: "cafe", note: "Кофе" }).expect(201)).body;
    expect(created).toMatchObject({ amount: -30_000, type: "spend", category: "cafe", description: "Кофе", manual: true, localDate: "2026-11-10" });
    expect((await today()).state.leftToday).toBe(before - 30_000);
    expect((await wallet()).balance).toBe(470_000);
    const items = (await api.get("/transactions").expect(200)).body.items as { id: number; manual: boolean; accountKind: string }[];
    expect(items.find((i) => i.id === created.id)).toMatchObject({ manual: true, accountKind: "cash" });
  });

  it("an earlier day's purchase counts on that day", async () => {
    await op({ kind: "spend", amount: 40_000, category: "groceries", date: "2026-11-08" }).expect(201);
    const days = (await api.get("/today/calendar?month=2026-11").expect(200)).body.days as { date: string; spent: number }[];
    expect(days.find((d) => d.date === "2026-11-08")!.spent).toBe(40_000);
  });

  it("cash received and cash handed to one's own other money leave the limit alone", async () => {
    const before = (await today()).state.leftToday;
    await op({ kind: "received", amount: 100_000, note: "Вернули долг" }).expect(201);
    await op({ kind: "own_out", amount: 50_000, note: "Купил USDC" }).expect(201);
    expect((await today()).state.leftToday).toBe(before);
    expect((await wallet()).balance).toBe(550_000);
  });

  it("validates", async () => {
    await op({ kind: "spend", amount: 0, category: "cafe" }).expect(400);
    await op({ kind: "spend", amount: 100 }).expect(400);
    await op({ kind: "nope", amount: 100 }).expect(400);
    await op({ kind: "spend", amount: 100, category: "cafe", date: "2026-11-11" }).expect(422);
  });

  it("can be changed and deleted; a bank row cannot be deleted", async () => {
    const { id } = (await op({ kind: "spend", amount: 30_000, category: "cafe" }).expect(201)).body as { id: number };
    const changed = (await api.patch(`/cash/operations/${id}`, { amount: 45_000, category: "groceries", date: "2026-11-09", note: "Рынок" }).expect(200)).body;
    expect(changed).toMatchObject({ amount: -45_000, category: "groceries", localDate: "2026-11-09", description: "Рынок" });
    await api.patch(`/cash/operations/${id}`, { kind: "received" }).expect(200);
    expect((await wallet()).balance).toBe(545_000);
    await api.del(`/cash/operations/${id}`).expect(200);
    expect((await wallet()).balance).toBe(500_000);
    await api.del(`/cash/operations/${id}`).expect(404);
    const bank = await bankTx(await card(), -1_000, "spend", "2026-11-10");
    await api.del(`/cash/operations/${bank}`).expect(409);
    await api.patch(`/cash/operations/${bank}`, { amount: 1 }).expect(409);
  });

  it("deleting one that helped close a tax opens the tax again; the other payment stays linked (Б26)", async () => {
    const tax = (
      await row(`INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, tax_quarter) VALUES ('tax','ЄСВ',800000,'UAH','2026-11-20','2026-Q3') RETURNING id`)
    ).id as number;
    const bank = await bankTx(await card(), -500_000, "tax", "2026-11-09");
    await app.get(PlanService).onClassified(bank, "tax");
    const { id } = (await op({ kind: "spend", amount: 300_000, category: "cafe" }).expect(201)).body as { id: number };
    // A wallet row retyped to a tax before the general editor refused wallet rows (Б22, review round 1).
    await api.patch(`/transactions/${id}`, { type: "tax" }).expect(422);
    await ds.query(`UPDATE transactions SET type='tax', category='tax', type_source='owner' WHERE id=$1`, [id]);
    await app.get(PlanService).onClassified(id, "tax");
    expect((await row(`SELECT paid_at FROM scheduled_payments WHERE id=$1`, [tax])).paid_at).not.toBeNull();

    await api.del(`/cash/operations/${id}`).expect(200);
    expect((await row(`SELECT paid_at FROM scheduled_payments WHERE id=$1`, [tax])).paid_at).toBeNull();
    expect(await ds.query(`SELECT transaction_id FROM payment_links WHERE payment_id=$1`, [tax])).toEqual([{ transaction_id: bank }]);
  });

  it("is not retyped by the classifier and asks nothing about Binance", async () => {
    const { id } = (await op({ kind: "received", amount: 200_000 }).expect(201)).body as { id: number };
    await app.get(ReclassifyService).reclassifyPending();
    expect(await row(`SELECT type, type_source, usdc_checked, needs_label FROM transactions WHERE id=$1`, [id])).toEqual({
      type: "person_in", type_source: "owner", usdc_checked: true, needs_label: false,
    });
  });
});

describe("counting the pocket", () => {
  beforeEach(async () => {
    await start(500_000).expect(201);
  });

  it("less than recorded: the difference is spent today as not recorded", async () => {
    const before = (await today()).state.leftToday;
    expect((await api.post("/cash/count", { amount: 420_000 }).expect(201)).body.balance).toBe(420_000);
    expect((await today()).state.leftToday).toBe(before - 80_000);
    expect(await row(`SELECT description, type, amount::int AS amount FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.kind='cash' ORDER BY t.id DESC LIMIT 1`)).toEqual({
      description: "Не записано", type: "spend", amount: -80_000,
    });
  });

  it("more than recorded: the balance is corrected, the limit is not", async () => {
    const before = (await today()).state.leftToday;
    expect((await api.post("/cash/count", { amount: 530_000 }).expect(201)).body.balance).toBe(530_000);
    expect((await today()).state.leftToday).toBe(before);
    expect((await row(`SELECT description, type FROM transactions ORDER BY id DESC LIMIT 1`))).toEqual({ description: "Сверка: больше, чем записано", type: "own_transfer" });
  });

  it("the same amount adds nothing", async () => {
    await api.post("/cash/count", { amount: 500_000 }).expect(201);
    expect((await row(`SELECT count(*)::int AS n FROM transactions`)).n).toBe(1);
  });
});

describe("a correction of the wallet keeps its sign when changed", () => {
  const startRow = async () => (await row(`SELECT id FROM transactions WHERE description='Начальный остаток'`)).id as number;
  const surplusRow = async () => {
    await api.post("/cash/count", { amount: 795_000 }).expect(201);
    return (await row(`SELECT id FROM transactions WHERE description='Сверка: больше, чем записано'`)).id as number;
  };

  beforeEach(async () => {
    await start(500_000).expect(201);
  });

  it("the opening balance: a new note or date leaves the amount and the wallet as they were", async () => {
    const id = await startRow();
    const changed = (await api.patch(`/cash/operations/${id}`, { note: "Что было в кармане", date: "2026-11-08" }).expect(200)).body;
    expect(changed).toMatchObject({ amount: 500_000, type: "own_transfer", category: "own", description: "Что было в кармане", localDate: "2026-11-08" });
    expect((await wallet()).balance).toBe(500_000);
  });

  it("a count surplus: a new note or date leaves the amount and the wallet as they were", async () => {
    const id = await surplusRow();
    expect((await wallet()).balance).toBe(795_000);
    const changed = (await api.patch(`/cash/operations/${id}`, { note: "Нашёл в куртке", date: "2026-11-09" }).expect(200)).body;
    expect(changed).toMatchObject({ amount: 295_000, type: "own_transfer", description: "Нашёл в куртке", localDate: "2026-11-09" });
    expect((await wallet()).balance).toBe(795_000);
    // An emptied note keeps what the row was called.
    expect((await api.patch(`/cash/operations/${id}`, { note: "" }).expect(200)).body.description).toBe("Нашёл в куртке");
  });

  it("a new amount stays positive", async () => {
    const id = await surplusRow();
    expect((await api.patch(`/cash/operations/${id}`, { amount: 100_000 }).expect(200)).body.amount).toBe(100_000);
    expect((await wallet()).balance).toBe(600_000);
    expect((await api.patch(`/cash/operations/${await startRow()}`, { amount: 400_000 }).expect(200)).body.amount).toBe(400_000);
    expect((await wallet()).balance).toBe(500_000);
  });

  it("its kind cannot be changed: it is a correction, not an operation", async () => {
    const id = await surplusRow();
    for (const kind of ["own_out", "spend", "received"]) {
      await api.patch(`/cash/operations/${id}`, { kind, category: "cafe", note: "x" }).expect(422);
    }
    await api.patch(`/cash/operations/${id}`, { kind: "exchange", usdc: 100, amount: 100 }).expect(422);
    await api.patch(`/cash/operations/${id}`, { usdc: 100 }).expect(422);
    expect(await row(`SELECT type, amount::int AS amount, description FROM transactions WHERE id=$1`, [id])).toEqual({
      type: "own_transfer", amount: 295_000, description: "Сверка: больше, чем записано",
    });
    expect((await wallet()).balance).toBe(795_000);
    // It can still be deleted.
    await api.del(`/cash/operations/${id}`).expect(200);
    expect((await wallet()).balance).toBe(500_000);
  });

  it("«Отдал в свои» stays negative when its note changes, and can still change its kind", async () => {
    const { id } = (await op({ kind: "own_out", amount: 50_000 }).expect(201)).body as { id: number };
    expect((await api.patch(`/cash/operations/${id}`, { note: "Купил USDC" }).expect(200)).body.amount).toBe(-50_000);
    expect((await api.patch(`/cash/operations/${id}`, { kind: "own_out", amount: 60_000, note: "Купил USDC" }).expect(200)).body.amount).toBe(-60_000);
    expect((await wallet()).balance).toBe(440_000);
    expect((await api.patch(`/cash/operations/${id}`, { kind: "received" }).expect(200)).body).toMatchObject({ amount: 60_000, type: "person_in" });
  });

  it("an exchange changed by note keeps its sign and its dollars", async () => {
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-10T09:00:00Z', 41.5)`);
    const { id } = (await op({ kind: "exchange", usdc: 100_000, amount: 4_100_000 }).expect(201)).body as { id: number };
    const changed = (await api.patch(`/cash/operations/${id}`, { kind: "exchange", usdc: 100_000, amount: 4_100_000, note: "Обменник" }).expect(200)).body;
    expect(changed).toMatchObject({ amount: 4_100_000, exchange: { usdc: 100_000 } });
    expect((await api.patch(`/cash/operations/${id}`, { note: "Обменник на Подоле" }).expect(200)).body.amount).toBe(4_100_000);
    expect((await wallet()).balance).toBe(4_600_000);
  });
});

describe("cash paid in at a terminal", () => {
  it("before the start nothing is asked; from the start the owner says where the cash came from", async () => {
    const c = await card();
    await bankTx(c, 150_000, "cash_in", "2026-11-09");
    await start(500_000, "2026-11-10").expect(201);
    const deposit = await bankTx(c, 200_000, "cash_in", "2026-11-10");
    const questions = (await today()).questions as { id: string; kind: string; text: string }[];
    expect(questions.filter((q) => q.kind === "cash_source")).toEqual([
      { id: `cash_source:${deposit}:0`, kind: "cash_source", text: "Внесено ₴2,000 (10.11). Откуда наличные?" },
    ]);
    await api.post(`/cash/deposits/${deposit}/from-wallet`).expect(201);
    expect((await wallet()).balance).toBe(300_000);
    expect(await row(`SELECT type, from_wallet FROM transactions WHERE id=$1`, [deposit])).toEqual({ type: "own_transfer", from_wallet: true });
    expect(((await today()).questions as { kind: string }[]).filter((q) => q.kind === "cash_source")).toEqual([]);
  });

  it("offers Binance when a USDC income was received, and asks only this question about the row", async () => {
    const c = await card();
    await start(0).expect(201);
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-10T09:00:00Z', 40)`);
    await ds.query(`INSERT INTO manual_balances (name, amount, currency, counts_as_own) VALUES ('Binance', 500000, 'USD', true)`);
    const exp = (await ds.query(`INSERT INTO expected_incomes (source, amount, currency, window_start_day, window_end_day) VALUES ('usdc', 500000, 'USD', 1, 5) RETURNING id`))[0].id;
    const ev = (await ds.query(`INSERT INTO income_events (expected_income_id, period, expected_on, status, received_at) VALUES ($1,'2026-11','2026-11-03','received','2026-11-03T10:00:00Z') RETURNING id`, [exp]))[0].id;
    const deposit = await bankTx(c, 400_000, "cash_in", "2026-11-10");
    const questions = (await today()).questions as { id: string; kind: string }[];
    expect(questions.map((q) => q.id)).toEqual([`cash_source:${deposit}:${ev}`]);
  });

  it("'other' leaves the wallet alone and stops the question", async () => {
    const c = await card();
    await start(500_000).expect(201);
    const deposit = await bankTx(c, 200_000, "cash_in", "2026-11-10");
    await api.post(`/plan/transactions/${deposit}/not-usdc`).expect(201);
    expect((await wallet()).balance).toBe(500_000);
    expect(((await today()).questions as { kind: string }[]).filter((q) => q.kind === "cash_source")).toEqual([]);
  });

  it("only a cash deposit can come from the wallet", async () => {
    const c = await card();
    await start(0).expect(201);
    const spend = await bankTx(c, -100, "spend", "2026-11-10");
    await api.post(`/cash/deposits/${spend}/from-wallet`).expect(422);
    await api.post(`/cash/deposits/99999/from-wallet`).expect(404);
  });
});

describe("a planned payment paid in cash", () => {
  const plan = async (amount: number, over: { currency?: string; due?: string } = {}) =>
    (await ds.query(`INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation','Квартплата',$1,$2,$3) RETURNING id`, [
      amount, over.currency ?? "UAH", over.due ?? "2026-11-06",
    ]))[0].id as number;

  it("closes the payment, takes it from the wallet and leaves the limit alone", async () => {
    // The payment is in the day's limit from the start: starting the wallet fixes the day at once (task Б4).
    const id = await plan(1_700_000);
    await start(2_000_000).expect(201);
    const before = (await today()).state.leftToday;
    expect((await api.post(`/cash/payments/${id}`).expect(201)).body.balance).toBe(300_000);
    expect((await today()).state.leftToday).toBe(before);
    const p = await row(`SELECT paid_at IS NOT NULL AS paid, transaction_id FROM scheduled_payments WHERE id=$1`, [id]);
    expect(p.paid).toBe(true);
    expect(await row(`SELECT description, type, amount::int AS amount FROM transactions WHERE id=$1`, [p.transaction_id])).toEqual({
      description: "Квартплата", type: "obligation", amount: -1_700_000,
    });
    await api.post(`/cash/payments/${id}`).expect(409);
  });

  it("is refused when the wallet has less than the payment, or is not started, or in another currency", async () => {
    const id = await plan(1_700_000);
    await api.post(`/cash/payments/${id}`).expect(409);
    await start(1_000_000).expect(201);
    await api.post(`/cash/payments/${id}`).expect(422);
    await api.post(`/cash/payments/${await plan(100, { currency: "USD" })}`).expect(422);
    await api.post(`/cash/payments/99999`).expect(404);
    expect((await wallet()).balance).toBe(1_000_000);
  });

  it("deleting the cash row opens the payment again; it cannot be changed", async () => {
    await start(2_000_000).expect(201);
    const id = await plan(1_700_000);
    await api.post(`/cash/payments/${id}`).expect(201);
    const tx = (await row(`SELECT transaction_id FROM scheduled_payments WHERE id=$1`, [id])).transaction_id as number;
    await api.patch(`/cash/operations/${tx}`, { amount: 1 }).expect(409);
    await api.del(`/cash/operations/${tx}`).expect(200);
    expect(await row(`SELECT paid_at, transaction_id FROM scheduled_payments WHERE id=$1`, [id])).toEqual({ paid_at: null, transaction_id: null });
    expect((await wallet()).balance).toBe(2_000_000);
  });
});

describe("a planned payment paid with chosen operations", () => {
  const plan = async (amount: number, due = "2026-11-06") =>
    (await ds.query(`INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation','Квартплата',$1,'UAH',$2) RETURNING id`, [
      amount, due,
    ]))[0].id as number;
  const candidates = async (id: number) =>
    ((await api.get(`/cash/payments/${id}/candidates`).expect(200)).body as { id: number }[]).map((t) => t.id);
  const spentOn = async (date: string) =>
    ((await api.get("/today/calendar?month=2026-11").expect(200)).body.days as { date: string; spent: number }[]).find((d) => d.date === date)!.spent;

  it("offers outgoing withdrawals and transfers from a week before the due date, none larger than the payment", async () => {
    const c = await card();
    const id = await plan(1_700_000);
    const silpo = await bankTx(c, -310_500, "cash_out", "2026-11-08", { description: "Видача готівки Сільпо" });
    const ownCard = await bankTx(c, -1_560_000, "own_transfer", "2026-11-08", { description: "545708****4563", time: "11:00:00" });
    const person = await bankTx(c, -50_000, "person_transfer", "2026-10-30");
    const due = await bankTx(c, -60_000, "obligation", "2026-11-07");
    await bankTx(c, -50_000, "person_transfer", "2026-10-29"); // too early
    await bankTx(c, -10_000, "spend", "2026-11-08", { description: "Shop" }); // a purchase
    await bankTx(c, -2_000_000, "cash_out", "2026-11-08"); // larger than the payment
    await bankTx(c, 50_000, "person_in", "2026-11-08"); // incoming
    const other = await plan(60_000, "2026-11-07");
    await ds.query(`UPDATE scheduled_payments SET paid_at=now(), transaction_id=$1 WHERE id=$2`, [due, other]);
    expect(await candidates(id)).toEqual([ownCard, silpo, person]);
    await api.get(`/cash/payments/99999/candidates`).expect(404);
  });

  it("does not offer a transfer between the owner's own accounts here; a transfer to another bank stays", async () => {
    const c = await card();
    const other = await card();
    await ds.query(`UPDATE accounts SET iban='UA903052990000026007000000001' WHERE id=$1`, [other]);
    const id = await plan(1_700_000);
    // Both legs at monobank: the other leg arrives on another account within the window.
    const paired = await bankTx(c, -19_300, "own_transfer", "2026-11-08", { description: "Переказ на картку", time: "09:00:00" });
    await bankTx(other, 19_300, "own_transfer", "2026-11-08", { time: "09:01:00" });
    // The counterparty IBAN is one of the owner's own accounts.
    const byIban = await bankTx(c, -2_700, "own_transfer", "2026-11-08", { description: "Переказ на картку", time: "09:30:00" });
    await ds.query(`UPDATE transactions SET counter_iban='UA903052990000026007000000001' WHERE id=$1`, [byIban]);
    // To the owner's card at another bank: no other leg, a foreign IBAN.
    const otherBank = await bankTx(c, -1_560_000, "own_transfer", "2026-11-08", { description: "545708****4563", time: "11:00:00" });
    await ds.query(`UPDATE transactions SET counter_iban='UA213223130000026007233566001' WHERE id=$1`, [otherBank]);
    const silpo = await bankTx(c, -310_500, "cash_out", "2026-11-07", { description: "Видача готівки Сільпо" });
    const person = await bankTx(c, -50_000, "person_transfer", "2026-10-30");
    expect(await candidates(id)).toEqual([otherBank, silpo, person]);
    expect(await candidates(id)).not.toContain(paired);
    expect(await candidates(id)).not.toContain(byIban);
  });

  it("closes the payment; the rows become this payment and stop spending the limit", async () => {
    const c = await card();
    const id = await plan(1_700_000);
    const silpo = await bankTx(c, -310_500, "cash_out", "2026-11-08", { description: "Видача готівки Сільпо" });
    const ownCard = await bankTx(c, -1_560_000, "own_transfer", "2026-11-08", { description: "545708****4563", time: "11:00:00" });
    expect(await spentOn("2026-11-08")).toBe(310_500);
    await api.post(`/cash/payments/${id}/links`, { transactionIds: [silpo, ownCard] }).expect(201);
    expect(await spentOn("2026-11-08")).toBe(0);
    expect(await row(`SELECT paid_at IS NOT NULL AS paid FROM scheduled_payments WHERE id=$1`, [id])).toEqual({ paid: true });
    expect(await ds.query(`SELECT type, category, type_source FROM transactions WHERE id = ANY($1) ORDER BY id`, [[silpo, ownCard]])).toEqual([
      { type: "obligation", category: "transfer", type_source: "owner" },
      { type: "obligation", category: "transfer", type_source: "owner" },
    ]);
    expect((await ds.query(`SELECT transaction_id FROM payment_links WHERE payment_id=$1 ORDER BY transaction_id`, [id])).map((r: { transaction_id: number }) => r.transaction_id)).toEqual([silpo, ownCard]);
    // Taken rows are not offered to another payment, and the paid one cannot be paid again.
    expect(await candidates(await plan(1_700_000, "2026-11-08"))).toEqual([]);
    await api.post(`/cash/payments/${id}/links`, { transactionIds: [silpo] }).expect(409);
    // The classifier never takes them back.
    await app.get(ReclassifyService).reclassifyPending();
    expect((await row(`SELECT type FROM transactions WHERE id=$1`, [silpo])).type).toBe("obligation");
  });

  it("offers a withdrawal that an old rule turned into a purchase", async () => {
    const c = await card();
    const id = await plan(1_700_000);
    const silpo = await bankTx(c, -310_500, "spend", "2026-11-08", { description: "Видача готівки Сільпо" });
    await bankTx(c, -10_000, "spend", "2026-11-08", { description: "Сільпо" });
    expect(await candidates(id)).toEqual([silpo]);
  });

  it("refuses rows that are not offered, and an empty choice", async () => {
    const c = await card();
    const id = await plan(1_700_000);
    const buy = await bankTx(c, -10_000, "spend", "2026-11-08", { description: "Shop" });
    await api.post(`/cash/payments/${id}/links`, { transactionIds: [buy] }).expect(422);
    await api.post(`/cash/payments/${id}/links`, { transactionIds: [] }).expect(400);
    await api.post(`/cash/payments/99999/links`, { transactionIds: [buy] }).expect(404);
    expect(await row(`SELECT paid_at FROM scheduled_payments WHERE id=$1`, [id])).toEqual({ paid_at: null });
  });

  it("a withdrawal after the wallet start passes the wallet by: the cash went straight to the payment", async () => {
    const c = await card();
    await start(100_000, "2026-11-01").expect(201);
    const id = await plan(1_700_000);
    const atm = await bankTx(c, -1_700_000, "cash_out", "2026-11-05");
    expect((await wallet()).balance).toBe(1_800_000);
    await api.post(`/cash/payments/${id}/links`, { transactionIds: [atm] }).expect(201);
    expect((await wallet()).balance).toBe(100_000);
  });

  it("apply to similar leaves rows that pay a payment alone", async () => {
    const c = await card();
    const id = await plan(1_700_000);
    const paid = await bankTx(c, -1_560_000, "own_transfer", "2026-11-08", { description: "545708****4563" });
    await api.post(`/cash/payments/${id}/links`, { transactionIds: [paid] }).expect(201);
    const later = await bankTx(c, -500_000, "obligation", "2026-11-09", { description: "545708****4563" });
    expect((await api.get(`/transactions/${later}/similar?type=own_transfer`).expect(200)).body).toEqual({ count: 1 });
    await api.patch(`/transactions/${later}`, { type: "own_transfer", applyToSimilar: true }).expect(200);
    expect((await row(`SELECT type FROM transactions WHERE id=$1`, [paid])).type).toBe("obligation");
    expect((await ds.query(`SELECT 1 FROM payment_links`)).length).toBe(1);
  });

  it("operations that paid a payment carry its name; others none", async () => {
    const c = await card();
    await start(2_000_000, "2026-11-01").expect(201);
    const id = await plan(1_700_000);
    const silpo = await bankTx(c, -310_500, "cash_out", "2026-11-08", { description: "Видача готівки Сільпо" });
    const other = await bankTx(c, -10_000, "spend", "2026-11-08", { description: "Shop" });
    await api.post(`/cash/payments/${id}/links`, { transactionIds: [silpo] }).expect(201);
    const wallet = await plan(100_000, "2026-11-09");
    await api.post(`/cash/payments/${wallet}`).expect(201);
    const items = (await api.get("/transactions?limit=50").expect(200)).body.items as { id: number; description: string; paymentName: string | null }[];
    expect(items.find((i) => i.id === silpo)!.paymentName).toBe("Квартплата");
    expect(items.find((i) => i.id === other)!.paymentName).toBeNull();
    expect(items.find((i) => i.description === "Квартплата" && i.id !== silpo)!.paymentName).toBe("Квартплата");
  });

  describe("paid in parts (Б9)", () => {
    const paidAt = async (id: number) => (await row(`SELECT paid_at FROM scheduled_payments WHERE id=$1`, [id])).paid_at as Date | null;
    const dailyLimit = async () => (await today()).state.dailyLimit as number;

    it("stays open and fully reserved until the operations add up to it; the next one closes it", async () => {
      const c = await card();
      const id = await plan(1_700_000);
      const first = await bankTx(c, -1_000_000, "cash_out", "2026-11-07");
      const second = await bankTx(c, -700_000, "person_transfer", "2026-11-08", { time: "12:00:00" });
      const before = await dailyLimit();

      expect((await api.post(`/cash/payments/${id}/links`, { transactionIds: [first] }).expect(201)).body).toEqual({
        linked: 1, closed: false, remaining: 700_000,
      });
      expect(await paidAt(id)).toBeNull();
      expect(await dailyLimit()).toBe(before);
      // The linked row is not offered again; the rest still is.
      expect(await candidates(id)).toEqual([second]);
      expect((await today()).upcoming).toMatchObject([{ id: String(id), amount: 1_700_000, paid: 1_000_000 }]);

      expect((await api.post(`/cash/payments/${id}/links`, { transactionIds: [second] }).expect(201)).body).toEqual({
        linked: 1, closed: true, remaining: 0,
      });
      expect(await paidAt(id)).toEqual(new Date("2026-11-08T12:00:00Z"));
      expect(await dailyLimit()).toBeGreaterThan(before);
      expect((await ds.query(`SELECT transaction_id FROM payment_links WHERE payment_id=$1 ORDER BY transaction_id`, [id])).map((r: { transaction_id: number }) => r.transaction_id)).toEqual([first, second]);
      await api.post(`/cash/payments/${id}/links`, { transactionIds: [second] }).expect(409);
    });

    it("one operation up to ₴20 short closes the payment; one far below does not", async () => {
      const c = await card();
      const near = await plan(1_700_000);
      const far = await plan(1_700_000);
      const almost = await bankTx(c, -1_698_000, "person_transfer", "2026-11-08");
      const little = await bankTx(c, -310_500, "cash_out", "2026-11-08");
      expect((await api.post(`/cash/payments/${near}/links`, { transactionIds: [almost] }).expect(201)).body).toMatchObject({ closed: true, remaining: 0 });
      expect(await paidAt(near)).not.toBeNull();
      expect((await api.post(`/cash/payments/${far}/links`, { transactionIds: [little] }).expect(201)).body).toMatchObject({ closed: false, remaining: 1_389_500 });
      expect(await paidAt(far)).toBeNull();
    });

    it("a partly paid payment can be closed by hand with «Оплачено»; then it frees its money", async () => {
      const c = await card();
      const id = await plan(1_700_000);
      const part = await bankTx(c, -310_500, "cash_out", "2026-11-08");
      await api.post(`/cash/payments/${id}/links`, { transactionIds: [part] }).expect(201);
      const before = await dailyLimit();
      await api.post(`/plan/payments/${id}/mark-paid`).expect(201);
      expect(await paidAt(id)).not.toBeNull();
      expect(await dailyLimit()).toBeGreaterThan(before);
      expect((await today()).upcoming).toEqual([]);
    });

    it("a partly paid payment is not paid in full from the wallet on top of its parts", async () => {
      const c = await card();
      await start(2_000_000, "2026-11-01").expect(201);
      const id = await plan(1_700_000);
      const part = await bankTx(c, -310_500, "person_transfer", "2026-11-08");
      await api.post(`/cash/payments/${id}/links`, { transactionIds: [part] }).expect(201);
      await api.post(`/cash/payments/${id}`).expect(409);
      expect((await wallet()).balance).toBe(2_000_000);
      expect(await paidAt(id)).toBeNull();
    });
  });

  describe("an operation retyped away from a payment it closed (Б26)", () => {
    const paidAt = async (id: number) => (await row(`SELECT paid_at FROM scheduled_payments WHERE id=$1`, [id])).paid_at as Date | null;
    const dailyLimit = async () => (await today()).state.dailyLimit as number;
    const links = async (id: number) =>
      ((await ds.query(`SELECT transaction_id FROM payment_links WHERE payment_id=$1 ORDER BY transaction_id`, [id])) as { transaction_id: number }[]).map(
        (r) => r.transaction_id,
      );

    it("a payment closed by two operations opens again when one is retyped; the other stays linked and the day takes the payment back", async () => {
      const c = await card();
      const id = await plan(1_700_000);
      const first = await bankTx(c, -1_000_000, "cash_out", "2026-11-07");
      const second = await bankTx(c, -700_000, "person_transfer", "2026-11-08", { time: "12:00:00" });
      await api.post(`/cash/payments/${id}/links`, { transactionIds: [first, second] }).expect(201);
      expect(await paidAt(id)).not.toBeNull();
      const closed = await dailyLimit();

      await api.patch(`/transactions/${second}`, { type: "spend" }).expect(200);
      expect(await paidAt(id)).toBeNull();
      expect(await links(id)).toEqual([first]);
      expect(await dailyLimit()).toBeLessThan(closed);
      expect((await today()).upcoming).toMatchObject([{ id: String(id), amount: 1_700_000, paid: 1_000_000 }]);
      // Open again, it takes the rest the usual way.
      expect((await api.post(`/cash/payments/${id}/links`, { transactionIds: [second] }).expect(201)).body).toMatchObject({ closed: true });
    });

    it("stays closed when what is left still covers it", async () => {
      const c = await card();
      const id = await plan(1_700_000);
      const a = await bankTx(c, -900_000, "cash_out", "2026-11-07");
      const b = await bankTx(c, -900_000, "cash_out", "2026-11-08");
      const extra = await bankTx(c, -300_000, "person_transfer", "2026-11-08", { time: "12:00:00" });
      await api.post(`/cash/payments/${id}/links`, { transactionIds: [a, b, extra] }).expect(201);
      const paid = await paidAt(id);
      expect(paid).not.toBeNull();
      await api.patch(`/transactions/${extra}`, { type: "spend" }).expect(200);
      expect(await paidAt(id)).toEqual(paid);
      expect(await links(id)).toEqual([a, b]);
    });

    it("a payment closed by hand stays closed when an operation linked to it is retyped", async () => {
      const c = await card();
      const id = await plan(1_700_000);
      const part = await bankTx(c, -310_500, "cash_out", "2026-11-08");
      await api.post(`/cash/payments/${id}/links`, { transactionIds: [part] }).expect(201);
      await api.post(`/plan/payments/${id}/mark-paid`).expect(201);
      await api.patch(`/transactions/${part}`, { type: "spend" }).expect(200);
      expect(await paidAt(id)).not.toBeNull();
      expect(await links(id)).toEqual([]);
    });

    it("a payment closed by its own operation opens again as before, and the day takes it back", async () => {
      const c = await card();
      const id = await plan(1_700_000);
      const t = await bankTx(c, -1_700_000, "spend", "2026-11-06");
      await api.patch(`/transactions/${t}`, { type: "obligation" }).expect(200);
      expect((await row(`SELECT transaction_id FROM scheduled_payments WHERE id=$1`, [id])).transaction_id).toBe(t);
      const closed = await dailyLimit();
      await api.patch(`/transactions/${t}`, { type: "spend" }).expect(200);
      expect(await row(`SELECT paid_at, transaction_id FROM scheduled_payments WHERE id=$1`, [id])).toEqual({ paid_at: null, transaction_id: null });
      expect(await dailyLimit()).toBeLessThan(closed);
    });

    it("an answer about the recipient that retypes both operations opens the payment again", async () => {
      const c = await card();
      const id = await plan(1_700_000);
      const first = await bankTx(c, -1_000_000, "person_transfer", "2026-11-07", { name: "Olena K", description: "Переказ" });
      const second = await bankTx(c, -700_000, "person_transfer", "2026-11-08", { name: "Olena K", description: "Переказ" });
      await api.post(`/cash/payments/${id}/links`, { transactionIds: [first, second] }).expect(201);
      expect(await paidAt(id)).not.toBeNull();
      const key = ((await api.get("/transactions").expect(200)).body.items as { id: number; counterKey: string }[]).find((t) => t.id === first)!.counterKey;
      await api.post("/recipients/label", { counterKey: key, label: "help" }).expect(201);
      expect(await paidAt(id)).toBeNull();
      expect(await links(id)).toEqual([]);
    });
  });

  it("retyping a linked row away from the payment unlinks it", async () => {
    const c = await card();
    const id = await plan(1_700_000);
    const silpo = await bankTx(c, -310_500, "cash_out", "2026-11-08");
    await api.post(`/cash/payments/${id}/links`, { transactionIds: [silpo] }).expect(201);
    await api.patch(`/transactions/${silpo}`, { type: "cash_out" }).expect(200);
    expect(await ds.query(`SELECT 1 FROM payment_links`)).toEqual([]);
  });
});

describe("the owner's card at another bank", () => {
  const send = (c: number, amount: number, date: string, card = "545708****4563", time = "10:00:00") =>
    bankTx(c, -amount, "own_transfer", date, { description: card, time });
  const questions = async () => ((await today()).questions as { id: string; kind: string; text: string }[]).filter((q) => q.kind === "cash_card");
  const answer = (id: number, body: object) => api.post(`/cash/cards/${id}`, body);

  it("asks about a transfer since the start that has no other leg at monobank; the wallet waits for the answer", async () => {
    const c = await card();
    await send(c, 500_000, "2026-11-08");
    await start(100_000, "2026-11-09").expect(201);
    const t = await send(c, 1_560_000, "2026-11-09");
    expect(await questions()).toEqual([
      { id: `cash_card:${t}`, kind: "cash_card", text: "Перевод ₴15,600 на 545708****4563 (09.11). Снял наличными?" },
    ]);
    expect((await wallet()).balance).toBe(100_000);
  });

  it("does not ask about a transfer between monobank accounts", async () => {
    const c = await card();
    const other = await card();
    await start(0, "2026-11-09").expect(201);
    await send(c, 300_000, "2026-11-09", "На чорну картку");
    await bankTx(other, 300_000, "own_transfer", "2026-11-09", { time: "10:01:00" });
    expect(await questions()).toEqual([]);
  });

  it("does not ask about, or offer as a payment, an exchange between own accounts in different currencies (Б10)", async () => {
    const c = await card();
    seq++;
    const dollars = (await ds.query(`INSERT INTO accounts (external_id, kind, currency, balance) VALUES ($1,'black','USD',0) RETURNING id`, [`acc-${seq}`]))[0]
      .id as number;
    await start(0, "2026-11-09").expect(201);
    // ₴4,130 left the card; the $100 that arrived is worth ₴4,100 at the day's rate.
    const out = await send(c, 413_000, "2026-11-09", "Переказ на картку");
    const inn = await bankTx(dollars, 10_000, "own_transfer", "2026-11-09", { time: "10:00:40" });
    await ds.query(`UPDATE transactions SET amount_uah=410000 WHERE id=$1`, [inn]);
    const toOtherBank = await send(c, 200_000, "2026-11-09", "545708****4563", "12:00:00");
    expect((await questions()).map((q) => q.id)).toEqual([`cash_card:${toOtherBank}`]);
    const payment = (
      await ds.query(`INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation','Квартплата',1700000,'UAH','2026-11-10') RETURNING id`)
    )[0].id as number;
    const offered = ((await api.get(`/cash/payments/${payment}/candidates`).expect(200)).body as { id: number }[]).map((t) => t.id);
    expect(offered).toEqual([toOtherBank]);
    expect(offered).not.toContain(out);
  });

  it("yes: the whole sum goes to the wallet, and later transfers to that card follow without a question", async () => {
    const c = await card();
    await start(100_000, "2026-11-09").expect(201);
    const t = await send(c, 1_560_000, "2026-11-09");
    await answer(t, { answer: "yes" }).expect(201);
    expect((await wallet()).balance).toBe(1_660_000);
    await send(c, 200_000, "2026-11-10");
    expect(await questions()).toEqual([]);
    expect((await wallet()).balance).toBe(1_860_000);
    expect((await api.get(`/transactions?q=545708`).expect(200)).body.items.map((i: { cashOut: number }) => i.cashOut)).toEqual([200_000, 1_560_000]);
  });

  it("part: only what was taken goes to the wallet, the card is remembered as yes", async () => {
    const c = await card();
    await start(0, "2026-11-09").expect(201);
    const t = await send(c, 1_560_000, "2026-11-09");
    await answer(t, { answer: "part" }).expect(422);
    await answer(t, { answer: "part", amount: 1_600_000 }).expect(422);
    await answer(t, { answer: "part", amount: 1_500_000 }).expect(201);
    expect((await wallet()).balance).toBe(1_500_000);
    await send(c, 100_000, "2026-11-10");
    expect((await wallet()).balance).toBe(1_600_000);
  });

  it("no: the wallet is left alone and the card is not asked about again", async () => {
    const c = await card();
    await start(0, "2026-11-09").expect(201);
    const t = await send(c, 1_560_000, "2026-11-09");
    await answer(t, { answer: "no" }).expect(201);
    await send(c, 100_000, "2026-11-10");
    expect(await questions()).toEqual([]);
    expect((await wallet()).balance).toBe(0);
    expect((await api.get(`/transactions?q=545708`).expect(200)).body.items.map((i: { cashOut: number }) => i.cashOut)).toEqual([0, 0]);
  });

  it("the amount of one transfer can be changed afterwards, down to nothing taken", async () => {
    const c = await card();
    await start(0, "2026-11-09").expect(201);
    const t = await send(c, 1_560_000, "2026-11-09");
    await answer(t, { answer: "yes" }).expect(201);
    await api.patch(`/cash/cards/${t}`, { amount: 0 }).expect(200);
    expect((await wallet()).balance).toBe(0);
    await api.patch(`/cash/cards/${t}`, { amount: 1_000_000 }).expect(200);
    expect((await wallet()).balance).toBe(1_000_000);
    await api.patch(`/cash/cards/${t}`, { amount: 2_000_000 }).expect(422);
    const buy = await bankTx(c, -100, "spend", "2026-11-09");
    await api.patch(`/cash/cards/${buy}`, { amount: 0 }).expect(422);
    await answer(buy, { answer: "yes" }).expect(422);
    await answer(99999, { answer: "yes" }).expect(404);
  });

  it("other rows say nothing about cash taken", async () => {
    const c = await card();
    await bankTx(c, -100, "spend", "2026-11-09", { description: "Shop" });
    expect((await api.get(`/transactions`).expect(200)).body.items[0].cashOut).toBeNull();
  });
});

describe("changing the answer to «Откуда наличные?» (Б21)", () => {
  const DEPOSIT = 2_950_000; // ₴29,500
  const TAKEN = 73_750; // its cents at ₴40 a dollar
  const binance = async () => (await row(`SELECT amount::int AS amount FROM manual_balances WHERE name='Binance'`)).amount as number;
  const answer = (id: number, a: string) => api.post(`/cash/deposits/${id}/answer`, { answer: a });
  const rate = (r: number, fetched = "2026-11-10T09:00:00Z") =>
    ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', $1, $2)`, [fetched, r]);
  const event = async (status = "received") => {
    const exp = (
      await ds.query(
        `INSERT INTO expected_incomes (source, amount, currency, window_start_day, window_end_day) VALUES ('usdc', 500000, 'USD', 1, 5) RETURNING id`,
      )
    )[0].id;
    return (
      await ds.query(
        `INSERT INTO income_events (expected_income_id, period, expected_on, status, received_at) VALUES ($1,'2026-11','2026-11-03',$2,$3) RETURNING id`,
        [exp, status, status === "received" ? "2026-11-03T10:00:00Z" : null],
      )
    )[0].id as number;
  };
  const terminal = { description: "Термінал City24", mcc: 4829 };
  /** The wallet started with ₴30,000, Binance holds $5,000 at ₴40, and ₴29,500 was paid in at a terminal. */
  const setup = async (eventStatus = "received") => {
    const c = await card();
    await start(3_000_000, "2026-11-10").expect(201);
    await rate(40);
    await ds.query(`INSERT INTO manual_balances (name, amount, currency, counts_as_own) VALUES ('Binance', 500000, 'USD', true)`);
    const ev = await event(eventStatus);
    const deposit = await bankTx(c, DEPOSIT, "cash_in", "2026-11-10", terminal);
    return { c, ev, deposit };
  };
  const tx = async (id: number) => {
    const items = (await api.get(`/transactions?limit=200`).expect(200)).body.items as { id: number; cashAnswer?: unknown }[];
    return items.find((t) => t.id === id)!;
  };
  const facts = (id: number) => row(`SELECT type, category, usdc_checked, from_wallet FROM transactions WHERE id=$1`, [id]);
  const link = async (ev: number) => (await row(`SELECT matched_transaction_id AS m FROM income_events WHERE id=$1`, [ev])).m as number | null;

  it("from Binance to the wallet: Binance gets back exactly the cents taken, the wallet pays the deposit", async () => {
    const { ev, deposit } = await setup();
    await api.post(`/plan/incomes/${ev}/match-transaction`, { transactionId: deposit }).expect(201);
    expect(await binance()).toBe(500_000 - TAKEN);
    expect((await tx(deposit)).cashAnswer).toEqual({ answer: "binance", canBinance: true, binanceOnChange: "returns" });
    // The rate moved since: the answer gives back what it took, not today's equivalent.
    await rate(42, "2026-11-10T09:30:00Z");

    const r = await answer(deposit, "wallet").expect(201);
    expect(r.body.cashAnswer).toEqual({ answer: "wallet", canBinance: true, binanceOnChange: null });
    expect(await binance()).toBe(500_000);
    expect((await wallet()).balance).toBe(3_000_000 - DEPOSIT);
    expect(await facts(deposit)).toEqual({ type: "own_transfer", category: "own", usdc_checked: true, from_wallet: true });
    expect(await link(ev)).toBeNull();
    expect((await row(`SELECT status FROM income_events WHERE id=$1`, [ev])).status).toBe("received");
  });

  it("from the wallet to Binance: the wallet gets the deposit back, Binance is lowered once and remembers by how much", async () => {
    const { ev, deposit } = await setup();
    await api.post(`/cash/deposits/${deposit}/from-wallet`).expect(201);
    expect((await wallet()).balance).toBe(3_000_000 - DEPOSIT);

    await answer(deposit, "binance").expect(201);
    expect((await wallet()).balance).toBe(3_000_000);
    expect(await binance()).toBe(500_000 - TAKEN);
    expect(await facts(deposit)).toEqual({ type: "own_transfer", category: "own", usdc_checked: true, from_wallet: false });
    expect(await link(ev)).toBe(deposit);

    await rate(42, "2026-11-10T09:30:00Z");
    await answer(deposit, "wallet").expect(201);
    expect(await binance()).toBe(500_000);
    expect((await wallet()).balance).toBe(3_000_000 - DEPOSIT);
  });

  it("a Binance balance that went to zero gets back only what the answer really took", async () => {
    const { deposit } = await setup();
    await ds.query(`UPDATE manual_balances SET amount=50000 WHERE name='Binance'`);
    await answer(deposit, "binance").expect(201);
    expect(await binance()).toBe(0);
    await answer(deposit, "other").expect(201);
    expect(await binance()).toBe(50_000);
  });

  it("the same answer again changes nothing", async () => {
    const { deposit } = await setup();
    await answer(deposit, "binance").expect(201);
    await answer(deposit, "binance").expect(201);
    expect(await binance()).toBe(500_000 - TAKEN);
    await answer(deposit, "wallet").expect(201);
    await answer(deposit, "wallet").expect(201);
    expect(await binance()).toBe(500_000);
    expect((await wallet()).balance).toBe(3_000_000 - DEPOSIT);
    await api.post(`/cash/deposits/${deposit}/from-wallet`).expect(201);
    expect((await wallet()).balance).toBe(3_000_000 - DEPOSIT);
  });

  it("«Вывод с Binance» again leaves Binance as it is: after a rate change, and on a row answered before the migration", async () => {
    const { c, ev, deposit } = await setup();
    await answer(deposit, "binance").expect(201);
    await rate(42, "2026-11-10T09:30:00Z");
    await answer(deposit, "binance").expect(201);
    expect(await binance()).toBe(500_000 - TAKEN);

    const old = await bankTx(c, DEPOSIT, "own_transfer", "2026-11-10", { ...terminal, usdcChecked: true });
    await ds.query(`UPDATE transactions SET category='own', type_source='owner' WHERE id=$1`, [old]);
    await ds.query(`UPDATE income_events SET matched_transaction_id=$2 WHERE id=$1`, [ev, old]);
    await ds.query(`UPDATE manual_balances SET amount=500000 WHERE name='Binance'`);
    await answer(old, "binance").expect(201);
    expect(await binance()).toBe(500_000);
    expect(await link(ev)).toBe(old);
    expect((await tx(old)).cashAnswer).toEqual({ answer: "binance", canBinance: true, binanceOnChange: "untouched" });
  });

  it("«Другое» and back: it touches neither the wallet nor Binance, and undoes what the others did", async () => {
    const { deposit } = await setup();
    await api.post(`/plan/transactions/${deposit}/not-usdc`).expect(201);
    expect((await tx(deposit)).cashAnswer).toEqual({ answer: "other", canBinance: true, binanceOnChange: null });

    await answer(deposit, "wallet").expect(201);
    expect((await wallet()).balance).toBe(3_000_000 - DEPOSIT);
    await answer(deposit, "other").expect(201);
    expect((await wallet()).balance).toBe(3_000_000);
    expect(await facts(deposit)).toEqual({ type: "cash_in", category: null, usdc_checked: true, from_wallet: false });

    await answer(deposit, "binance").expect(201);
    expect(await binance()).toBe(500_000 - TAKEN);
    await answer(deposit, "other").expect(201);
    expect(await binance()).toBe(500_000);
    expect(await facts(deposit)).toEqual({ type: "cash_in", category: null, usdc_checked: true, from_wallet: false });
    // Still answered: the question does not come back.
    expect(((await today()).questions as { kind: string }[]).filter((q) => q.kind === "cash_source")).toEqual([]);
  });

  it("an income not received before the answer gets its earlier status back", async () => {
    const { ev, deposit } = await setup("expected");
    await api.post(`/plan/incomes/${ev}/match-transaction`, { transactionId: deposit }).expect(201);
    expect((await row(`SELECT status FROM income_events WHERE id=$1`, [ev])).status).toBe("received");
    expect(await binance()).toBe(500_000);

    const r = await answer(deposit, "wallet").expect(201);
    expect(r.body.cashAnswer.answer).toBe("wallet");
    expect(await row(`SELECT status, received_at, amount_uah, matched_transaction_id AS m FROM income_events WHERE id=$1`, [ev])).toEqual({
      status: "expected", received_at: null, amount_uah: null, m: null,
    });
    expect(await binance()).toBe(500_000);
    // With no USDC income received there is nothing to match: Binance cannot be the answer now.
    expect(r.body.cashAnswer.canBinance).toBe(false);
    await answer(deposit, "binance").expect(422);
  });

  it("a row answered before the migration changes its answer without touching Binance", async () => {
    const { c, ev } = await setup();
    // Answered «Вывод с Binance» before answers were kept; the owner may have put Binance right by hand since.
    const deposit = await bankTx(c, DEPOSIT, "own_transfer", "2026-11-10", { ...terminal, usdcChecked: true });
    await ds.query(`UPDATE transactions SET category='own', type_source='owner' WHERE id=$1`, [deposit]);
    await ds.query(`UPDATE income_events SET matched_transaction_id=$2 WHERE id=$1`, [ev, deposit]);
    expect((await tx(deposit)).cashAnswer).toEqual({ answer: "binance", canBinance: true, binanceOnChange: "untouched" });

    await answer(deposit, "wallet").expect(201);
    expect(await binance()).toBe(500_000);
    expect(await link(ev)).toBeNull();
    expect(await facts(deposit)).toEqual({ type: "own_transfer", category: "own", usdc_checked: true, from_wallet: true });

    // An earlier «Из кошелька» changes the same way: the wallet gets that deposit back.
    const old = await bankTx(c, 100_000, "own_transfer", "2026-11-10", { ...terminal, usdcChecked: true });
    await ds.query(`UPDATE transactions SET category='own', type_source='owner', from_wallet=true WHERE id=$1`, [old]);
    expect((await tx(old)).cashAnswer).toEqual({ answer: "wallet", canBinance: true, binanceOnChange: null });
    const before = (await wallet()).balance as number;
    await answer(old, "other").expect(201);
    expect((await wallet()).balance).toBe(before + 100_000);
    expect(await facts(old)).toEqual({ type: "cash_in", category: "cash", usdc_checked: true, from_wallet: false });
    expect(await binance()).toBe(500_000);
  });

  it("a type chip on an answered row undoes the answer first", async () => {
    const { c, ev, deposit } = await setup();
    await answer(deposit, "binance").expect(201);
    // Only the category, or the same type: the answer stays.
    await api.patch(`/transactions/${deposit}`, { category: "own" }).expect(200);
    await api.patch(`/transactions/${deposit}`, { type: "own_transfer" }).expect(200);
    expect(await binance()).toBe(500_000 - TAKEN);

    const r = await api.patch(`/transactions/${deposit}`, { type: "income" }).expect(200);
    expect(r.body.transaction.cashAnswer).toBeNull();
    expect(await binance()).toBe(500_000);
    expect(await link(ev)).toBeNull();
    expect(await facts(deposit)).toEqual({ type: "income", category: "income", usdc_checked: false, from_wallet: false });

    const other = await bankTx(c, 100_000, "cash_in", "2026-11-10", terminal);
    await api.post(`/cash/deposits/${other}/from-wallet`).expect(201);
    expect((await wallet()).balance).toBe(3_000_000 - 100_000);
    await api.patch(`/transactions/${other}`, { type: "person_in" }).expect(200);
    expect((await wallet()).balance).toBe(3_000_000);
    expect(await facts(other)).toEqual({ type: "person_in", category: "transfer", usdc_checked: false, from_wallet: false });
  });

  it("only a cash deposit since the wallet start; the field is null on other rows", async () => {
    const c = await card();
    const early = await bankTx(c, DEPOSIT, "cash_in", "2026-11-09", terminal);
    await answer(early, "wallet").expect(409); // no wallet yet
    await start(0, "2026-11-10").expect(201);
    const spend = await bankTx(c, -100, "spend", "2026-11-10", { description: "Shop" });
    await answer(spend, "wallet").expect(422);
    await answer(early, "wallet").expect(422);
    await answer(99999, "wallet").expect(404);
    await answer(spend, "elsewhere").expect(400);
    expect((await tx(spend)).cashAnswer).toBeNull();
    // A deposit not answered yet can be answered from its card too.
    const fresh = await bankTx(c, DEPOSIT, "cash_in", "2026-11-10", terminal);
    expect((await tx(fresh)).cashAnswer).toBeNull();
    expect((await answer(fresh, "wallet").expect(201)).body.cashAnswer).toEqual({ answer: "wallet", canBinance: false, binanceOnChange: null });
  });
});

describe("USDC exchanged for cash in one action (Б22)", () => {
  // The owner's exchange of 15 November: $1,400 USDC for ₴65,430 in cash.
  const USDC = 140_000;
  const UAH = 6_543_000;
  const binance = async () => (await row(`SELECT amount::int AS amount FROM manual_balances WHERE name='Binance'`))?.amount as number | undefined;
  const hasBinance = (cents: number) =>
    ds.query(`INSERT INTO manual_balances (name, amount, currency, counts_as_own) VALUES ('Binance', $1, 'USD', true)`, [cents]);
  const exchange = (usdc = USDC, amount = UAH) => op({ kind: "exchange", usdc, amount });
  const kept = (id: number) =>
    row(`SELECT usdc_cents::int AS usdc, binance_cents::int AS binance FROM cash_exchanges WHERE transaction_id=$1`, [id]);
  const spentToday = async () =>
    ((await api.get("/today/calendar?month=2026-11").expect(200)).body.days as { date: string; spent: number }[]).find((d) => d.date === "2026-11-10")!
      .spent;
  const fixes = () => vi.spyOn(app.get(LimitService), "invalidate");

  beforeEach(async () => {
    await start(500_000).expect(201);
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-10T09:00:00Z', 41.5)`);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lowers Binance by the dollars, raises the wallet by the hryvnias, spends nothing and fixes the limit once", async () => {
    await hasBinance(500_000);
    await op({ kind: "spend", amount: 30_000, category: "cafe" }).expect(201);
    const spent = await spentToday();
    const spy = fixes();

    const created = (await exchange().expect(201)).body;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(created).toMatchObject({
      amount: UAH, amountUah: UAH, type: "own_transfer", category: "own", description: "Обмен USDC на наличные", manual: true,
      exchange: { usdc: USDC, rate: 46.74 },
    });
    expect(await binance()).toBe(500_000 - USDC);
    expect((await wallet()).balance).toBe(500_000 - 30_000 + UAH);
    expect(await spentToday()).toBe(spent);
    expect(await kept(created.id)).toEqual({ usdc: USDC, binance: USDC });

    const spend = (await api.get("/transactions?group=spend").expect(200)).body.items as { id: number }[];
    expect(spend.map((i) => i.id)).not.toContain(created.id);
    const all = (await api.get("/transactions").expect(200)).body.items as { id: number; exchange?: unknown; inLimit?: boolean }[];
    expect(all.find((i) => i.id === created.id)).toMatchObject({ exchange: { usdc: USDC, rate: 46.74 }, inLimit: false });
    // Every other row says it is no exchange.
    expect(all.filter((i) => i.id !== created.id).every((i) => i.exchange === null)).toBe(true);
  });

  it("with $1,000 on Binance takes only $1,000, and deleting gives back exactly that", async () => {
    await hasBinance(100_000);
    const { id } = (await exchange().expect(201)).body as { id: number };
    expect(await binance()).toBe(0);
    expect(await kept(id)).toEqual({ usdc: USDC, binance: 100_000 });

    // The owner put Binance right by hand since: deleting gives back what was taken, not the dollars given.
    await ds.query(`UPDATE manual_balances SET amount=30000 WHERE name='Binance'`);
    const spy = fixes();
    await api.del(`/cash/operations/${id}`).expect(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await binance()).toBe(130_000);
    expect((await wallet()).balance).toBe(500_000);
    expect(await kept(id)).toBeUndefined();
  });

  it("an exchange Binance could not cover keeps what it took while its dollars stay the same (review round 1)", async () => {
    await hasBinance(100_000);
    const { id } = (await exchange().expect(201)).body as { id: number };
    expect(await binance()).toBe(0);
    // A USDC income arrived since: Binance holds $2,000 that this exchange never touched.
    await ds.query(`UPDATE manual_balances SET amount=200000 WHERE name='Binance'`);
    const spy = fixes();

    // What the app sends when only the note, the date or the hryvnias change.
    await api.patch(`/cash/operations/${id}`, { kind: "exchange", usdc: USDC, amount: 6_500_000, date: "2026-11-10", note: "Обменник" }).expect(200);
    expect(await binance()).toBe(200_000);
    expect(await kept(id)).toEqual({ usdc: USDC, binance: 100_000 });
    expect((await wallet()).balance).toBe(500_000 + 6_500_000);
    expect(spy).toHaveBeenCalledTimes(1);

    // Other dollars: what was taken goes back, and the new dollars are taken from what is there now.
    await api.patch(`/cash/operations/${id}`, { usdc: 150_000 }).expect(200);
    expect(await binance()).toBe(200_000 + 100_000 - 150_000);
    expect(await kept(id)).toEqual({ usdc: 150_000, binance: 150_000 });
  });

  it("a changed exchange gives back what it took and takes again; into another kind and back too", async () => {
    await hasBinance(500_000);
    const { id } = (await exchange().expect(201)).body as { id: number };

    const spy = fixes();
    const fewer = (await api.patch(`/cash/operations/${id}`, { usdc: 100_000, amount: 4_100_000 }).expect(200)).body;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(fewer).toMatchObject({ amount: 4_100_000, type: "own_transfer", exchange: { usdc: 100_000, rate: 41 } });
    expect(await binance()).toBe(400_000);
    expect((await wallet()).balance).toBe(500_000 + 4_100_000);

    // A note alone leaves Binance as it is.
    await api.patch(`/cash/operations/${id}`, { note: "Обменник на Подоле" }).expect(200);
    // A wallet row is changed only here: the general editor of operations refuses it.
    await api.patch(`/transactions/${id}`, { type: "spend", category: "cafe" }).expect(422);
    await api.patch(`/transactions/${id}`, { category: "cafe", applyToSimilar: true }).expect(422);
    expect(await binance()).toBe(400_000);
    expect(await kept(id)).toEqual({ usdc: 100_000, binance: 100_000 });

    const own = (await api.patch(`/cash/operations/${id}`, { kind: "own_out", amount: 50_000 }).expect(200)).body;
    expect(own).toMatchObject({ amount: -50_000, type: "own_transfer", exchange: null });
    expect(await binance()).toBe(500_000);
    expect(await kept(id)).toBeUndefined();
    expect((await wallet()).balance).toBe(450_000);

    // Back to an exchange: it needs the dollars again.
    await api.patch(`/cash/operations/${id}`, { kind: "exchange" }).expect(422);
    await api.patch(`/cash/operations/${id}`, { kind: "exchange", usdc: USDC, amount: UAH }).expect(200);
    expect(await binance()).toBe(500_000 - USDC);
    expect((await wallet()).balance).toBe(500_000 + UAH);
    expect((await api.patch(`/cash/operations/${id}`, { kind: "spend", category: "cafe" }).expect(200)).body).toMatchObject({ amount: -UAH, exchange: null });
    expect(await binance()).toBe(500_000);
  });

  it("with no Binance balance takes nothing and still records the exchange", async () => {
    const created = (await exchange().expect(201)).body;
    expect(created.exchange).toEqual({ usdc: USDC, rate: 46.74 });
    expect(await kept(created.id)).toEqual({ usdc: USDC, binance: 0 });
    expect((await wallet()).balance).toBe(500_000 + UAH);
    await api.del(`/cash/operations/${created.id}`).expect(200);
    expect(await binance()).toBeUndefined();
    expect((await wallet()).balance).toBe(500_000);
  });

  it("validates", async () => {
    await op({ kind: "exchange", amount: UAH }).expect(400);
    await exchange(0).expect(400);
    await op({ kind: "own_out", amount: 100, usdc: 100 }).expect(400);
    const { id } = (await op({ kind: "own_out", amount: 100 }).expect(201)).body as { id: number };
    await api.patch(`/cash/operations/${id}`, { kind: "spend", category: "cafe", usdc: 100 }).expect(400);
    // The dollars of a row that is no exchange.
    await api.patch(`/cash/operations/${id}`, { usdc: 100 }).expect(422);
  });
});
