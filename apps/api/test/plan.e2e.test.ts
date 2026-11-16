import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { kyivDate } from "../src/domain/money";
import { PlanService } from "../src/plan/plan.service";
import { Clock } from "../src/time/clock";
import { ReclassifyService } from "../src/transactions/reclassify.service";
import { DayTermCashLoans1795132800000 } from "../src/db/migrations/0019-day-term-cash-loans";

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
/** A row the day cannot have come by honestly: any recompute replaces it. */
const plantSnapshot = (date: string) =>
  ds.query(`INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ($1, 1, 'normal') ON CONFLICT (local_date) DO UPDATE SET daily_limit=1`, [date]);
/** The day was fixed afresh at once (task Б4): its row is there, not the planted one, and it is what the app reads. */
const fixedAfresh = async (date: string) => {
  const r = (await ds.query(`SELECT daily_limit::int AS l FROM daily_snapshots WHERE local_date=$1`, [date]))[0] as { l: number } | undefined;
  expect(r).toBeDefined();
  expect(r!.l).not.toBe(1);
  expect((await api.get("/today").expect(200)).body.state.dailyLimit).toBe(r!.l);
};

afterAll(async () => {
  await app.close();
  await ds.destroy();
});
beforeEach(async () => {
  await ds.query(
    `TRUNCATE jobs, rules, transactions, accounts, fx_rates, income_events, expected_incomes,
              scheduled_payments, recurring_payments, manual_balances, loans, goals RESTART IDENTITY CASCADE`,
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
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', now(), 40)`);
    const t = await tx(acc, { amount: -3_300_000, description: "Partner", date: "2026-11-20", mcc: 4829 });
    await reclassify([t]);
    expect((await row("SELECT type FROM transactions WHERE id=$1", [t])).type).toBe("obligation");
    expect((await row("SELECT transaction_id FROM scheduled_payments WHERE id=$1", [id])).transaction_id).toBe(t);
  });

  it("a spend-typed store installment row closes the installment and is retyped debt_payment", async () => {
    const acc = await account("black");
    const id = (await installment({ match_hint: "skay" }).expect(201)).body.id as number;
    const t = await tx(acc, { amount: -529_500, description: "Платіж skay.ua", mcc: 4829, date: "2026-11-17" });
    await reclassify([t]);
    expect(await row("SELECT type, type_source FROM transactions WHERE id=$1", [t])).toEqual({ type: "debt_payment", type_source: "rule" });
    expect((await row("SELECT transaction_id FROM scheduled_payments WHERE id=$1", [id])).transaction_id).toBe(t);
    await reclassify([t]); // classify says spend again; the link keeps it a debt payment
    expect((await row("SELECT type FROM transactions WHERE id=$1", [t])).type).toBe("debt_payment");
    expect(await ds.query("SELECT 1 FROM scheduled_payments WHERE paid_at IS NOT NULL")).toHaveLength(1);
  });

  it("never retypes an owner-labelled row and ignores unrelated spend", async () => {
    const acc = await account("black");
    await installment();
    const owner = await tx(acc, { amount: -529_500, description: "Платіж skay.ua", mcc: 4829 });
    await ds.query(`UPDATE transactions SET type='spend', type_source='owner' WHERE id=$1`, [owner]);
    const other = await tx(acc, { amount: -100, description: "Coffee", mcc: 5814 });
    await reclassify([owner, other]);
    expect(await ds.query("SELECT 1 FROM scheduled_payments WHERE paid_at IS NOT NULL")).toHaveLength(0);
    expect((await row("SELECT type, type_source FROM transactions WHERE id=$1", [owner]))).toEqual({ type: "spend", type_source: "owner" });
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

describe("tax quarter on payments", () => {
  const tax = { kind: "tax", name: "Levy", amount: 1_000, currency: "UAH" };
  it("takes the form's quarter, else the one before the due date; other kinds have none", async () => {
    const given = await api.post("/plan/payments", { ...tax, due_on: "2026-11-20", tax_quarter: "2026-Q2" }).expect(201);
    expect(given.body).toMatchObject({ tax_quarter: "2026-Q2", is_estimate: false });
    const derived = await api.post("/plan/payments", { ...tax, due_on: "2027-02-20" }).expect(201);
    expect(derived.body.tax_quarter).toBe("2026-Q4");
    const rent = await api.post("/plan/payments", { ...tax, kind: "obligation", due_on: "2027-02-20" }).expect(201);
    expect(rent.body.tax_quarter).toBeNull();
    await api.post("/plan/payments", { ...tax, due_on: "2027-02-20", tax_quarter: "2026-4" }).expect(400);
    await api.post("/plan/payments", { ...tax, due_on: "2027-02-20", is_estimate: true }).expect(400);
  });
  it("a row moved to a quarter by editing also replaces its estimate", async () => {
    await ds.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, tax_quarter, is_estimate)
       VALUES ('tax','Estimate',5,'UAH','2027-02-20','2026-Q4',true)`,
    );
    const id = (await api.post("/plan/payments", { ...tax, due_on: "2026-11-20" }).expect(201)).body.id as number;
    await api.patch(`/plan/payments/${id}`, { amount: 2_000 }).expect(200);
    expect(await ds.query(`SELECT 1 FROM scheduled_payments WHERE is_estimate`)).toHaveLength(1);
    await api.patch(`/plan/payments/${id}`, { tax_quarter: "2026-Q4" }).expect(200);
    expect(await ds.query(`SELECT 1 FROM scheduled_payments WHERE is_estimate`)).toHaveLength(0);
  });
  it("the estimate index allows one estimate per quarter", async () => {
    const add = () =>
      ds.query(
        `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, tax_quarter, is_estimate)
         VALUES ('tax','E',5,'UAH','2027-02-20','2026-Q4',true)`,
      );
    await add();
    await expect(add()).rejects.toThrow(/scheduled_payments_estimate_uq/);
  });
});

describe("repaying and reviewing loans", () => {
  beforeEach(() => ds.query(`UPDATE settings SET tracking_start='2026-01-01'`));
  afterEach(() => ds.query(`UPDATE settings SET tracking_start=CURRENT_DATE`));

  const manual = async (amount: number, received_on = "2026-11-01", note = "друг") =>
    (await api.post("/plan/loans", { amount, received_on, note }).expect(201)).body.id as number;
  const history = async () => (await api.get("/plan/loans/history").expect(200)).body;
  const bank = async (amount: number, description = "Кредит готівкою", date = "2026-11-02", kind = "other") => {
    const a = await account("black");
    const t = await tx(a, { amount, description, date });
    return (await row(
      `INSERT INTO loans (amount, received_on, source_transaction_id, note, kind) VALUES ($1,$2,$3,'loan_in',$4) RETURNING id`,
      [amount, date, t, kind],
    )).id as number;
  };

  it("validates the repayment", async () => {
    const id = await manual(100_000);
    await api.post(`/plan/loans/${id}/repay`, { amount: 0, date: "2026-11-02" }).expect(400);
    await api.post(`/plan/loans/${id}/repay`, { amount: 100, date: "02.11.2026" }).expect(400);
    await api.post(`/plan/loans/999/repay`, { amount: 100, date: "2026-11-02" }).expect(404);
    await api.post(`/plan/loans/${id}/repay`, { amount: 100, date: "2026-10-31" }).expect(422);
    await api.post(`/plan/loans/${id}/repay`, { amount: 100, date: "2099-01-01" }).expect(422);
  });

  it("the full amount closes the loan, on the given date, in the Kyiv day", async () => {
    const id = await manual(100_000);
    await api.post(`/plan/loans/${id}/repay`, { amount: 100_000, date: "2026-11-02" }).expect(201);
    const h = await history();
    expect(h.open).toEqual([]);
    expect(h.repaid).toEqual([
      expect.objectContaining({ id, amount: 100_000, remaining: 0, repaidAmount: 100_000, repaidOn: "2026-11-02", serviceCost: 0, title: "друг", manual: true }),
    ]);
    await api.post(`/plan/loans/${id}/repay`, { amount: 100, date: "2026-11-02" }).expect(409);
  });

  it("less than what is owed keeps the loan open with the rest still owed", async () => {
    const id = await manual(100_000);
    await api.post(`/plan/loans/${id}/repay`, { amount: 30_000, date: "2026-11-02" }).expect(201);
    const h = await history();
    expect(h.repaid).toEqual([]);
    expect(h.open[0]).toMatchObject({ id, remaining: 70_000, repaidAmount: 30_000, repaidOn: null });
    await api.post(`/plan/loans/${id}/repay`, { amount: 70_000, date: "2026-11-02" }).expect(201);
    expect((await history()).repaid[0]).toMatchObject({ id, repaidOn: "2026-11-02", remaining: 0 });
  });

  it("more than what is owed counts the excess as the cost of the loan", async () => {
    const id = await manual(100_000);
    await api.post(`/plan/loans/${id}/repay`, { amount: 115_000, date: "2026-11-02" }).expect(201);
    const h = await history();
    expect(h.repaid[0]).toMatchObject({ repaidAmount: 100_000, serviceCost: 15_000 });
    expect(h.stats).toEqual({ borrowed: 100_000, repaid: 100_000, serviceCost: 15_000, stillOpen: 0 });
  });

  it("a bank loan can be repaid but not deleted, and is titled by its bank row", async () => {
    const id = await bank(300_000);
    await api.post(`/plan/loans/${id}/repay`, { amount: 300_000, date: "2026-11-03" }).expect(201);
    await api.del(`/plan/loans/${id}`).expect(409);
    expect((await history()).repaid[0]).toMatchObject({ id, title: "Кредит готівкою", manual: false });
  });

  it("marking a loan repaid or deleting a mistaken one gives the day a fresh limit at once", async () => {
    const date = kyivDate(new Date());
    const paid = await manual(100_000);
    const wrong = await manual(1_000);
    await plantSnapshot(date);
    await api.post(`/plan/loans/${paid}/repay`, { amount: 100_000, date: "2026-11-02" }).expect(201);
    await fixedAfresh(date);
    await plantSnapshot(date);
    await api.del(`/plan/loans/${wrong}`).expect(200);
    await fixedAfresh(date);
  });

  it("separates loans from before tracking began: not owed in the limit, still reviewable", async () => {
    await ds.query(`UPDATE settings SET tracking_start='2026-11-01'`);
    const old = await manual(50_000, "2026-09-01");
    const current = await manual(70_000, "2026-11-02");
    const h = await history();
    expect(h.old.map((l: { id: number }) => l.id)).toEqual([old]);
    expect(h.open.map((l: { id: number }) => l.id)).toEqual([current]);
    expect(h.stats).toMatchObject({ borrowed: 120_000, stillOpen: 70_000 });
  });

  it("closes every loan from before tracking at once, with no date claimed, and leaves the others", async () => {
    await ds.query(`UPDATE settings SET tracking_start='2026-11-01'`);
    const old = await manual(50_000, "2026-09-01");
    const part = await manual(40_000, "2026-08-01");
    await api.post(`/plan/loans/${part}/repay`, { amount: 10_000, date: "2026-08-02" }).expect(201);
    const current = await manual(70_000, "2026-11-02");
    expect((await api.post("/plan/loans/old/repaid").expect(201)).body).toEqual({ closed: 2 });
    const h = await history();
    expect(h.old).toEqual([]);
    expect(h.open.map((l: { id: number }) => l.id)).toEqual([current]);
    expect(h.repaid).toEqual([
      expect.objectContaining({ id: old, remaining: 0, repaidAmount: 50_000, repaidDateKnown: false }),
      expect.objectContaining({ id: part, remaining: 0, repaidAmount: 40_000, repaidDateKnown: false }),
    ]);
    expect(h.stats).toMatchObject({ borrowed: 160_000, repaid: 90_000, stillOpen: 70_000 });
    expect((await api.post("/plan/loans/old/repaid").expect(201)).body).toEqual({ closed: 0 });
  });

  it("a loan of any kind takes a return date, shows it in the history and can lose it (Б7)", async () => {
    const person = await manual(100_000, "2026-11-01");
    const lender = await bank(300_000);
    expect((await history()).open.map((l: { dueOn: string | null }) => l.dueOn)).toEqual([null, null]);
    await api.patch(`/plan/loans/${person}`, { due_on: "2026-11-20" }).expect(200);
    await api.patch(`/plan/loans/${lender}`, { due_on: "2026-12-01" }).expect(200);
    expect((await history()).open).toEqual([
      expect.objectContaining({ id: lender, dueOn: "2026-12-01" }),
      expect.objectContaining({ id: person, dueOn: "2026-11-20" }),
    ]);
    await api.patch(`/plan/loans/${person}`, { due_on: "20.11.2026" }).expect(400);
    // Not before the day the loan was taken.
    await api.patch(`/plan/loans/${person}`, { due_on: "2026-10-31" }).expect(422);
    await api.patch(`/plan/loans/${person}`, { due_on: null }).expect(200);
    expect((await history()).open.find((l: { id: number }) => l.id === person).dueOn).toBeNull();
  });

  it("a loan's day cannot move past its return date, nor both at once out of order (Б7)", async () => {
    const id = await manual(100_000, "2026-11-01");
    await api.patch(`/plan/loans/${id}`, { due_on: "2026-11-10" }).expect(200);
    await api.patch(`/plan/loans/${id}`, { received_on: "2026-11-11" }).expect(422);
    await api.patch(`/plan/loans/${id}`, { received_on: "2026-11-12", due_on: "2026-11-11" }).expect(422);
    expect((await history()).open[0]).toMatchObject({ receivedOn: "2026-11-01", dueOn: "2026-11-10" });
    await api.patch(`/plan/loans/${id}`, { received_on: "2026-11-05" }).expect(200);
    await api.patch(`/plan/loans/${id}`, { received_on: "2026-11-12", due_on: "2026-11-20" }).expect(200);
    await api.patch(`/plan/loans/${id}`, { due_on: null }).expect(200);
    await api.patch(`/plan/loans/${id}`, { received_on: "2026-11-30" }).expect(200);
  });

  it("a repayment with a date keeps it", async () => {
    const id = await manual(1_000);
    await api.post(`/plan/loans/${id}/repay`, { amount: 1_000, date: "2026-11-02" }).expect(201);
    expect((await history()).repaid[0]).toMatchObject({ repaidOn: "2026-11-02", repaidDateKnown: true });
  });

  it("closing old lender loans moves what their payments covered from cost to principal", async () => {
    await ds.query(`UPDATE settings SET tracking_start='2026-11-01'`);
    await bank(100_000, "Від: Llc Moneyveo", "2026-09-01", "short");
    const a = await account("black");
    const fee = await tx(a, { amount: -112_000, description: "Platon*pgid_commission", date: "2026-09-10" });
    await reclassify([fee]);
    expect((await history()).stats.serviceCost).toBe(112_000);
    await api.post("/plan/loans/old/repaid").expect(201);
    expect((await history()).stats).toMatchObject({ repaid: 100_000, serviceCost: 12_000 });
  });

  it("the cost of loans is interest, penalties, gateway fees and lender repayments beyond the principal", async () => {
    await bank(100_000, "Кредит До завтра на 9 днів", "2026-11-01", "short");
    const a = await account("black");
    const repay = await tx(a, { amount: -112_000, description: "Погашення Кредит До завтра на 9 днів", date: "2026-11-02" });
    const interest = await tx(a, { amount: -3_000, description: "Списання відсотків за жовтень", date: "2026-11-02" });
    const penalty = await tx(a, { amount: -500, description: "Штраф за порушення погашення заборгованості", date: "2026-11-02" });
    const fee = await tx(a, { amount: -2_000, description: "Platon*pgid_commission", date: "2026-11-02" });
    const installment = await tx(a, { amount: -40_000, description: "Платіж розстрочки", date: "2026-11-02" });
    await reclassify([repay, interest, penalty, fee, installment]);
    expect((await history()).stats).toEqual({ borrowed: 100_000, repaid: 100_000, serviceCost: 17_500, stillOpen: 0 });
  });

  it("a day-term cash loan taken and repaid the same day closes by its repayment (Б23)", async () => {
    const a = await account("white");
    const day = "2026-11-14";
    const ids = [
      await tx(a, { amount: 100_000, description: "Кредит готівкою на 4 дні", date: day, mcc: 4829 }),
      await tx(a, { amount: 100_000, description: "Кредит готівкою на 2 дні", date: day, mcc: 4829 }),
      await tx(a, { amount: -100_300, description: "Погашення Кредит готівкою на 4 дні", date: day, mcc: 4829 }),
      await tx(a, { amount: -100_300, description: "Погашення Кредит готівкою на 2 дні", date: day, mcc: 4829 }),
    ];
    // The bank sends the rows one by one, in the order they happened.
    for (const id of ids) await reclassify([id]);
    expect(
      (await ds.query(`SELECT type FROM transactions ORDER BY id`)).map((r: { type: string }) => r.type),
    ).toEqual(["loan_in", "loan_in", "debt_payment", "debt_payment"]);
    expect(
      await ds.query(
        `SELECT source_transaction_id AS t, kind, repaid_amount::int AS repaid, repaid_at IS NOT NULL AS closed FROM loans ORDER BY source_transaction_id`,
      ),
    ).toEqual([
      { t: ids[0], kind: "short", repaid: 100_000, closed: true },
      { t: ids[1], kind: "short", repaid: 100_000, closed: true },
    ]);
    const h = await history();
    expect(h.open).toEqual([]);
    expect(h.stats).toEqual({ borrowed: 200_000, repaid: 200_000, serviceCost: 600, stillOpen: 0 });
    await reclassify(ids);
    expect((await history()).stats).toEqual({ borrowed: 200_000, repaid: 200_000, serviceCost: 600, stillOpen: 0 });
  });

  it("rows reclassified together are taken in the order they happened, whatever order they are given in (Б23)", async () => {
    const a = await account("white");
    const at = async (description: string, amount: number, time: string) => {
      const id = await tx(a, { amount, description, date: "2026-11-14", mcc: 4829 });
      await ds.query(`UPDATE transactions SET occurred_at=$2 WHERE id=$1`, [id, `2026-11-14T${time}:00+02:00`]);
      return id;
    };
    const ids = [
      await at("Кредит готівкою на 4 дні", 100_000, "10:05"),
      await at("Кредит готівкою на 2 дні", 100_000, "18:48"),
      await at("Погашення Кредит готівкою на 4 дні", -100_300, "19:01"),
      await at("Погашення Кредит готівкою на 2 дні", -100_300, "19:02"),
    ];
    await reclassify([...ids].reverse());
    expect(await ds.query(`SELECT kind, repaid_at IS NOT NULL AS closed FROM loans ORDER BY id`)).toEqual([
      { kind: "short", closed: true },
      { kind: "short", closed: true },
    ]);
    expect((await history()).stats).toEqual({ borrowed: 200_000, repaid: 200_000, serviceCost: 600, stillOpen: 0 });
  });

  it("a repayment seen before its loan still closes it on a later pass (Б23)", async () => {
    const a = await account("white");
    const loan = await tx(a, { amount: 100_000, description: "Кредит готівкою на 4 дні", date: "2026-11-14", mcc: 4829 });
    const repay = await tx(a, { amount: -100_300, description: "Погашення Кредит готівкою на 4 дні", date: "2026-11-14", mcc: 4829 });
    await reclassify([repay]);
    await reclassify([loan]);
    expect(await ds.query(`SELECT repaid_at IS NULL AS open FROM loans`)).toEqual([{ open: true }]);
    await reclassify([repay]);
    expect(await ds.query(`SELECT repaid_amount::int AS repaid, repaid_at IS NOT NULL AS closed FROM loans`)).toEqual([
      { repaid: 100_000, closed: true },
    ]);
    await reclassify([repay]);
    expect((await history()).stats).toEqual({ borrowed: 100_000, repaid: 100_000, serviceCost: 300, stillOpen: 0 });
  });

  it("a repayment does not pay a loan taken after it, however often it is read again (Б23)", async () => {
    const a = await account("black");
    const at = async (description: string, amount: number, time: string) => {
      const id = await tx(a, { amount, description, date: "2026-11-14", mcc: 4829 });
      await ds.query(`UPDATE transactions SET occurred_at=$2 WHERE id=$1`, [id, `2026-11-14T${time}:00+02:00`]);
      return id;
    };
    const repay = await at("Погашення Кредит До завтра на 9 днів", -50_300, "10:00");
    const loan = await at("Кредит До завтра на 9 днів", 50_000, "18:00");
    await reclassify([repay]);
    await reclassify([loan]);
    await reclassify([repay]);
    await reclassify([repay, loan]);
    expect(await ds.query(`SELECT repaid_amount::int AS repaid, repaid_at IS NULL AS open FROM loans`)).toEqual([{ repaid: 0, open: true }]);
  });

  it("a cash loan without a day term stays a loan paid monthly: its payment does not close it", async () => {
    const a = await account("white");
    const ids = [
      await tx(a, { amount: 100_000, description: "Кредит готівкою", date: "2026-11-14", mcc: 4829 }),
      await tx(a, { amount: -100_300, description: "Погашення Кредит готівкою", date: "2026-11-14", mcc: 4829 }),
    ];
    for (const id of ids) await reclassify([id]);
    expect(await ds.query(`SELECT kind, repaid_at IS NULL AS open FROM loans`)).toEqual([{ kind: "other", open: true }]);
  });

  it("a lender payment that the owner retyped is not a loan cost", async () => {
    const a = await account("black");
    await tx(a, { amount: -2_000, description: "Platon*pgid_commission", date: "2026-11-02" });
    await ds.query(`UPDATE transactions SET type='spend', type_source='owner'`);
    expect((await history()).stats.serviceCost).toBe(0);
  });
});

describe("editing the plan from the phone", () => {
  const today = () => kyivDate(new Date());
  const monthsAhead = (n: number, day: number) => {
    const t = today();
    const d = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1 + n, 1));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return `${d.toISOString().slice(0, 7)}-${String(Math.min(day, last)).padStart(2, "0")}`;
  };
  const rows = (where = "true") =>
    ds.query(`SELECT name, amount::float8 AS amount, currency, due_on::text AS due_on, paid_at IS NOT NULL AS paid, recurring_id FROM scheduled_payments WHERE ${where} ORDER BY due_on, id`);
  const series = async (over: object = {}) =>
    (await api.post("/plan/recurring", { name: "Квартира", amount: 100_000, currency: "UAH", day_of_month: 28, ...over }).expect(201)).body.id as number;
  const snapshot = () => plantSnapshot(today());
  const refixed = () => fixedAfresh(today());

  beforeEach(() => ds.query(`DELETE FROM daily_snapshots`));

  describe("a monthly payment", () => {
    it("appears in the plan at once", async () => {
      await series();
      expect((await rows()).map((r: { due_on: string }) => r.due_on)).toEqual([monthsAhead(0, 28), monthsAhead(1, 28)]);
    });

    it("a new amount and name reach the unpaid rows, not the paid ones", async () => {
      const id = await series();
      await ds.query(`UPDATE scheduled_payments SET paid_at=now() WHERE due_on=$1`, [monthsAhead(0, 28)]);
      await snapshot();
      await api.patch(`/plan/recurring/${id}`, { amount: 120_000, name: "Аренда" }).expect(200);
      expect(await rows()).toEqual([
        expect.objectContaining({ name: "Квартира", amount: 100_000, paid: true }),
        expect.objectContaining({ name: "Аренда", amount: 120_000, paid: false }),
      ]);
      await refixed();
    });

    it("a new day moves the unpaid rows, within each month", async () => {
      const id = await series();
      await api.patch(`/plan/recurring/${id}`, { day_of_month: 31 }).expect(200);
      expect((await rows()).map((r: { due_on: string }) => r.due_on)).toEqual([monthsAhead(0, 31), monthsAhead(1, 31)]);
    });

    it("deleting it takes away what is unpaid and keeps what was paid", async () => {
      const id = await series();
      await ds.query(`UPDATE scheduled_payments SET paid_at=now() WHERE due_on=$1`, [monthsAhead(0, 28)]);
      await snapshot();
      await api.del(`/plan/recurring/${id}`).expect(200);
      expect(await rows()).toEqual([expect.objectContaining({ due_on: monthsAhead(0, 28), paid: true, recurring_id: null })]);
      await refixed();
      await api.del(`/plan/recurring/${id}`).expect(404);
    });
  });

  describe("a one-off payment", () => {
    it("adding, changing and deleting one gives the day a fresh limit", async () => {
      await snapshot();
      const { id } = (await api.post("/plan/payments", { kind: "obligation", name: "Страховка", amount: 500, currency: "UAH", due_on: monthsAhead(0, 28) }).expect(201)).body as { id: number };
      await refixed();
      await snapshot();
      await api.patch(`/plan/payments/${id}`, { amount: 600 }).expect(200);
      await refixed();
      await snapshot();
      await api.del(`/plan/payments/${id}`).expect(200);
      await refixed();
    });
  });

  describe("an installment", () => {
    const add = (over: object = {}) =>
      api.post("/plan/installments", { name: "Телефон", amount: 200_000, currency: "UAH", remaining: 3, first_due: monthsAhead(1, 31), ...over });

    it("creates its monthly payments, within each month", async () => {
      await add().expect(201);
      expect(await rows()).toEqual([1, 2, 3].map((n) => expect.objectContaining({ name: "Телефон", amount: 200_000, due_on: monthsAhead(n, 31), paid: false })));
      const kinds = await ds.query(`SELECT DISTINCT kind FROM scheduled_payments`);
      expect(kinds).toEqual([{ kind: "installment" }]);
    });

    it("validates", async () => {
      await add({ remaining: 0 }).expect(400);
      await add({ remaining: 121 }).expect(400);
      await add({ name: "" }).expect(400);
      await add({ first_due: "01.02.2027" }).expect(400);
    });

    it("a change reaches the payments still to make", async () => {
      await add().expect(201);
      await ds.query(`UPDATE scheduled_payments SET paid_at=now() WHERE due_on=$1`, [monthsAhead(1, 31)]);
      await snapshot();
      await api.patch(`/plan/installments/${encodeURIComponent("Телефон")}`, { amount: 150_000, name: "iPhone" }).expect(200);
      expect((await rows()).map((r: { name: string; amount: number }) => [r.name, r.amount])).toEqual([["Телефон", 200_000], ["iPhone", 150_000], ["iPhone", 150_000]]);
      await refixed();
    });

    it("deleting takes away the payments still to make and leaves the paid ones", async () => {
      await add().expect(201);
      await ds.query(`UPDATE scheduled_payments SET paid_at=now() WHERE due_on=$1`, [monthsAhead(1, 31)]);
      await api.del(`/plan/installments/${encodeURIComponent("Телефон")}`).expect(200);
      expect(await rows()).toEqual([expect.objectContaining({ paid: true })]);
    });

    it("a name with nothing left to pay is not found, and other kinds with that name stay", async () => {
      await api.post("/plan/payments", { kind: "obligation", name: "Телефон", amount: 500, currency: "UAH", due_on: monthsAhead(0, 28) }).expect(201);
      await api.del(`/plan/installments/${encodeURIComponent("Телефон")}`).expect(404);
      await api.patch(`/plan/installments/${encodeURIComponent("Телефон")}`, { amount: 1 }).expect(404);
      expect(await rows()).toHaveLength(1);
    });
  });

  describe("an expected income", () => {
    const add = async () =>
      (await api.post("/plan/expected-incomes", { source: "fop", amount: 100_000, currency: "UAH", window_start_day: 20, window_end_day: 25 }).expect(201)).body.id as number;
    const events = () => ds.query(`SELECT period, expected_on::text AS d, status FROM income_events ORDER BY period`);

    it("gets its dates at once", async () => {
      await add();
      expect(await events()).toEqual([
        expect.objectContaining({ period: monthsAhead(0, 1).slice(0, 7) }),
        expect.objectContaining({ period: monthsAhead(1, 1).slice(0, 7) }),
      ]);
    });

    it("a new amount gives the day a fresh limit", async () => {
      const id = await add();
      await snapshot();
      await api.patch(`/plan/expected-incomes/${id}`, { amount: 200_000 }).expect(200);
      await refixed();
    });

    it("a change leaves dates the owner set alone", async () => {
      const id = await add();
      const ev = (await ds.query(`SELECT id FROM income_events WHERE period=$1`, [monthsAhead(0, 1).slice(0, 7)]))[0].id as number;
      await api.post(`/plan/incomes/${ev}/date`, { date: monthsAhead(0, 22) }).expect(201);
      await api.patch(`/plan/expected-incomes/${id}`, { amount: 200_000, window_start_day: 5, window_end_day: 10 }).expect(200);
      // Б28: the owner's date stays; the next month's, still the generated one, moves to the window's end.
      expect((await events()).map((e: { d: string }) => e.d)).toEqual([monthsAhead(0, 22), monthsAhead(1, 10)]);
    });

    it("deleting one gives the day a fresh limit", async () => {
      const id = await add();
      await snapshot();
      await api.del(`/plan/expected-incomes/${id}`).expect(200);
      await refixed();
    });
  });
});

describe("day-term cash loans opened before Б23 (migration)", () => {
  beforeEach(() => ds.query(`UPDATE settings SET tracking_start='2026-01-01'`));
  afterEach(() => ds.query(`UPDATE settings SET tracking_start=CURRENT_DATE`));

  const migrate = async () => {
    const q = ds.createQueryRunner();
    try {
      await new DayTermCashLoans1795132800000().up(q);
    } finally {
      await q.release();
    }
  };
  const history = async () => (await api.get("/plan/loans/history").expect(200)).body;
  /** A row as the old code left it: typed, and a loan of the given kind behind a loan_in. */
  const typed = async (a: number, description: string, amount: number, date: string, type: string, time = "10:00") => {
    const id = await tx(a, { amount, description, date, mcc: 4829 });
    await ds.query(`UPDATE transactions SET type=$2, type_source='rule', occurred_at=$3 WHERE id=$1`, [id, type, `${date}T${time}:00+02:00`]);
    return id;
  };
  const loan = async (t: number, amount: number, date: string, kind: string) =>
    (await row(`INSERT INTO loans (amount, received_on, source_transaction_id, note, kind) VALUES ($1,$2,$3,'loan_in',$4) RETURNING id`, [
      amount, date, t, kind,
    ])).id as number;

  it("makes them short and closes them by their own repayments once, leaving other loans alone", async () => {
    const a = await account("white");
    const tomorrow = await loan(await typed(a, "Кредит До завтра на 9 днів", 50_000, "2026-11-10", "loan_in"), 50_000, "2026-11-10", "short");
    const monthly = await loan(await typed(a, "Кредит готівкою", 300_000, "2026-11-05", "loan_in"), 300_000, "2026-11-05", "other");
    const four = await loan(await typed(a, "Кредит готівкою на 4 дні", 100_000, "2026-11-14", "loan_in", "10:05"), 100_000, "2026-11-14", "other");
    const two = await loan(await typed(a, "Кредит готівкою на 2 дні", 100_000, "2026-11-14", "loan_in", "18:48"), 100_000, "2026-11-14", "other");
    await typed(a, "Погашення Кредит готівкою на 4 дні", -100_300, "2026-11-14", "debt_payment", "19:01");
    await typed(a, "Погашення Кредит готівкою на 2 дні", -100_300, "2026-11-14", "debt_payment", "19:02");
    // The owner already closed one by hand: «Погасил» with ₴1,003.
    await api.post(`/plan/loans/${two}/repay`, { amount: 100_300, date: "2026-11-14" }).expect(201);

    await migrate();
    const loans = async () =>
      ds.query(
        `SELECT id, kind, repaid_amount::int AS repaid, repaid_at IS NOT NULL AS closed, service_cost::int AS cost FROM loans ORDER BY id`,
      );
    const after = [
      { id: tomorrow, kind: "short", repaid: 0, closed: false, cost: 0 },
      { id: monthly, kind: "other", repaid: 0, closed: false, cost: 0 },
      { id: four, kind: "short", repaid: 100_000, closed: true, cost: 0 },
      { id: two, kind: "short", repaid: 100_000, closed: true, cost: 0 },
    ];
    expect(await loans()).toEqual(after);
    const stats = { borrowed: 550_000, repaid: 200_000, serviceCost: 600, stillOpen: 350_000 };
    expect((await history()).stats).toEqual(stats);

    // Neither a second run nor the next full reclassify pays the old repayments onto the open loan.
    await migrate();
    await app.get(ReclassifyService).reclassifyPending();
    expect(await loans()).toEqual(after);
    expect((await history()).stats).toEqual(stats);
  });

  it("marks every old day-term repayment done, so one with no loan does not pay another loan later", async () => {
    const a = await account("white");
    const tomorrow = await loan(await typed(a, "Кредит До завтра на 9 днів", 50_000, "2026-11-10", "loan_in"), 50_000, "2026-11-10", "short");
    const four = await loan(await typed(a, "Кредит готівкою на 4 дні", 100_000, "2026-11-14", "loan_in", "10:05"), 100_000, "2026-11-14", "other");
    await typed(a, "Погашення Кредит готівкою на 2 дні", -100_300, "2026-11-12", "debt_payment");
    await typed(a, "Погашення Кредит готівкою на 4 дні", -100_300, "2026-11-14", "debt_payment", "19:01");
    await migrate();
    await app.get(ReclassifyService).reclassifyPending();
    expect(await ds.query(`SELECT id, repaid_amount::int AS repaid, repaid_at IS NOT NULL AS closed FROM loans ORDER BY id`)).toEqual([
      { id: tomorrow, repaid: 0, closed: false },
      { id: four, repaid: 100_000, closed: true },
    ]);
  });

  it("a part the owner repaid by hand, with no bank repayment, stays", async () => {
    const a = await account("white");
    const id = await loan(await typed(a, "Кредит готівкою на 4 дні", 100_000, "2026-11-14", "loan_in"), 100_000, "2026-11-14", "other");
    await api.post(`/plan/loans/${id}/repay`, { amount: 30_000, date: "2026-11-14" }).expect(201);
    await migrate();
    expect(await row(`SELECT kind, repaid_amount::int AS repaid, repaid_at IS NULL AS open FROM loans`)).toEqual({
      kind: "short", repaid: 30_000, open: true,
    });
  });

  it("a loan the owner closed that no bank repayment covers stays closed as he left it", async () => {
    const a = await account("white");
    const id = await loan(await typed(a, "Кредит готівкою на 4 дні", 100_000, "2026-11-14", "loan_in"), 100_000, "2026-11-14", "other");
    await api.post(`/plan/loans/${id}/repay`, { amount: 100_300, date: "2026-11-14" }).expect(201);
    await migrate();
    expect(await row(`SELECT kind, repaid_amount::int AS repaid, repaid_at IS NOT NULL AS closed, service_cost::int AS cost FROM loans`)).toEqual({
      kind: "short", repaid: 100_000, closed: true, cost: 300,
    });
  });
});

describe("loans", () => {
  it("a loan from a bank row cannot be deleted: the next sync would bring it back", async () => {
    const a = await account("black");
    const t = await tx(a, { amount: 300_000, description: "Кредит" });
    const id = await row(`INSERT INTO loans (amount, received_on, source_transaction_id, note, kind) VALUES (300000,'2026-11-02',$1,'loan_in','other') RETURNING id`, [t]);
    await api.del(`/plan/loans/${id.id as number}`).expect(409);
    expect(await ds.query("SELECT 1 FROM loans")).toHaveLength(1);
  });

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

  describe("confirming USDC with the amount that arrived (Б18)", () => {
    const event = async () => {
      await usdc(); // $2,700 expected
      await app.get(PlanService).generateEvents("2026-11-02");
      return (await api.get("/plan/incomes")).body[0].id as number;
    };
    const binance = async () => (await row("SELECT amount::int AS amount FROM manual_balances WHERE name='Binance'"))?.amount;
    const event_uah = async (ev: number) => (await row("SELECT status, amount_uah::int AS amount_uah FROM income_events WHERE id=$1", [ev]));

    it("adds the given amount to Binance, not the expected one, and records it in hryvnias at today's rate", async () => {
      await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', now(), 40)`);
      const ev = await event();
      const r = await api.post(`/plan/incomes/${ev}/confirm`, { amount: 260_000 }).expect(201);
      expect(r.body.status).toBe("received");
      expect(await binance()).toBe(260_000);
      expect(await event_uah(ev)).toEqual({ status: "received", amount_uah: 260_000 * 40 });
    });

    it("without a body still adds the expected amount (an older app)", async () => {
      await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', now(), 40)`);
      const ev = await event();
      await api.post(`/plan/incomes/${ev}/confirm`).expect(201);
      expect(await binance()).toBe(270_000);
      expect(await event_uah(ev)).toEqual({ status: "received", amount_uah: 270_000 * 40 });
    });

    it("a second confirm, with or without another amount, changes nothing", async () => {
      const ev = await event();
      await api.post(`/plan/incomes/${ev}/confirm`, { amount: 260_000 }).expect(201);
      await api.post(`/plan/incomes/${ev}/confirm`, { amount: 100_000 }).expect(201);
      await api.post(`/plan/incomes/${ev}/confirm`).expect(201);
      expect(await binance()).toBe(260_000);
    });

    it("refuses a zero, negative, fractional, huge or non-numeric amount with 400 and touches nothing", async () => {
      const ev = await event();
      for (const amount of [0, -1, 12.5, "2600", 100_000_000_001, null]) {
        await api.post(`/plan/incomes/${ev}/confirm`, { amount }).expect(400);
      }
      await api.post(`/plan/incomes/${ev}/confirm`, { amount: 260_000, extra: 1 }).expect(400);
      expect(await binance()).toBeUndefined();
      expect((await event_uah(ev)).status).toBe("expected");
    });
  });

  it("fop event is received only once incomes reach half the expected amount", async () => {
    await fopIncome(); // $5,000
    await app.get(PlanService).generateEvents("2026-11-02");
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', now(), 40)`); // half = 10_000_000 kop
    const fop = await account("fop", "USD");
    const status = async () => (await row(`SELECT status, amount_uah::int AS amount_uah FROM income_events WHERE period='2026-11'`));
    const small = await tx(fop, { amount: 25_000, description: "From client", date: "2026-11-10", amountUah: 1_000_000 });
    await reclassify([small]);
    expect((await status()).status).toBe("expected");
    const big = await tx(fop, { amount: 200_000, description: "From client", date: "2026-11-17", amountUah: 9_000_000 });
    await reclassify([big]);
    await reclassify([big]);
    expect(await status()).toEqual({ status: "received", amount_uah: 10_000_000 });
    // next month stays untouched
    expect((await row(`SELECT status FROM income_events WHERE period='2026-12'`)).status).toBe("expected");
  });

  it("a fop income cannot be judged without a rate", async () => {
    await fopIncome();
    await app.get(PlanService).generateEvents("2026-11-02");
    const fop = await account("fop", "USD");
    const t = await tx(fop, { amount: 500_000, description: "From client", date: "2026-11-17", amountUah: 21_000_000 });
    await reclassify([t]);
    expect((await row(`SELECT status FROM income_events WHERE period='2026-11'`)).status).toBe("expected");
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

    // Withdrawing in parts: each row lowers the balance by its own amount, once.
    const part = await tx(card, { amount: 400_000, description: "Термінал City24", mcc: 4829 });
    await reclassify([part]);
    await api.post(`/plan/incomes/${ev}/match-transaction`, { transactionId: part }).expect(201);
    await api.post(`/plan/incomes/${ev}/match-transaction`, { transactionId: part }).expect(201);
    expect((await row("SELECT amount::int AS amount FROM manual_balances WHERE name='Binance'")).amount).toBe(160_000);
    expect((await row("SELECT type, usdc_checked FROM transactions WHERE id=$1", [part]))).toEqual({ type: "own_transfer", usdc_checked: true });
    expect((await row("SELECT matched_transaction_id AS m FROM income_events WHERE id=$1", [ev])).m).toBe(t);

    await api.post(`/plan/incomes/${ev}/match-transaction`, { transactionId: 99999 }).expect(404);
    // A row matched to one event cannot be used again for another.
    const nextEvent = (await api.get("/plan/incomes")).body[1].id as number;
    await api.post(`/plan/incomes/${nextEvent}/match-transaction`, { transactionId: t }).expect(409);
  });

  it("never takes the Binance balance below zero", async () => {
    await usdc();
    await app.get(PlanService).generateEvents("2026-11-02");
    const ev = (await api.get("/plan/incomes")).body[0].id as number;
    await api.post(`/plan/incomes/${ev}/confirm`).expect(201);
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', now(), 40)`);
    const t = await tx(await account("black"), { amount: 99_000_000, description: "Термінал City24", mcc: 4829 });
    await reclassify([t]);
    await api.post(`/plan/incomes/${ev}/match-transaction`, { transactionId: t }).expect(201);
    expect((await row("SELECT amount::int AS amount FROM manual_balances WHERE name='Binance'")).amount).toBe(0);
  });

  it("marks a row as not from Binance, and answers 404 for an unknown row", async () => {
    const t = await tx(await account("black"), { amount: 100_000, description: "x" });
    await api.post(`/plan/transactions/${t}/not-usdc`).expect(201);
    await api.post(`/plan/transactions/${t}/not-usdc`).expect(201);
    expect((await row("SELECT usdc_checked FROM transactions WHERE id=$1", [t])).usdc_checked).toBe(true);
    await api.post("/plan/transactions/99999/not-usdc").expect(404);
    await request(http()).post(`/plan/transactions/${t}/not-usdc`).expect(401);
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

describe("recurring payments", () => {
  const rent = { name: "Rent", amount: 1_700_000, currency: "UAH", day_of_month: 31 };

  it("has CRUD", async () => {
    const c = await api.post("/plan/recurring", rent).expect(201);
    expect(c.body).toMatchObject({ name: "Rent", active: true, match_hint: null, kind: "obligation" });
    await api.patch(`/plan/recurring/${c.body.id}`, { active: false }).expect(200);
    expect((await api.get("/plan/recurring")).body[0].active).toBe(false);
    await api.post("/plan/recurring", { ...rent, day_of_month: 32 }).expect(400);
    await api.del(`/plan/recurring/${c.body.id}`).expect(200);
    await api.patch(`/plan/recurring/${c.body.id}`, { active: true }).expect(404);
  });

  it("creates this and next month's payment each run, once, across months and February", async () => {
    const id = (await api.post("/plan/recurring", { ...rent, match_hint: "rent" }).expect(201)).body.id as number;
    await ds.query(`DELETE FROM scheduled_payments`); // the rows for today's real date, made on creation
    const plan = app.get(PlanService);
    const dues = async () =>
      (await ds.query(`SELECT due_on::text AS d FROM scheduled_payments WHERE recurring_id=$1 ORDER BY due_on`, [id])).map(
        (r: { d: string }) => r.d,
      );
    expect(await plan.generateRecurring("2027-01-15")).toBe(2);
    expect(await plan.generateRecurring("2027-01-20")).toBe(0);
    expect(await dues()).toEqual(["2027-01-31", "2027-02-28"]);
    await plan.generateRecurring("2027-02-10");
    await plan.generateRecurring("2027-03-01");
    await plan.generateRecurring("2028-01-30");
    await plan.generateRecurring("2028-02-01");
    expect(await dues()).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2028-01-31", "2028-02-29", "2028-03-31"]);
    const p = (await ds.query(`SELECT name, amount::int AS amount, kind, match_hint FROM scheduled_payments LIMIT 1`))[0];
    expect(p).toEqual({ name: "Rent", amount: 1_700_000, kind: "obligation", match_hint: "rent" });
  });

  it("does not create a current-month payment whose day is already past when the series is first created", async () => {
    const id = (await api.post("/plan/recurring", { ...rent, day_of_month: 10 }).expect(201)).body.id as number;
    await ds.query(`DELETE FROM scheduled_payments`); // the rows for today's real date, made on creation
    const plan = app.get(PlanService);
    const dues = async () =>
      (await ds.query(`SELECT due_on::text AS d FROM scheduled_payments WHERE recurring_id=$1 ORDER BY due_on`, [id])).map(
        (r: { d: string }) => r.d,
      );
    expect(await plan.generateRecurring("2027-01-15")).toBe(1);
    expect(await dues()).toEqual(["2027-02-10"]);
    // later runs are unaffected: next month's row appears as usual
    await plan.generateRecurring("2027-02-01");
    expect(await dues()).toEqual(["2027-02-10", "2027-03-10"]);
  });

  it("skips inactive series", async () => {
    await api.post("/plan/recurring", { ...rent, active: false }).expect(201);
    expect(await app.get(PlanService).generateRecurring("2027-01-15")).toBe(0);
  });

  describe("set up on 16 November (Б29)", () => {
    const now = "2026-11-16";
    const dues = async (id: number) =>
      (await ds.query(`SELECT due_on::text AS d FROM scheduled_payments WHERE recurring_id=$1 ORDER BY due_on`, [id])).map(
        (r: { d: string }) => r.d,
      );
    const create = async (day: number) => (await api.post("/plan/recurring", { ...rent, day_of_month: day }).expect(201)).body.id as number;

    beforeEach(async () => {
      app.get(Clock).fixed = new Date(`${now}T10:00:00Z`);
      await ds.query(`DELETE FROM daily_snapshots`);
    });
    afterEach(() => {
      app.get(Clock).fixed = null;
    });

    it("a day already past this month starts next month, and no later run brings it back as overdue", async () => {
      const id = await create(10);
      expect((await api.get("/plan/recurring")).body[0]).toMatchObject({ id, starts_on: now });
      expect(await dues(id)).toEqual(["2026-12-10"]);
      const plan = app.get(PlanService);
      expect(await plan.generateRecurring()).toBe(0); // the hourly job
      await create(28); // another series: generation runs again for every series
      expect(await dues(id)).toEqual(["2026-12-10"]);
      await plan.generateRecurring("2026-12-01");
      expect(await dues(id)).toEqual(["2026-12-10", "2027-01-10"]);
    });

    it("a day still ahead this month is due this month", async () => {
      const id = await create(20);
      await app.get(PlanService).generateRecurring();
      expect(await dues(id)).toEqual(["2026-11-20", "2026-12-20"]);
    });

    it("a deleted month stays deleted at later runs, and the day is fixed afresh", async () => {
      const id = await create(20);
      const dec = (await ds.query(`SELECT id FROM scheduled_payments WHERE recurring_id=$1 AND due_on='2026-12-20'`, [id]))[0].id as number;
      await plantSnapshot(now);
      await api.del(`/plan/payments/${dec}`).expect(200);
      await fixedAfresh(now);
      const plan = app.get(PlanService);
      expect(await plan.generateRecurring()).toBe(0);
      await create(5);
      await plan.generateRecurring("2026-12-21");
      expect(await dues(id)).toEqual(["2026-11-20", "2027-01-20"]);
      await api.del(`/plan/payments/${dec}`).expect(404);
    });

    it("a payment of no series leaves nothing behind when deleted", async () => {
      const p = (await api.post("/plan/payments", { kind: "obligation", name: "x", amount: 1000, currency: "UAH", due_on: "2026-12-01" }).expect(201)).body.id;
      await api.del(`/plan/payments/${p}`).expect(200);
      expect(await ds.query(`SELECT * FROM recurring_skips`)).toEqual([]);
    });

    it("deleting the series takes its skipped months with it", async () => {
      const id = await create(20);
      const dec = (await ds.query(`SELECT id FROM scheduled_payments WHERE recurring_id=$1 AND due_on='2026-12-20'`, [id]))[0].id as number;
      await api.del(`/plan/payments/${dec}`).expect(200);
      expect(await ds.query(`SELECT recurring_id, due_on::text AS d FROM recurring_skips`)).toEqual([{ recurring_id: id, d: "2026-12-20" }]);
      await api.del(`/plan/recurring/${id}`).expect(200);
      expect(await ds.query(`SELECT * FROM recurring_skips`)).toEqual([]);
      expect(await ds.query(`SELECT * FROM scheduled_payments`)).toEqual([]);
    });
  });
});

describe("goals", () => {
  it("creates, lists in order, updates and deletes", async () => {
    const b = (await api.post("/plan/goals", { name: "Машина", target_cents: 1_000_000, sort: 2 }).expect(201)).body;
    expect(b).toMatchObject({ name: "Машина", target_cents: 1_000_000, saved_cents: 0, sort: 2 });
    const a = (await api.post("/plan/goals", { name: "Подушка", target_cents: 500_000, saved_cents: 50_000, sort: 1 }).expect(201)).body;

    const list = (await api.get("/plan/goals").expect(200)).body as { id: number }[];
    expect(list.map((g) => g.id)).toEqual([a.id, b.id]);

    const patched = (await api.patch(`/plan/goals/${b.id}`, { saved_cents: 25_000 }).expect(200)).body;
    expect(patched).toMatchObject({ saved_cents: 25_000, target_cents: 1_000_000 });

    await api.del(`/plan/goals/${a.id}`).expect(200);
    expect((await api.get("/plan/goals").expect(200)).body).toHaveLength(1);
  });

  it("rejects bad input and unknown ids", async () => {
    await api.post("/plan/goals", { name: "", target_cents: 100 }).expect(400);
    await api.post("/plan/goals", { name: "x", target_cents: 0 }).expect(400);
    await api.post("/plan/goals", { name: "x", target_cents: 100, saved_cents: -1 }).expect(400);
    await api.post("/plan/goals", { name: "x", target_cents: 100, extra: 1 }).expect(400);
    await api.patch("/plan/goals/999", { saved_cents: 1 }).expect(404);
    await api.del("/plan/goals/999").expect(404);
  });
});
