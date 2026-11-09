import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { Clock } from "../src/today/clock";
import { ReclassifyService } from "../src/transactions/reclassify.service";

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
  await ds.query(`UPDATE settings SET lifestyle_cap=100000000, food_floor=45000, tax_rate_bp=600, esv_quarter=0, cash_start=NULL, tracking_start='2026-01-01'`);
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
  over: { usdcChecked?: boolean; description?: string; time?: string; name?: string } = {},
): Promise<number> {
  seq++;
  return (
    await ds.query(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, type_source, usdc_checked, counter_name, raw)
       VALUES ($1,$2,$3,$4,$8,$5,$5,$6,'rule',$7,$9,'{}') RETURNING id`,
      [`tx-${seq}`, accountId, `${date}T${over.time ?? "10:00:00"}Z`, date, amount, type, over.usdcChecked ?? false, over.description ?? "Банкомат", over.name ?? null],
    )
  )[0].id;
}
const wallet = async () => (await api.get("/cash").expect(200)).body;
const today = async () => (await api.get("/today").expect(200)).body;
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
    await start(2_000_000).expect(201);
    const id = await plan(1_700_000);
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
    await bankTx(c, -10_000, "spend", "2026-11-08"); // a purchase
    await bankTx(c, -2_000_000, "cash_out", "2026-11-08"); // larger than the payment
    await bankTx(c, 50_000, "person_in", "2026-11-08"); // incoming
    const other = await plan(60_000, "2026-11-07");
    await ds.query(`UPDATE scheduled_payments SET paid_at=now(), transaction_id=$1 WHERE id=$2`, [due, other]);
    expect(await candidates(id)).toEqual([ownCard, silpo, person]);
    await api.get(`/cash/payments/99999/candidates`).expect(404);
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

  it("refuses rows that are not offered, and an empty choice", async () => {
    const c = await card();
    const id = await plan(1_700_000);
    const buy = await bankTx(c, -10_000, "spend", "2026-11-08");
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

  it("retyping a linked row away from the payment unlinks it", async () => {
    const c = await card();
    const id = await plan(1_700_000);
    const silpo = await bankTx(c, -310_500, "cash_out", "2026-11-08");
    await api.post(`/cash/payments/${id}/links`, { transactionIds: [silpo] }).expect(201);
    await api.patch(`/transactions/${silpo}`, { type: "cash_out" }).expect(200);
    expect(await ds.query(`SELECT 1 FROM payment_links`)).toEqual([]);
  });
});
