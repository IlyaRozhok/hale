import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { PlanService } from "../src/plan/plan.service";
import { ReclassifyService } from "../src/transactions/reclassify.service";

let app: INestApplication;
let ds: DataSource;
let auth: string;
let seq = 0;

const http = () => app.getHttpServer();
const api = {
  get: (p: string) => request(http()).get(p).set("Authorization", auth),
  post: (p: string, b: object = {}) => request(http()).post(p).set("Authorization", auth).send(b),
  patch: (p: string, b: object = {}) => request(http()).patch(p).set("Authorization", auth).send(b),
  del: (p: string) => request(http()).delete(p).set("Authorization", auth),
};

beforeAll(async () => {
  const url = await createMigratedDatabase();
  ds = new DS({ type: "postgres", url });
  await ds.initialize();
  app = await createTestApp(url);
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
              scheduled_payments, manual_balances, loans RESTART IDENTITY CASCADE`,
  );
  await ds.query(`UPDATE settings SET lifestyle_cap=0, food_floor=0, tax_rate_bp=600, esv_quarter=0`);
});

async function account(kind: string, currency = "UAH"): Promise<number> {
  seq++;
  return (
    await ds.query(
      `INSERT INTO accounts (external_id, kind, currency, balance) VALUES ($1,$2,$3,0) RETURNING id`,
      [`acc-${seq}`, kind, currency],
    )
  )[0].id;
}
async function tx(
  accountId: number,
  over: { amount: number; description: string; date?: string; mcc?: number | null; amountUah?: number | null },
): Promise<number> {
  seq++;
  const date = over.date ?? "2026-11-18";
  return (
    await ds.query(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, mcc, amount, amount_uah, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{}') RETURNING id`,
      [
        `tx-${seq}`, accountId, `${date}T10:00:00Z`, date, over.description,
        over.mcc === undefined ? null : over.mcc, over.amount,
        over.amountUah === undefined ? over.amount : over.amountUah,
      ],
    )
  )[0].id;
}
const reclassify = (ids: number[]) => app.get(ReclassifyService).reclassifyIds(ids);
const row = async (sql: string, args: unknown[] = []) => (await ds.query(sql, args))[0];

describe("auth and validation", () => {
  it("guards plan routes", async () => {
    await request(http()).get("/plan/payments").expect(401);
    await request(http()).get("/settings").expect(401);
  });

  it("rejects malformed bodies with 400", async () => {
    await api.post("/plan/payments", { kind: "nope" }).expect(400);
    await api.post("/plan/payments", { kind: "tax", name: "x", amount: 1.5, currency: "UAH", due_on: "2026-11-20" }).expect(400);
    await api.post("/plan/payments", { kind: "tax", name: "x", amount: 100, currency: "UAH", due_on: "2026-02-31" }).expect(400);
    await api.patch("/settings", { tax_rate_bp: -1 }).expect(400);
  });
});

describe("CRUD", () => {
  it("manages scheduled payments", async () => {
    const created = await api
      .post("/plan/payments", { kind: "obligation", name: "Rent", amount: 1_700_000, currency: "UAH", due_on: "2026-11-06" })
      .expect(201);
    expect(created.body).toMatchObject({ name: "Rent", amount: 1_700_000, paid_at: null, overpayment: false });
    const id = created.body.id as number;
    await api.patch(`/plan/payments/${id}`, { due_on: "2026-11-07", overpayment: true }).expect(200);
    const list = await api.get("/plan/payments").expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ due_on: "2026-11-07", overpayment: true });
    await api.del(`/plan/payments/${id}`).expect(200);
    await api.patch(`/plan/payments/${id}`, { name: "x" }).expect(404);
  });

  it("manages expected incomes and manual balances", async () => {
    const inc = await api
      .post("/plan/expected-incomes", { source: "usdc", amount: 270_000, currency: "USD", window_start_day: 15, window_end_day: 25 })
      .expect(201);
    await api.patch(`/plan/expected-incomes/${inc.body.id}`, { amount: 280_000 }).expect(200);
    expect((await api.get("/plan/expected-incomes")).body[0].amount).toBe(280_000);
    const bal = await api.post("/plan/manual-balances", { name: "Crypto", amount: 9_000, currency: "USD" }).expect(201);
    expect(bal.body.counts_as_own).toBe(true);
    await api.del(`/plan/manual-balances/${bal.body.id}`).expect(200);
    await api.del(`/plan/expected-incomes/${inc.body.id}`).expect(200);
  });

  it("reads and updates settings", async () => {
    expect((await api.get("/settings").expect(200)).body).toMatchObject({ tax_rate_bp: 600 });
    const r = await api.patch("/settings", { lifestyle_cap: 10_000_000, food_floor: 45_000, esv_quarter: 570_702 }).expect(200);
    expect(r.body).toMatchObject({ lifestyle_cap: 10_000_000, food_floor: 45_000, esv_quarter: 570_702, tax_rate_bp: 600 });
  });
});

describe("payment matching during reclassification", () => {
  const installment = (over: object = {}) =>
    api.post("/plan/payments", {
      kind: "installment", name: "Store", amount: 529_500, currency: "UAH", due_on: "2026-11-18", ...over,
    });

  it("marks the matching installment paid and never pays a second one", async () => {
    const acc = await account("black");
    const first = (await installment().expect(201)).body.id as number;
    const second = (await installment({ due_on: "2026-11-19" }).expect(201)).body.id as number;
    const t = await tx(acc, { amount: -529_500, description: "Щомісячний платіж skay.ua", date: "2026-11-18" });

    await reclassify([t]);
    await reclassify([t]);
    await app.get(ReclassifyService).reclassifyPending();

    expect((await row("SELECT type FROM transactions WHERE id=$1", [t])).type).toBe("debt_payment");
    const paid = await ds.query("SELECT id, transaction_id FROM scheduled_payments WHERE paid_at IS NOT NULL");
    expect(paid).toEqual([{ id: first, transaction_id: t }]);
    expect((await row("SELECT paid_at FROM scheduled_payments WHERE id=$1", [second])).paid_at).toBeNull();
  });

  it("does not pay when the amount or the date do not fit", async () => {
    const acc = await account("black");
    await installment();
    const t1 = await tx(acc, { amount: -529_400, description: "Щомісячний платіж skay.ua" });
    const t2 = await tx(acc, { amount: -529_500, description: "Щомісячний платіж skay.ua", date: "2026-12-30" });
    await reclassify([t1, t2]);
    expect(await ds.query("SELECT 1 FROM scheduled_payments WHERE paid_at IS NOT NULL")).toHaveLength(0);
  });

  it("closes the month's labelled $800 obligation and does not count it as spend", async () => {
    const acc = await account("black");
    await ds.query(`INSERT INTO rules (match_kind, match_value, type, label) VALUES ('recipient','Partner','obligation','obligation')`);
    const id = (
      await api
        .post("/plan/payments", {
          kind: "obligation", name: "Support", amount: 80_000, currency: "USD", due_on: "2026-11-05", match_hint: "partner",
        })
        .expect(201)
    ).body.id as number;
    const t = await tx(acc, { amount: -3_500_000, description: "Partner", date: "2026-11-20", mcc: 4829 });
    await reclassify([t]);
    expect((await row("SELECT type FROM transactions WHERE id=$1", [t])).type).toBe("obligation");
    expect((await row("SELECT transaction_id FROM scheduled_payments WHERE id=$1", [id])).transaction_id).toBe(t);
  });

  it("pays a tax payment from the fop account", async () => {
    const fop = await account("fop");
    const id = (
      await api
        .post("/plan/payments", { kind: "tax", name: "Levy", amount: 223_932, currency: "UAH", due_on: "2026-11-20" })
        .expect(201)
    ).body.id as number;
    const t = await tx(fop, { amount: -223_932, description: "Військовий збір, ГУ ДПС", date: "2026-11-19" });
    await reclassify([t]);
    expect((await row("SELECT transaction_id FROM scheduled_payments WHERE id=$1", [id])).transaction_id).toBe(t);
  });
});

describe("loans", () => {
  it("a manual loan creates a loan row flagged as a bad case", async () => {
    const r = await api.post("/plan/loans", { amount: 500_000, received_on: "2026-11-01", note: "manual" }).expect(201);
    expect(r.body).toMatchObject({ amount: 500_000, bad_case: true, repaid_at: null });
    expect(await ds.query("SELECT 1 FROM loans")).toHaveLength(1);
    const list = (await api.get("/plan/loans").expect(200)).body;
    expect(list[0].bad_case).toBe(true);
    const repaid = await api.patch(`/plan/loans/${r.body.id}`, { repaid_at: "2026-11-02T00:00:00Z" }).expect(200);
    expect(repaid.body.bad_case).toBe(false);
  });

  it("a loan_in transaction creates exactly one loan", async () => {
    const acc = await account("black");
    const t = await tx(acc, { amount: 300_000, description: "Кредит до завтра", date: "2026-11-02" });
    await reclassify([t]);
    await reclassify([t]);
    const loans = await ds.query("SELECT amount, received_on::text AS d, source_transaction_id FROM loans");
    expect(loans).toEqual([{ amount: "300000", d: "2026-11-02", source_transaction_id: t }]);
  });
});

describe("income events", () => {
  const usdc = () =>
    api.post("/plan/expected-incomes", { source: "usdc", amount: 270_000, currency: "USD", window_start_day: 15, window_end_day: 25 });
  const fopIncome = () =>
    api.post("/plan/expected-incomes", { source: "fop", amount: 500_000, currency: "USD", window_start_day: 15, window_end_day: 25 });

  it("generates current and next month once, with a movable date", async () => {
    await usdc();
    await fopIncome();
    const plan = app.get(PlanService);
    await plan.generateEvents("2026-11-02");
    await plan.generateEvents("2026-11-02");
    const events = (await api.get("/plan/incomes").expect(200)).body;
    expect(events.map((e: { period: string; expected_on: string }) => [e.period, e.expected_on])).toEqual([
      ["2026-11", "2026-11-25"], ["2026-11", "2026-11-25"], ["2026-12", "2026-12-25"], ["2026-12", "2026-12-25"],
    ]);
    const id = events[0].id as number;
    const r = await api.post(`/plan/incomes/${id}/date`, { date: "2026-11-19" }).expect(201);
    expect(r.body.expected_on).toBe("2026-11-19");
    await api.post(`/plan/incomes/${id}/date`, { date: "2026-11-31" }).expect(400);
    await api.post(`/plan/incomes/99999/date`, { date: "2026-11-19" }).expect(404);
  });

  it("confirming USDC adds to the Binance balance once", async () => {
    await usdc();
    await app.get(PlanService).generateEvents("2026-11-02");
    const ev = (await api.get("/plan/incomes")).body[0].id as number;
    const a = await api.post(`/plan/incomes/${ev}/confirm`).expect(201);
    const b = await api.post(`/plan/incomes/${ev}/confirm`).expect(201);
    expect(a.body.status).toBe("received");
    expect(b.body.status).toBe("received");
    const bal = await ds.query("SELECT name, amount::int AS amount, currency, counts_as_own FROM manual_balances");
    expect(bal).toEqual([{ name: "Binance", amount: 270_000, currency: "USD", counts_as_own: true }]);

    // next month's confirm adds to the same row
    const ev2 = (await api.get("/plan/incomes")).body[1].id as number;
    await api.post(`/plan/incomes/${ev2}/confirm`).expect(201);
    expect((await row("SELECT amount::int AS amount FROM manual_balances WHERE name='Binance'")).amount).toBe(540_000);
  });

  it("an income on the fop account marks that month's fop event received", async () => {
    await fopIncome();
    await usdc();
    await app.get(PlanService).generateEvents("2026-11-02");
    const fop = await account("fop", "USD");
    const t = await tx(fop, { amount: 500_000, description: "From client", date: "2026-11-17", amountUah: 21_000_000 });
    await reclassify([t]);
    await reclassify([t]);
    const evs = await ds.query(
      `SELECT e.period, e.status, e.amount_uah::int AS amount_uah, x.source FROM income_events e
         JOIN expected_incomes x ON x.id = e.expected_income_id ORDER BY e.id`,
    );
    expect(evs.find((e: { source: string; period: string }) => e.source === "fop" && e.period === "2026-11")).toMatchObject({
      status: "received", amount_uah: 21_000_000,
    });
    expect(evs.filter((e: { status: string }) => e.status === "received")).toHaveLength(1);
  });

  it("matching a cash_in to a USDC event lowers Binance, retypes the row and is idempotent", async () => {
    await usdc();
    await app.get(PlanService).generateEvents("2026-11-02");
    const ev = (await api.get("/plan/incomes")).body[0].id as number;
    await api.post(`/plan/incomes/${ev}/confirm`).expect(201);
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', now(), 40)`);
    const card = await account("black");
    const t = await tx(card, { amount: 4_000_000, description: "Термінал City24", mcc: 4829, date: "2026-11-20" });
    await reclassify([t]);
    expect((await row("SELECT type FROM transactions WHERE id=$1", [t])).type).toBe("cash_in");

    await api.post(`/plan/incomes/${ev}/match-transaction`, { transactionId: t }).expect(201);
    await api.post(`/plan/incomes/${ev}/match-transaction`, { transactionId: t }).expect(201);
    expect((await row("SELECT amount::int AS amount FROM manual_balances WHERE name='Binance'")).amount).toBe(170_000);
    expect(await row("SELECT type, type_source FROM transactions WHERE id=$1", [t])).toEqual({
      type: "own_transfer", type_source: "owner",
    });
    await reclassify([t]);
    expect((await row("SELECT type FROM transactions WHERE id=$1", [t])).type).toBe("own_transfer");
    expect(await ds.query("SELECT 1 FROM transactions WHERE type='income'")).toHaveLength(0);

    const other = await tx(card, { amount: 100_000, description: "Термінал City24", mcc: 4829 });
    await api.post(`/plan/incomes/${ev}/match-transaction`, { transactionId: other }).expect(409);
    await api.post(`/plan/incomes/${ev}/match-transaction`, { transactionId: 99999 }).expect(404);
  });

  it("refuses to match an outgoing transaction", async () => {
    await usdc();
    await app.get(PlanService).generateEvents("2026-11-02");
    const ev = (await api.get("/plan/incomes")).body[0].id as number;
    const card = await account("black");
    const t = await tx(card, { amount: -100_000, description: "Coffee", mcc: 5814 });
    await api.post(`/plan/incomes/${ev}/match-transaction`, { transactionId: t }).expect(422);
  });
});

describe("manual mark-paid", () => {
  it("marks a payment paid by hand, idempotently", async () => {
    const id = (
      await api.post("/plan/payments", { kind: "tax", name: "ESV", amount: 570_702, currency: "UAH", due_on: "2026-11-20" })
    ).body.id as number;
    const a = await api.post(`/plan/payments/${id}/mark-paid`).expect(201);
    expect(a.body.paid_at).not.toBeNull();
    const b = await api.post(`/plan/payments/${id}/mark-paid`).expect(201);
    expect(b.body.paid_at).toBe(a.body.paid_at);
    await api.post(`/plan/payments/9999/mark-paid`).expect(404);
  });
});
