import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { ImportService } from "../src/mono/import.service";
import { PlanService } from "../src/plan/plan.service";
import { Clock } from "../src/time/clock";
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
              scheduled_payments, recurring_payments, manual_balances, loans RESTART IDENTITY CASCADE`,
  );
});

async function account(kind = "black", currency = "UAH"): Promise<number> {
  seq++;
  return (
    await ds.query(
      `INSERT INTO accounts (external_id, kind, currency, balance) VALUES ($1,$2,$3,5000000) RETURNING id`,
      [`acc-${seq}`, kind, currency],
    )
  )[0].id;
}

interface TxOver {
  amount?: number;
  description?: string;
  at?: string;
  type?: string | null;
  source?: string | null;
  needsLabel?: boolean;
  iban?: string | null;
  name?: string | null;
  amountUah?: number | null;
  fxRate?: number | null;
  category?: string | null;
  mcc?: number | null;
}
async function tx(accountId: number, o: TxOver = {}): Promise<number> {
  seq++;
  const at = o.at ?? "2026-11-18T10:00:00.000Z";
  return (
    await ds.query(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, fx_rate,
                                 counter_iban, counter_name, type, category, type_source, needs_label, mcc, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'{"secret":"raw"}') RETURNING id`,
      [
        `tx-${seq}`, accountId, at, at.slice(0, 10), o.description ?? "Shop", o.amount ?? -10_000,
        o.amountUah === undefined ? (o.amount ?? -10_000) : o.amountUah, o.fxRate ?? null,
        o.iban ?? null, o.name ?? null, o.type === undefined ? "spend" : o.type, o.category ?? null,
        o.source === undefined ? "auto" : o.source, o.needsLabel ?? false, o.mcc ?? null,
      ],
    )
  )[0].id;
}
const row = async (sql: string, args: unknown[] = []) => (await ds.query(sql, args))[0];
const IBAN = "UA990000000000000000000000001";

describe("GET /transactions", () => {
  it("requires auth and validates the query", async () => {
    await request(http()).get("/transactions").expect(401);
    await api.get("/transactions?limit=201").expect(400);
    await api.get("/transactions?limit=0").expect(400);
    await api.get("/transactions?type=nope").expect(400);
    await api.get("/transactions?cursor=garbage").expect(400);
    const huge = Buffer.from("2026-11-18T10:00:00.000000|3000000000").toString("base64url");
    await api.get(`/transactions?cursor=${huge}`).expect(400);
    await api.get("/transactions?needsLabel=maybe").expect(400);
  });

  it("validates group and q", async () => {
    await api.get("/transactions?group=nope").expect(400);
    await api.get("/transactions?q=").expect(400);
    await api.get(`/transactions?q=${"x".repeat(101)}`).expect(400);
  });

  it("group spend and income leave transfers between own accounts only under all", async () => {
    const a = await account();
    const spendTypes = ["spend", "obligation", "tax", "debt_payment", "person_transfer", "cash_out", "loan_out"];
    const incomeTypes = ["income", "person_in", "cash_in"];
    const onlyAll = ["own_transfer", "loan_in", "goal_contribution", null];
    for (const type of [...spendTypes, ...incomeTypes, ...onlyAll]) await tx(a, { type, description: `t:${type}` });
    const types = async (q: string) =>
      ((await api.get(`/transactions${q}`).expect(200)).body.items as { type: string | null }[]).map((t) => t.type);
    expect((await types("?group=spend")).sort()).toEqual([...spendTypes].sort());
    expect((await types("?group=income")).sort()).toEqual([...incomeTypes].sort());
    expect(await types("?group=all")).toHaveLength(14);
    expect(await types("")).toHaveLength(14);
  });

  it("q searches description and counterparty, with % and _ taken literally", async () => {
    const a = await account();
    // Cyrillic case folding depends on the database locale (production folds, the test database may not).
    await tx(a, { description: "Крем Кафе" });
    await tx(a, { description: "Переказ", name: "Кафе Ліда" });
    await tx(a, { description: "Uklon" });
    await tx(a, { description: "АТБ" });
    await tx(a, { description: "100% sale" });
    await tx(a, { description: "1000 sale" });
    const found = async (q: string) =>
      ((await api.get(`/transactions?q=${encodeURIComponent(q)}`).expect(200)).body.items as { description: string }[])
        .map((t) => t.description)
        .sort();
    expect(await found(" Кафе ")).toEqual(["Крем Кафе", "Переказ"]);
    expect(await found("UKLON")).toEqual(["Uklon"]);
    expect(await found("100%")).toEqual(["100% sale"]);
    expect(await found("1_0")).toEqual([]);
    expect(await found("'; DROP TABLE transactions; --")).toEqual([]);
  });

  it("dayTotals covers a whole day split across pages, under the same filters", async () => {
    const a = await account();
    await tx(a, { at: "2026-11-10T12:00:00.000Z", amount: -100 });
    await tx(a, { at: "2026-11-10T11:00:00.000Z", amount: -200 });
    await tx(a, { at: "2026-11-10T10:00:00.000Z", amount: -400 });
    await tx(a, { at: "2026-11-10T09:00:00.000Z", amount: -9000, type: "own_transfer" });
    await tx(a, { at: "2026-11-10T08:00:00.000Z", amount: -5000, amountUah: null });
    await tx(a, { at: "2026-11-09T10:00:00.000Z", amount: -800 });

    const first = await api.get("/transactions?group=spend&limit=2").expect(200);
    expect(first.body.dayTotals).toEqual({ "2026-11-10": -700 });
    const second = await api.get(`/transactions?group=spend&limit=2&cursor=${first.body.nextCursor as string}`).expect(200);
    expect(second.body.dayTotals["2026-11-10"]).toBe(-700);
    const all = await api.get("/transactions?group=all&limit=1").expect(200);
    expect(all.body.dayTotals).toEqual({ "2026-11-10": -9700 });
  });

  it("under «Траты» the day total and the summary are what counted against the limit; the rest is listed and marked (Б2)", async () => {
    const a = await account();
    await tx(a, { at: "2026-11-10T12:00:00.000Z", amount: -100, description: "Cafe" });
    await tx(a, { at: "2026-11-10T11:00:00.000Z", amount: -2000, type: "obligation", description: "Rent" });
    await tx(a, { at: "2026-11-10T10:00:00.000Z", amount: -3000, type: "tax", description: "Tax" });
    await tx(a, { at: "2026-11-09T10:00:00.000Z", amount: -4000, type: "debt_payment", description: "Debt" });
    const page = await api.get("/transactions?group=spend&from=2026-11-09&to=2026-11-10").expect(200);
    const items = page.body.items as { description: string; inLimit: boolean }[];
    expect(items.map((i) => [i.description, i.inLimit])).toEqual([["Cafe", true], ["Rent", false], ["Tax", false], ["Debt", false]]);
    // The day of the debt payment alone has no total: nothing on it counted.
    expect(page.body.dayTotals).toEqual({ "2026-11-10": -100 });
    expect(page.body.summary).toEqual({ total: -100, count: 1 });
    // «Все» keeps the plain sum and count over everything listed.
    const all = await api.get("/transactions?group=all&from=2026-11-09&to=2026-11-10").expect(200);
    expect(all.body.dayTotals).toEqual({ "2026-11-10": -5100, "2026-11-09": -4000 });
    expect(all.body.summary).toEqual({ total: -9100, count: 4 });
    expect((all.body.items as { inLimit: boolean }[]).map((i) => i.inLimit)).toEqual([true, false, false, false]);
  });

  it("dayTotals leaves out a day whose rows all have no known rate, instead of showing zero", async () => {
    const a = await account();
    await tx(a, { at: "2026-11-10T08:00:00.000Z", amount: -5000, amountUah: null });
    const page = await api.get("/transactions?group=spend").expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.dayTotals).toEqual({});
  });

  it("dayTotals is empty for an empty page", async () => {
    const page = await api.get("/transactions?group=spend").expect(200);
    expect(page.body).toMatchObject({ items: [], dayTotals: {}, nextCursor: null });
  });

  it("pages newest first without gaps or repeats while new rows arrive", async () => {
    const a = await account();
    const ids: number[] = [];
    for (let i = 0; i < 7; i++) {
      // Rows 3 and 4 share a timestamp: the id breaks the tie.
      const minute = i === 4 ? 3 : i;
      ids.push(await tx(a, { at: `2026-11-10T10:0${minute}:00.000Z`, description: `d${i}` }));
    }
    const first = await api.get("/transactions?limit=3").expect(200);
    expect(first.body.items).toHaveLength(3);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    // Newer rows land between the two requests; older pages must not shift.
    await tx(a, { at: "2026-11-11T10:00:00.000Z", description: "new1" });
    await tx(a, { at: "2026-11-12T10:00:00.000Z", description: "new2" });

    const seen: number[] = first.body.items.map((i: { id: number }) => i.id);
    let cursor: string | null = first.body.nextCursor;
    while (cursor) {
      const page = await api.get(`/transactions?limit=3&cursor=${encodeURIComponent(cursor)}`).expect(200);
      seen.push(...page.body.items.map((i: { id: number }) => i.id));
      cursor = page.body.nextCursor;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort((x, y) => x - y)).toEqual([...ids].sort((x, y) => x - y));
    // Descending by (occurred_at, id).
    expect(seen).toEqual([ids[6], ids[5], ids[4], ids[3], ids[2], ids[1], ids[0]].filter(Boolean));
  });

  it("defaults to 50 rows and filters by type and needsLabel", async () => {
    const a = await account();
    for (let i = 0; i < 55; i++) await tx(a, { at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() });
    const all = await api.get("/transactions").expect(200);
    expect(all.body.items).toHaveLength(50);
    const cash = await tx(a, { type: "cash_out", needsLabel: true, at: "2026-10-01T00:00:00.000Z" });
    const only = await api.get("/transactions?type=cash_out").expect(200);
    expect(only.body.items.map((i: { id: number }) => i.id)).toEqual([cash]);
    const nl = await api.get("/transactions?needsLabel=true").expect(200);
    expect(nl.body.items.map((i: { id: number }) => i.id)).toEqual([cash]);
    const nn = await api.get("/transactions?needsLabel=false&limit=200").expect(200);
    expect(nn.body.items).toHaveLength(55);
  });

  it("returns the documented fields, with no IBAN and no raw", async () => {
    const a = await account("fop");
    await tx(a, { iban: IBAN, name: "Ivan P", description: "Переказ", type: "person_transfer", needsLabel: true });
    await tx(a, { iban: IBAN, name: "Ivan P", description: "Переказ 2", type: "person_transfer" });
    const res = await api.get("/transactions").expect(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(IBAN);
    expect(text).not.toContain("secret");
    const [x, y] = res.body.items;
    expect(Object.keys(x).sort()).toEqual(
      [
        "accountKind", "amount", "cashAnswer", "cashOut", "amountUah", "category", "counterKey", "counterName", "currency", "description",
        "creditPart", "fxRate", "hold", "id", "inLimit", "localDate", "manual", "needsLabel", "occurredAt", "paymentName", "recipientLabel",
        "type", "exchange", "want", "wantOverride",
      ].sort(),
    );
    expect(x).toMatchObject({ accountKind: "fop", currency: "UAH", counterName: "Ivan P", hold: false, manual: false });
    expect(x.counterKey).toMatch(/^[0-9a-f]{16}$/);
    expect(x.counterKey).toBe(y.counterKey);
    expect(x.occurredAt).toBe("2026-11-18T10:00:00.000Z");
  });

  it("says how much of a spend came from the credit limit, only where the limit at the time was stored", async () => {
    const a = await account("black");
    const usd = await account("white", "USD");
    const credit = async (id: number, balanceAfter: number | null, limitAt: number | null) =>
      ds.query("UPDATE transactions SET balance_after=$2, credit_limit_at=$3 WHERE id=$1", [id, balanceAfter, limitAt]);
    // A ₴20,000 limit. ₴700 of own money, ₴1,800 spent: ₴1,100 from the limit.
    const partly = await tx(a, { amount: -180_000, description: "Rozetka" });
    await credit(partly, 1_890_000, 2_000_000);
    const wholly = await tx(a, { amount: -16_000, description: "Uklon" });
    await credit(wholly, 1_874_000, 2_000_000);
    const own = await tx(a, { amount: -42_000, description: "Silpo" });
    await credit(own, 2_500_000, 2_000_000);
    const old = await tx(a, { amount: -16_000, description: "Old" });
    await credit(old, 1_874_000, null);
    const foreign = await tx(usd, { amount: -1_000, amountUah: -41_000, fxRate: 41, description: "Foreign" });
    await credit(foreign, -500, 2_000_000);
    const items = (await api.get("/transactions?limit=50").expect(200)).body.items as { id: number; creditPart: number | null }[];
    const part = (id: number) => items.find((i) => i.id === id)!.creditPart;
    expect(part(partly)).toBe(110_000);
    expect(part(wholly)).toBe(16_000);
    expect(part(own)).toBeNull();
    expect(part(old)).toBeNull();
    expect(part(foreign)).toBeNull();
  });

  it("derives the same key for the same normalised name without an IBAN", async () => {
    const a = await account();
    await tx(a, { name: "  Ivan   P ", description: "x" });
    await tx(a, { name: "ivan p", description: "y" });
    await tx(a, { name: null, description: "Uklon  Ride" });
    await tx(a, { name: null, description: "uklon ride" });
    const r = (await api.get("/transactions").expect(200)).body.items as { counterKey: string; description: string }[];
    const key = (d: string) => r.find((i) => i.description === d)!.counterKey;
    expect(key("x")).toBe(key("y"));
    expect(key("Uklon  Ride")).toBe(key("uklon ride"));
    expect(key("x")).not.toBe(key("uklon ride"));
  });

  it("shows a dollar operation with its stored hryvnia amount and rate, unaffected by new rates", async () => {
    const a = await account("black", "USD");
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD','2026-11-18T08:00:00Z',41.25)`);
    await tx(a, { amount: -2_000, amountUah: -82_500, fxRate: 41.25, description: "Netflix" });
    const before = (await api.get("/transactions").expect(200)).body.items[0];
    expect(before).toMatchObject({ currency: "USD", amount: -2_000, amountUah: -82_500, fxRate: 41.25 });
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD','2026-11-19T08:00:00Z',45)`);
    const after = (await api.get("/transactions").expect(200)).body.items[0];
    expect(after).toEqual(before);
  });
});

describe("PATCH /transactions/:id", () => {
  it("validates the body and the id", async () => {
    const a = await account();
    const t = await tx(a);
    await api.patch(`/transactions/${t}`, {}).expect(400);
    await api.patch(`/transactions/${t}`, { type: "nope" }).expect(400);
    await api.patch(`/transactions/${t}`, { type: "spend", extra: 1 }).expect(400);
    await api.patch(`/transactions/abc`, { type: "spend" }).expect(400);
    await api.patch(`/transactions/9999`, { type: "spend" }).expect(404);
  });

  it("retypes one row as owner and clears needs_label", async () => {
    const a = await account();
    const t = await tx(a, { type: "person_transfer", needsLabel: true, name: "Ivan", category: "transfer" });
    const res = await api.patch(`/transactions/${t}`, { type: "cash_out" }).expect(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.transaction).toMatchObject({ id: t, type: "cash_out", category: "cash", needsLabel: false });
    expect(await row("SELECT type_source, needs_label FROM transactions WHERE id=$1", [t])).toEqual({
      type_source: "owner",
      needs_label: false,
    });
    expect((await row("SELECT count(*)::int AS n FROM rules")).n).toBe(0);
  });

  it("applyToSimilar stores a rule, retypes past matches, and the reconcile never undoes it", async () => {
    const a = await account();
    const b = await account("white");
    const t = await tx(a, { description: "Uklon", at: "2026-11-01T10:00:00.000Z" });
    const same = await tx(a, { description: "  UKLON ", at: "2026-10-01T10:00:00.000Z" });
    const sameKeyOtherAccount = await tx(b, { description: "uklon", at: "2026-09-01T10:00:00.000Z" });
    const other = await tx(a, { description: "Bolt", at: "2026-10-05T10:00:00.000Z" });
    const res = await api.patch(`/transactions/${t}`, { type: "person_transfer", applyToSimilar: true }).expect(200);
    expect(res.body.updated).toBe(3);
    const rules = await ds.query(`SELECT match_kind, match_value, type, direction FROM rules`);
    expect(rules).toEqual([{ match_kind: "merchant", match_value: "uklon", type: "person_transfer", direction: "out" }]);
    for (const id of [t, same, sameKeyOtherAccount]) {
      expect(await row("SELECT type, type_source FROM transactions WHERE id=$1", [id])).toEqual({
        type: "person_transfer",
        type_source: "owner",
      });
    }
    expect((await row("SELECT type, type_source FROM transactions WHERE id=$1", [other])).type).toBe("spend");

    // A full reclassify pass (reconcile) leaves owner rows alone.
    await app.get(ReclassifyService).reclassifyPending();
    expect((await row("SELECT type, type_source FROM transactions WHERE id=$1", [same])).type_source).toBe("owner");
    expect((await row("SELECT type FROM transactions WHERE id=$1", [t])).type).toBe("person_transfer");

    // A new row of the same merchant picks up the rule through classify; a longer name is another shop (Б37).
    const later = await tx(a, { description: " Uklon  ", type: null, source: null, at: "2026-11-20T10:00:00.000Z" });
    const longer = await tx(a, { description: "UKLON ride", type: null, source: null, at: "2026-11-20T11:00:00.000Z" });
    await app.get(ReclassifyService).reclassifyIds([later, longer]);
    expect(await row("SELECT type, type_source FROM transactions WHERE id=$1", [later])).toEqual({
      type: "person_transfer",
      type_source: "rule",
    });
    expect((await row("SELECT type_source FROM transactions WHERE id=$1", [longer])).type_source).not.toBe("rule");
  });

  it("applyToSimilar matches rows by counterKey (same IBAN) and keeps an iban rule", async () => {
    const a = await account("fop");
    const t = await tx(a, { iban: IBAN, name: "Ivan P", description: "one", type: "person_transfer", needsLabel: true });
    const same = await tx(a, { iban: IBAN, name: "Ivan Petrov", description: "two", type: "person_transfer", needsLabel: true });
    const other = await tx(a, { iban: "UA000000000000000000000000001", name: "Ivan P", description: "three", type: "person_transfer" });
    const res = await api.patch(`/transactions/${t}`, { type: "spend", applyToSimilar: true }).expect(200);
    expect(res.body.updated).toBe(2);
    expect(await ds.query(`SELECT match_kind, match_value FROM rules`)).toEqual([{ match_kind: "iban", match_value: IBAN }]);
    expect((await row("SELECT type, type_source, needs_label FROM transactions WHERE id=$1", [same]))).toEqual({
      type: "spend",
      type_source: "owner",
      needs_label: false,
    });
    expect((await row("SELECT type FROM transactions WHERE id=$1", [other])).type).toBe("person_transfer");
  });

  it("replaces an older rule for the same merchant", async () => {
    const a = await account();
    const t = await tx(a, { description: "Uklon" });
    await api.patch(`/transactions/${t}`, { type: "cash_out", applyToSimilar: true }).expect(200);
    await api.patch(`/transactions/${t}`, { type: "spend", category: "transport", applyToSimilar: true }).expect(200);
    expect(await ds.query(`SELECT match_value, type, category FROM rules`)).toEqual([
      { match_value: "uklon", type: "spend", category: "transport" },
    ]);
  });

  it("an owner retype to obligation closes the planned payment", async () => {
    const a = await account();
    await ds.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation','Rent',1700000,'UAH','2026-11-18')`,
    );
    const t = await tx(a, { amount: -1_700_000, description: "Landlord" });
    await api.patch(`/transactions/${t}`, { type: "obligation" }).expect(200);
    const p = await row(`SELECT paid_at, transaction_id FROM scheduled_payments`);
    expect(p.transaction_id).toBe(t);
    expect(p.paid_at).not.toBeNull();
  });

  it("an owner retype to debt_payment closes a planned installment", async () => {
    const a = await account();
    await ds.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('installment','KTC',250000,'UAH','2026-11-19')`,
    );
    const t = await tx(a, { amount: -250_000, description: "Payment" });
    await api.patch(`/transactions/${t}`, { type: "debt_payment" }).expect(200);
    expect((await row(`SELECT transaction_id FROM scheduled_payments`)).transaction_id).toBe(t);
  });

  it("rejects a category-only rule for a row without a type", async () => {
    const a = await account();
    const t = await tx(a, { type: null, source: null });
    await api.patch(`/transactions/${t}`, { category: "taxi", applyToSimilar: true }).expect(422);
  });
});

describe("«нужное» и «желаемое» of one operation (В6)", () => {
  it("each row says its side: the category's, or its own when the owner chose one", async () => {
    const a = await account();
    const cafe = await tx(a, { category: "cafe", description: "Cafe" });
    const food = await tx(a, { category: "groceries", description: "Food" });
    const refund = await tx(a, { category: "refund", amount: 5_000, description: "Back" });
    const person = await tx(a, { type: "person_transfer", category: "people", description: "Ivan" });
    await ds.query(`UPDATE transactions SET want_override = true WHERE id = $1`, [food]);
    const items = (await api.get("/transactions").expect(200)).body.items as { id: number; want: boolean | null; wantOverride: boolean | null }[];
    const side = (id: number) => items.find((i) => i.id === id)!;
    expect(side(cafe)).toMatchObject({ want: true, wantOverride: null });
    expect(side(food)).toMatchObject({ want: true, wantOverride: true });
    expect(side(refund)).toMatchObject({ want: null, wantOverride: null });
    expect(side(person)).toMatchObject({ want: null, wantOverride: null });
  });

  it("moves one purchase to the other side and back to its category's, changing nothing else", async () => {
    const a = await account();
    const t = await tx(a, { category: "shopping", needsLabel: true });
    const other = await tx(a, { category: "shopping" });
    const res = await api.patch(`/transactions/${t}`, { want: false }).expect(200);
    expect(res.body).toMatchObject({ updated: 1, transaction: { id: t, category: "shopping", want: false, wantOverride: false } });
    expect(await row(`SELECT type, category, type_source, needs_label, want_override FROM transactions WHERE id=$1`, [t])).toEqual({
      type: "spend", category: "shopping", type_source: "auto", needs_label: true, want_override: false,
    });
    expect(await row(`SELECT want_override FROM transactions WHERE id=$1`, [other])).toEqual({ want_override: null });
    expect((await api.patch(`/transactions/${t}`, { want: null }).expect(200)).body.transaction).toMatchObject({ want: true, wantOverride: null });
  });

  it("takes a side together with a new category, checked against the new one", async () => {
    const a = await account();
    const t = await tx(a, { category: "refund", amount: -3_000 });
    await api.patch(`/transactions/${t}`, { want: true }).expect(422);
    const res = await api.patch(`/transactions/${t}`, { category: "groceries", want: true }).expect(200);
    expect(res.body.transaction).toMatchObject({ category: "groceries", want: true, wantOverride: true });
    await api.patch(`/transactions/${t}`, { category: "uncategorized", want: false }).expect(422);
    expect(await row(`SELECT category, want_override FROM transactions WHERE id=$1`, [t])).toEqual({ category: "groceries", want_override: true });
  });

  it("refuses a side for what is no purchase in a category with a side, and with applyToSimilar", async () => {
    const a = await account();
    const person = await tx(a, { type: "person_transfer", category: "people" });
    const empty = await tx(a, { category: null });
    const cafe = await tx(a, { category: "cafe" });
    await api.patch(`/transactions/${person}`, { want: true }).expect(422);
    await api.patch(`/transactions/${empty}`, { want: true }).expect(422);
    await api.patch(`/transactions/${cafe}`, { type: "obligation", want: true }).expect(422);
    await api.patch(`/transactions/${cafe}`, { want: false, applyToSimilar: true }).expect(400);
    await api.patch(`/transactions/${cafe}`, { want: "no" }).expect(400);
    const cash = await tx(await account("cash"), { category: "cafe" });
    await api.patch(`/transactions/${cash}`, { want: false }).expect(422);
    expect(await ds.query(`SELECT DISTINCT want_override FROM transactions`)).toEqual([{ want_override: null }]);
    expect(await row(`SELECT type FROM transactions WHERE id=$1`, [cafe])).toEqual({ type: "spend" });
  });
});

describe("POST /recipients/label", () => {
  async function recipient() {
    const a = await account();
    const t1 = await tx(a, { name: "Olena K", description: "Переказ", type: "person_transfer", needsLabel: true, amount: -80_000, at: "2026-11-05T10:00:00.000Z" });
    const t2 = await tx(a, { name: "Olena K", description: "Переказ", type: "person_transfer", needsLabel: true, amount: -50_000, at: "2026-08-05T10:00:00.000Z" });
    const unrelated = await tx(a, { name: "Petro", description: "Переказ", type: "person_transfer", needsLabel: true });
    const items = (await api.get("/transactions").expect(200)).body.items as { id: number; counterKey: string }[];
    return { a, t1, t2, unrelated, key: items.find((i) => i.id === t1)!.counterKey };
  }

  it("validates the body and the key", async () => {
    await api.post("/recipients/label", { counterKey: "zz", label: "help" }).expect(400);
    await api.post("/recipients/label", { counterKey: "0123456789abcdef", label: "bad" }).expect(400);
    await api.post("/recipients/label", { counterKey: "0123456789abcdef", label: "help" }).expect(404);
  });

  it("applies the label to the whole history and removes the question", async () => {
    const { t1, t2, unrelated, key } = await recipient();
    const before = await api.get("/today").expect(200);
    const q = before.body.questions.filter((x: { kind: string }) => x.kind === "recipient_label");
    expect(q.map((x: { id: string }) => x.id)).toContain(`recipient_label:${key}`);

    const res = await api.post("/recipients/label", { counterKey: key, label: "help" }).expect(201);
    expect(res.body).toEqual({ updated: 2 });
    for (const id of [t1, t2]) {
      expect(await row("SELECT type, category, type_source, needs_label FROM transactions WHERE id=$1", [id])).toEqual({
        type: "person_transfer",
        category: "transfer",
        type_source: "owner",
        needs_label: false,
      });
    }
    expect((await row("SELECT needs_label FROM transactions WHERE id=$1", [unrelated])).needs_label).toBe(true);
    expect(await ds.query(`SELECT match_kind, match_value, type, label FROM rules`)).toEqual([
      { match_kind: "recipient", match_value: "olena k", type: "person_transfer", label: "help" },
    ]);

    const after = await api.get("/today").expect(200);
    const ids = after.body.questions.map((x: { id: string }) => x.id);
    expect(ids).not.toContain(`recipient_label:${key}`);
    expect(ids.filter((i: string) => i.startsWith("recipient_label:"))).toHaveLength(1);
  });

  it("maps labels to types: debt_repayment and obligation", async () => {
    const r1 = await recipient();
    await api.post("/recipients/label", { counterKey: r1.key, label: "debt_repayment" }).expect(201);
    expect((await row("SELECT type FROM transactions WHERE id=$1", [r1.t1])).type).toBe("debt_payment");
    await api.post("/recipients/label", { counterKey: r1.key, label: "obligation" }).expect(201);
    expect((await row("SELECT type, category FROM transactions WHERE id=$1", [r1.t2]))).toEqual({
      type: "obligation",
      category: "transfer",
    });
    // Relabelling replaces the earlier rule instead of stacking.
    expect((await row("SELECT count(*)::int AS n FROM rules")).n).toBe(1);
  });

  it("a later row from the labelled recipient is typed by the rule", async () => {
    const { a, key } = await recipient();
    await api.post("/recipients/label", { counterKey: key, label: "one_off" }).expect(201);
    const later = await tx(a, { name: "Olena K", description: "Переказ", type: null, source: null, at: "2026-11-25T10:00:00.000Z" });
    await app.get(ReclassifyService).reclassifyIds([later]);
    expect(await row("SELECT type, needs_label FROM transactions WHERE id=$1", [later])).toEqual({
      type: "person_transfer",
      needs_label: false,
    });
  });

  it("an obligation label closes the month's planned payment", async () => {
    const { t1, key } = await recipient();
    await ds.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation','Support',80000,'UAH','2026-11-05')`,
    );
    await api.post("/recipients/label", { counterKey: key, label: "obligation" }).expect(201);
    expect((await row(`SELECT transaction_id FROM scheduled_payments`)).transaction_id).toBe(t1);
  });
});

describe("answers about a transfer", () => {
  async function person(over: { name?: string; iban?: string | null } = {}) {
    const a = await account();
    const name = over.name ?? "Olena K";
    const iban = over.iban ?? null;
    const t1 = await tx(a, { name, iban, description: "Переказ", type: "person_transfer", needsLabel: true, amount: -80_000, at: "2026-11-05T10:00:00.000Z" });
    const t2 = await tx(a, { name, iban, description: "Переказ", type: "person_transfer", needsLabel: true, amount: -50_000, at: "2026-08-05T10:00:00.000Z" });
    const items = (await api.get("/transactions").expect(200)).body.items as { id: number; counterKey: string }[];
    return { a, t1, t2, key: items.find((i) => i.id === t1)!.counterKey };
  }
  const answer = (key: string, label: string) => api.post("/recipients/label", { counterKey: key, label }).expect(201);
  const typeOf = async (id: number) => (await row("SELECT type FROM transactions WHERE id=$1", [id])).type as string;

  it.each([
    ["close_regular", "person_transfer"],
    ["one_off", "person_transfer"],
    ["service", "spend"],
    ["debt_repayment", "debt_payment"],
    ["lend", "loan_out"],
    ["own_account", "own_transfer"],
    ["skip", "person_transfer"],
  ])("%s gives every transfer the type %s and is not asked again", async (label, type) => {
    const { t1, t2, key } = await person();
    await answer(key, label);
    expect(await typeOf(t1)).toBe(type);
    expect(await typeOf(t2)).toBe(type);
    expect((await row("SELECT needs_label FROM transactions WHERE id=$1", [t1])).needs_label).toBe(false);
  });

  it("can be changed: the new answer replaces the old one, whatever the rows became", async () => {
    const { t1, key } = await person();
    for (const [label, type] of [["service", "spend"], ["lend", "loan_out"], ["own_account", "own_transfer"], ["one_off", "person_transfer"]] as const) {
      await answer(key, label);
      expect(await typeOf(t1)).toBe(type);
    }
    expect(await ds.query("SELECT label FROM rules")).toEqual([{ label: "one_off" }]);
  });

  it("a later transfer follows the answer", async () => {
    const { a, key } = await person();
    await answer(key, "skip");
    const later = await tx(a, { name: "Olena K", description: "Переказ", type: null, source: null, at: "2026-11-25T10:00:00.000Z" });
    await app.get(ReclassifyService).reclassifyIds([later]);
    expect(await row("SELECT type, needs_label FROM transactions WHERE id=$1", [later])).toEqual({ type: "person_transfer", needs_label: false });
  });

  it("a known account number carries the answer to transfers with only a bank text", async () => {
    const { a, key } = await person({ iban: "UA00PERSON" });
    await answer(key, "lend");
    const later = await tx(a, { name: "Переказ на картку", iban: "UA00PERSON", description: "Переказ", type: null, source: null, at: "2026-11-25T10:00:00.000Z" });
    await app.get(ReclassifyService).reclassifyIds([later]);
    expect(await typeOf(later)).toBe("loan_out");
  });

  it("an answer by account number replaces an earlier one by name", async () => {
    const { key } = await person({ iban: "UA00PERSON" });
    await ds.query(`INSERT INTO rules (match_kind, match_value, type, label, direction) VALUES ('recipient','olena k','person_transfer','help','out')`);
    await answer(key, "lend");
    expect(await ds.query("SELECT match_kind, label FROM rules")).toEqual([{ match_kind: "iban", label: "lend" }]);
  });

  describe("close person, regularly", () => {
    const planned = (amount: number, currency = "UAH", due = "2026-11-05") =>
      ds.query(`INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation','Support',$1,$2,$3)`, [amount, currency, due]);

    it("the transfer matching the plan closes the payment and leaves the limit alone; the others count", async () => {
      const { t1, t2, key } = await person();
      await planned(80_000);
      await answer(key, "close_regular");
      expect((await row(`SELECT transaction_id FROM scheduled_payments`)).transaction_id).toBe(t1);
      expect(await typeOf(t1)).toBe("obligation");
      expect(await typeOf(t2)).toBe("person_transfer");
    });

    it("works for a later transfer, and again when it is reclassified", async () => {
      const { a, key } = await person();
      await answer(key, "close_regular");
      await planned(90_000, "UAH", "2026-11-26");
      const later = await tx(a, { name: "Olena K", description: "Переказ", type: null, source: null, amount: -90_000, at: "2026-11-26T10:00:00.000Z" });
      const reclassify = app.get(ReclassifyService);
      await reclassify.reclassifyIds([later]);
      expect((await row(`SELECT transaction_id FROM scheduled_payments`)).transaction_id).toBe(later);
      expect(await typeOf(later)).toBe("obligation");
      await reclassify.reclassifyIds([later]);
      expect(await typeOf(later)).toBe("obligation");
    });

    it("another answer gives the payment back", async () => {
      const { t1, key } = await person();
      await planned(80_000);
      await answer(key, "close_regular");
      await answer(key, "one_off");
      expect(await row(`SELECT transaction_id, paid_at FROM scheduled_payments`)).toEqual({ transaction_id: null, paid_at: null });
      expect(await typeOf(t1)).toBe("person_transfer");
    });

    it("a transfer with any other answer leaves the plan alone", async () => {
      const { t1, key } = await person();
      await planned(80_000);
      await answer(key, "one_off");
      expect((await row(`SELECT transaction_id FROM scheduled_payments`)).transaction_id).toBeNull();
      expect(await typeOf(t1)).toBe("person_transfer");
    });

    it("a stranger's transfer of the planned amount leaves the plan alone", async () => {
      const a = await account();
      await planned(80_000);
      const stranger = await tx(a, { name: "Petro", description: "Переказ", type: null, source: null, amount: -80_000, at: "2026-11-05T10:00:00.000Z" });
      await app.get(ReclassifyService).reclassifyIds([stranger]);
      expect((await row(`SELECT transaction_id FROM scheduled_payments`)).transaction_id).toBeNull();
    });
  });

  describe("GET /recipients/:key", () => {
    it("says who it is, how much in all, when last, and the answer given", async () => {
      const { a, key } = await person();
      await tx(a, { name: "Olena K", description: "Від Olena", type: "person_in", amount: 5_000, at: "2026-11-10T10:00:00.000Z" });
      expect((await api.get(`/recipients/${key}`).expect(200)).body).toEqual({ name: "Olena K", count: 2, total: 130_000, lastOn: "2026-11-05", label: null });
      await answer(key, "lend");
      expect((await api.get(`/recipients/${key}`).expect(200)).body.label).toBe("lend");
    });

    it("names a person under an account number, not its bank text", async () => {
      const a = await account();
      await tx(a, { name: "Olena K", iban: "UA00PERSON", description: "Переказ", type: "person_transfer", at: "2026-11-01T10:00:00.000Z" });
      const t = await tx(a, { name: "Переказ на картку", iban: "UA00PERSON", description: "Переказ", type: "person_transfer", at: "2026-11-05T10:00:00.000Z" });
      const key = ((await api.get("/transactions").expect(200)).body.items as { id: number; counterKey: string }[]).find((i) => i.id === t)!.counterKey;
      expect((await api.get(`/recipients/${key}`).expect(200)).body.name).toBe("Olena K");
    });

    it("rejects a bad key and an unknown one", async () => {
      await api.get(`/recipients/zz`).expect(400);
      await api.get(`/recipients/0123456789abcdef`).expect(404);
    });
  });

  it("a transaction carries the answer given about its recipient", async () => {
    const { t1, key } = await person();
    const label = async () => ((await api.get("/transactions").expect(200)).body.items as { id: number; recipientLabel: string | null }[]).find((i) => i.id === t1)!.recipientLabel;
    expect(await label()).toBeNull();
    await answer(key, "skip");
    expect(await label()).toBe("skip");
  });
});

describe("rule safety", () => {
  const reclassifyIds = (ids: number[]) => app.get(ReclassifyService).reclassifyIds(ids);

  it("a recipient rule matches the whole normalised name, not a substring", async () => {
    const a = await account();
    const t = await tx(a, { name: "Olena K", description: "Переказ", type: "person_transfer", needsLabel: true });
    const key = (await api.get("/transactions").expect(200)).body.items[0].counterKey as string;
    await api.post("/recipients/label", { counterKey: key, label: "help" }).expect(201);
    const same = await tx(a, { name: "  OLENA    k ", description: "x", type: null, source: null });
    const longer = await tx(a, { name: "Olena Kovalenko", description: "y", type: null, source: null });
    const inDesc = await tx(a, { name: null, description: "Payment to Olena K shop", mcc: null, type: null, source: null });
    await reclassifyIds([same, longer, inDesc]);
    expect((await row("SELECT type_source FROM transactions WHERE id=$1", [same])).type_source).toBe("rule");
    expect((await row("SELECT type_source FROM transactions WHERE id=$1", [longer])).type_source).not.toBe("rule");
    expect((await row("SELECT type_source FROM transactions WHERE id=$1", [inDesc])).type_source).not.toBe("rule");
    expect((await row("SELECT type_source FROM transactions WHERE id=$1", [t])).type_source).toBe("owner");
  });

  it("a short name or a generic bank text creates no rule but still labels the rows", async () => {
    const a = await account();
    const short = await tx(a, { name: "Al", description: "Переказ", type: "person_transfer", needsLabel: true });
    const generic = await tx(a, { name: null, description: " Переказ  ", type: "person_transfer", needsLabel: true });
    const items = (await api.get("/transactions").expect(200)).body.items as { id: number; counterKey: string }[];
    const k = (id: number) => items.find((i) => i.id === id)!.counterKey;
    expect((await api.post("/recipients/label", { counterKey: k(short), label: "help" }).expect(201)).body).toEqual({ updated: 1 });
    expect((await api.post("/recipients/label", { counterKey: k(generic), label: "one_off" }).expect(201)).body).toEqual({ updated: 1 });
    expect((await row("SELECT count(*)::int AS n FROM rules")).n).toBe(0);
    expect((await row("SELECT type_source, needs_label FROM transactions WHERE id=$1", [generic]))).toEqual({
      type_source: "owner",
      needs_label: false,
    });
    // Same through PATCH.
    const g2 = await tx(a, { name: null, description: "Оплата", type: "spend" });
    await api.patch(`/transactions/${g2}`, { type: "cash_out", applyToSimilar: true }).expect(200);
    expect((await row("SELECT count(*)::int AS n FROM rules")).n).toBe(0);
    expect((await row("SELECT type FROM transactions WHERE id=$1", [g2])).type).toBe("cash_out");
  });

  it("applyToSimilar keeps to the direction of the edited row, and so does its rule", async () => {
    const a = await account("fop");
    const out = await tx(a, { iban: IBAN, name: "Ivan P", amount: -5_000, type: "person_transfer" });
    const inn = await tx(a, { iban: IBAN, name: "Ivan P", amount: 7_000, type: "person_in" });
    const res = await api.patch(`/transactions/${out}`, { type: "obligation", applyToSimilar: true }).expect(200);
    expect(res.body.updated).toBe(1);
    expect((await row("SELECT type, type_source FROM transactions WHERE id=$1", [inn]))).toEqual({
      type: "person_in",
      type_source: "auto",
    });
    expect((await row("SELECT direction FROM rules")).direction).toBe("out");
    const inLater = await tx(a, { iban: IBAN, name: "Ivan P", amount: 9_000, mcc: 4829, type: null, source: null });
    const outLater = await tx(a, { iban: IBAN, name: "Ivan P", amount: -9_000, mcc: 4829, type: null, source: null });
    await reclassifyIds([inLater, outLater]);
    expect((await row("SELECT type FROM transactions WHERE id=$1", [outLater])).type).toBe("obligation");
    expect((await row("SELECT type FROM transactions WHERE id=$1", [inLater])).type).toBe("income");
  });

  it("retyping away from obligation or debt_payment frees the planned payment", async () => {
    const a = await account();
    await ds.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation','Rent',1700000,'UAH','2026-11-18')`,
    );
    const t = await tx(a, { amount: -1_700_000, description: "Landlord" });
    await api.patch(`/transactions/${t}`, { type: "obligation" }).expect(200);
    expect((await row("SELECT transaction_id FROM scheduled_payments")).transaction_id).toBe(t);
    await api.patch(`/transactions/${t}`, { type: "spend" }).expect(200);
    expect(await row("SELECT transaction_id, paid_at FROM scheduled_payments")).toEqual({ transaction_id: null, paid_at: null });
  });

  it("a recipient label that leaves obligation frees it; a manual payment stays paid", async () => {
    const a = await account();
    await ds.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation','Support',80000,'UAH','2026-11-05')`,
    );
    await ds.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, paid_at) VALUES ('obligation','Manual',1,'UAH','2026-11-06', now())`,
    );
    await tx(a, { name: "Olena K", description: "Переказ", type: "person_transfer", needsLabel: true, amount: -80_000, at: "2026-11-05T10:00:00.000Z" });
    const key = (await api.get("/transactions").expect(200)).body.items[0].counterKey as string;
    await api.post("/recipients/label", { counterKey: key, label: "obligation" }).expect(201);
    expect((await row("SELECT paid_at FROM scheduled_payments WHERE name='Support'")).paid_at).not.toBeNull();
    await api.post("/recipients/label", { counterKey: key, label: "help" }).expect(201);
    expect(await row("SELECT transaction_id, paid_at FROM scheduled_payments WHERE name='Support'")).toEqual({
      transaction_id: null,
      paid_at: null,
    });
    expect((await row("SELECT paid_at FROM scheduled_payments WHERE name='Manual'")).paid_at).not.toBeNull();
  });
});

describe("withdrawals and rules", () => {
  const api2 = { del: (p: string) => request(http()).delete(p).set("Authorization", auth) };

  it("applyToSimilar leaves the counterparty's withdrawals alone and says how many rows change", async () => {
    const a = await account();
    const buy = await tx(a, { description: "Сільпо", mcc: 5411, type: "spend", category: "groceries" });
    const buy2 = await tx(a, { description: "Сільпо", mcc: 5411, type: "spend", category: "groceries" });
    const cash = await tx(a, { description: "Сільпо", mcc: 5411, type: "cash_out", category: "cash" });
    expect((await api.get(`/transactions/${buy}/similar?type=spend`).expect(200)).body).toEqual({ count: 2 });
    expect((await api.get(`/transactions/${buy}/similar?type=cash_out`).expect(200)).body).toEqual({ count: 3 });
    // The edited row itself always counts, even if it is a withdrawal.
    expect((await api.get(`/transactions/${cash}/similar?type=spend`).expect(200)).body).toEqual({ count: 3 });
    const res = await api.patch(`/transactions/${buy}`, { type: "spend", category: "cafe", applyToSimilar: true }).expect(200);
    expect(res.body.updated).toBe(2);
    expect((await row("SELECT type FROM transactions WHERE id=$1", [cash])).type).toBe("cash_out");
    expect((await row("SELECT category FROM transactions WHERE id=$1", [buy2])).category).toBe("cafe");
  });

  it("similar without a type counts the rows a category change would reach", async () => {
    const a = await account();
    const buy = await tx(a, { description: "Сільпо", mcc: 5411, type: "spend" });
    await tx(a, { description: "Сільпо", mcc: 5411, type: "cash_out" });
    expect((await api.get(`/transactions/${buy}/similar`).expect(200)).body).toEqual({ count: 1 });
    await api.get(`/transactions/999999/similar`).expect(404);
  });

  it("lists the owner's rules with how many rows follow each", async () => {
    const a = await account();
    const t = await tx(a, { description: "Видача готівки Сільпо", mcc: 5411, type: "cash_out" });
    await api.patch(`/transactions/${t}`, { type: "spend", applyToSimilar: true }).expect(200);
    await tx(a, { iban: IBAN, name: "Olena K", description: "Переказ", type: "person_transfer", needsLabel: true });
    const key = (await api.get("/transactions?q=Olena").expect(200)).body.items[0].counterKey as string;
    await api.post("/recipients/label", { counterKey: key, label: "help" }).expect(201);
    const res = await api.get("/rules").expect(200);
    expect(res.body).toEqual([
      { id: expect.any(Number), matchKind: "merchant", title: "видача готівки сільпо", type: "spend", category: null, label: null, direction: "out", count: 1 },
      // An account number is never sent: the rule is named after the person.
      { id: expect.any(Number), matchKind: "iban", title: "Olena K", type: "person_transfer", category: null, label: "help", direction: "out", count: 1 },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(IBAN);
  });

  it("deleting a rule returns its rows to automatic recognition", async () => {
    const a = await account();
    const t = await tx(a, { description: "Видача готівки Сільпо", mcc: 5411, type: "cash_out" });
    await api.patch(`/transactions/${t}`, { type: "spend", applyToSimilar: true }).expect(200);
    const other = await tx(a, { description: "Shop", type: "spend", source: "owner" });
    const [rule] = (await api.get("/rules").expect(200)).body as { id: number }[];
    await api2.del(`/rules/${rule!.id}`).expect(200);
    expect((await api.get("/rules").expect(200)).body).toEqual([]);
    expect(await row("SELECT type, type_source FROM transactions WHERE id=$1", [t])).toEqual({ type: "cash_out", type_source: "rule" });
    expect((await row("SELECT type_source FROM transactions WHERE id=$1", [other])).type_source).toBe("owner");
    await api2.del(`/rules/${rule!.id}`).expect(404);
  });

  it("deleting a recipient answer makes the transfers ask again", async () => {
    const a = await account();
    const t = await tx(a, { iban: IBAN, name: "Olena K", description: "Переказ", mcc: 4829, type: "person_transfer", needsLabel: true });
    const key = (await api.get("/transactions").expect(200)).body.items[0].counterKey as string;
    await api.post("/recipients/label", { counterKey: key, label: "obligation" }).expect(201);
    const [rule] = (await api.get("/rules").expect(200)).body as { id: number }[];
    await api2.del(`/rules/${rule!.id}`).expect(200);
    expect(await row("SELECT type, needs_label FROM transactions WHERE id=$1", [t])).toEqual({ type: "person_transfer", needs_label: true });
  });
});

describe("filters by category and period", () => {
  it("narrows the list to a category and to dates (Kyiv days, inclusive), and sums what it found", async () => {
    const a = await account();
    await tx(a, { description: "Cafe A", amount: -10_000, category: "cafe", at: "2026-11-01T10:00:00.000Z" });
    await tx(a, { description: "Cafe B", amount: -20_000, category: "cafe", at: "2026-11-05T10:00:00.000Z" });
    await tx(a, { description: "Cafe C", amount: -40_000, category: "cafe", at: "2026-11-10T10:00:00.000Z" });
    await tx(a, { description: "Shop", amount: -5_000, category: "groceries", at: "2026-11-05T11:00:00.000Z" });
    const res = await api.get("/transactions?group=spend&category=cafe&from=2026-11-01&to=2026-11-05").expect(200);
    expect(res.body.items.map((i: { description: string }) => i.description)).toEqual(["Cafe B", "Cafe A"]);
    expect(res.body.summary).toEqual({ total: -30_000, count: 2 });
    const day = await api.get("/transactions?from=2026-11-05&to=2026-11-05").expect(200);
    expect(day.body.items.map((i: { description: string }) => i.description)).toEqual(["Shop", "Cafe B"]);
    expect(day.body.summary).toEqual({ total: -25_000, count: 2 });
  });

  it("finds rows with an empty category under «Без категории», and only those besides its own (В8)", async () => {
    const a = await account();
    await tx(a, { description: "Empty", amount: -10_000, category: null, at: "2026-11-01T10:00:00.000Z" });
    await tx(a, { description: "Keyed", amount: -20_000, category: "uncategorized", at: "2026-11-02T10:00:00.000Z" });
    await tx(a, { description: "Cafe", amount: -40_000, category: "cafe", at: "2026-11-03T10:00:00.000Z" });
    const res = await api.get("/transactions?group=spend&category=uncategorized").expect(200);
    expect(res.body.items.map((i: { description: string }) => i.description)).toEqual(["Keyed", "Empty"]);
    expect(res.body.summary).toEqual({ total: -30_000, count: 2 });
    const cafe = await api.get("/transactions?category=cafe").expect(200);
    expect(cafe.body.items.map((i: { description: string }) => i.description)).toEqual(["Cafe"]);
  });

  it("has no summary without a filter, and rejects a bad period", async () => {
    const a = await account();
    await tx(a, { description: "Cafe A", amount: -10_000, category: "cafe" });
    expect((await api.get("/transactions").expect(200)).body.summary).toBeNull();
    await api.get("/transactions?from=2026-11-10&to=2026-11-01").expect(400);
    await api.get("/transactions?from=10.11.2026").expect(400);
  });

  it("filters to «желаемое» with a summary, and takes only want=true (В6)", async () => {
    const a = await account();
    await tx(a, { description: "Cafe", amount: -10_000, category: "cafe" });
    await tx(a, { description: "Shop", amount: -5_000, category: "groceries" });
    const res = await api.get("/transactions?want=true").expect(200);
    expect(res.body.items.map((i: { description: string }) => i.description)).toEqual(["Cafe"]);
    expect(res.body.summary).toEqual({ total: -10_000, count: 1 });
    await api.get("/transactions?want=false").expect(400);
    await api.get("/transactions?want=yes").expect(400);
  });

  it("filters by the account's kind with a summary, together with the other filters (Д1)", async () => {
    const black = await account("black");
    const white = await account("white");
    const whiteUsd = await account("white", "USD");
    await account("jar");
    await tx(black, { description: "Black cafe", amount: -10_000, category: "cafe", at: "2026-11-05T10:00:00.000Z" });
    await tx(white, { description: "White cafe", amount: -20_000, category: "cafe", at: "2026-11-05T11:00:00.000Z" });
    await tx(white, { description: "White shop", amount: -40_000, category: "groceries", at: "2026-11-06T10:00:00.000Z" });
    await tx(whiteUsd, { description: "White old", amount: -100, amountUah: -4_100, category: "cafe", at: "2026-10-01T10:00:00.000Z" });
    await tx(white, { description: "White income", amount: 500_000, type: "income", at: "2026-11-07T10:00:00.000Z" });

    const all = await api.get("/transactions?account=white").expect(200);
    expect(all.body.items.map((i: { description: string }) => i.description)).toEqual(["White income", "White shop", "White cafe", "White old"]);
    expect(all.body.summary).toEqual({ total: 500_000 - 20_000 - 40_000 - 4_100, count: 4 });

    const spend = await api.get("/transactions?group=spend&account=white&category=cafe&from=2026-11-01&to=2026-11-30").expect(200);
    expect(spend.body.items.map((i: { description: string }) => i.description)).toEqual(["White cafe"]);
    expect(spend.body.summary).toEqual({ total: -20_000, count: 1 });

    const income = await api.get("/transactions?group=income&account=black").expect(200);
    expect(income.body.items).toEqual([]);
    expect(income.body.summary).toEqual({ total: 0, count: 0 });

    await api.get("/transactions?account=jar").expect(400);
    await api.get("/transactions?account=card").expect(400);
  });

  it("names the kinds of the person's accounts to filter by, on the first page only (Д1)", async () => {
    const white = await account("white");
    await account("black");
    await account("black", "USD");
    await account("jar");
    await account("other");
    await tx(white, { description: "A", at: "2026-11-05T10:00:00.000Z" });
    await tx(white, { description: "B", at: "2026-11-04T10:00:00.000Z" });
    const first = await api.get("/transactions?limit=1").expect(200);
    expect(first.body.accountKinds).toEqual(["black", "white"]);
    const next = await api.get(`/transactions?limit=1&cursor=${first.body.nextCursor as string}`).expect(200);
    expect(next.body.accountKinds).toBeUndefined();

    await account("fop");
    await account("cash");
    expect((await api.get("/transactions?account=fop").expect(200)).body.accountKinds).toEqual(["black", "white", "fop", "cash"]);
  });
});

describe("filters for the lines of «Итоги» (Я8)", () => {
  it("lists every operation of one place, whatever the owner made of it; under «Траты» only the limit's add up", async () => {
    const a = await account();
    await tx(a, { description: "Apple", amount: -10_000, category: "subscriptions", at: "2026-11-05T10:00:00.000Z" });
    await tx(a, { description: "apple ", amount: 3_000, category: "refund", at: "2026-11-06T10:00:00.000Z" }); // the same place, as the key normalises it
    await tx(a, { description: "Apple", amount: -20_000, type: "obligation", category: "subscriptions", source: "owner", at: "2026-11-07T10:00:00.000Z" });
    await tx(a, { description: "Оплата", name: "Apple", amount: -4_000, at: "2026-11-08T10:00:00.000Z" }); // named by the counterparty
    await tx(a, { description: "Apple", iban: IBAN, amount: -50_000, at: "2026-11-09T10:00:00.000Z" }); // a known account: someone else
    await tx(a, { description: "Shop", amount: -5_000, at: "2026-11-10T10:00:00.000Z" });
    const key = (await api.get("/transactions?limit=1&from=2026-11-05&to=2026-11-05").expect(200)).body.items[0].counterKey as string;

    const all = (await api.get(`/transactions?place=${key}`).expect(200)).body;
    expect(all.items.map((i: { amount: number }) => i.amount)).toEqual([-4_000, -20_000, 3_000, -10_000]);
    expect(all.items.every((i: { counterKey: string }) => i.counterKey === key)).toBe(true);
    expect(all.summary).toEqual({ total: -31_000, count: 4 });

    const spend = (await api.get(`/transactions?group=spend&place=${key}`).expect(200)).body;
    expect(spend.items.map((i: { amount: number }) => i.amount)).toEqual([-4_000, -20_000, 3_000, -10_000]);
    expect(spend.summary).toEqual({ total: -11_000, count: 3 });

    // With the other filters: a period, and the payments outside the limit.
    const period = (await api.get(`/transactions?place=${key}&from=2026-11-06&to=2026-11-07`).expect(200)).body;
    expect(period.items.map((i: { amount: number }) => i.amount)).toEqual([-20_000, 3_000]);
    const other = (await api.get(`/transactions?place=${key}&other=true`).expect(200)).body;
    expect(other.items.map((i: { amount: number }) => i.amount)).toEqual([-20_000]);
    expect(other.summary).toEqual({ total: -20_000, count: 1 });

    // A key nobody has: an empty list, not an error.
    const none = (await api.get("/transactions?place=0000000000000000").expect(200)).body;
    expect(none.items).toEqual([]);
    expect(none.summary).toEqual({ total: 0, count: 0 });
  });

  it("lists the payments outside the limit and adds them up under every tab but «Доходы»", async () => {
    const a = await account();
    await tx(a, { description: "Rent", amount: -800_000, type: "obligation", at: "2026-11-02T10:00:00.000Z" });
    await tx(a, { description: "Tax", amount: -100_000, type: "tax", at: "2026-11-03T10:00:00.000Z" });
    await tx(a, { description: "Loan", amount: -50_000, type: "debt_payment", at: "2026-11-04T10:00:00.000Z" });
    await tx(a, { description: "Cafe", amount: -10_000, at: "2026-11-04T11:00:00.000Z" });
    await tx(a, { description: "Lent", amount: -70_000, type: "loan_out", at: "2026-11-05T10:00:00.000Z" });
    await tx(a, { description: "Pay", amount: 900_000, type: "income", at: "2026-11-05T11:00:00.000Z" });
    await tx(await account("jar"), { description: "Jar rent", amount: -1_000, type: "obligation", at: "2026-11-06T10:00:00.000Z" });

    for (const group of ["", "&group=spend", "&group=all"]) {
      const res = (await api.get(`/transactions?other=true${group}`).expect(200)).body;
      expect(res.items.map((i: { description: string }) => i.description), group).toEqual(["Loan", "Tax", "Rent"]);
      expect(res.summary).toEqual({ total: -950_000, count: 3 });
      expect(res.dayTotals).toEqual({ "2026-11-04": -50_000, "2026-11-03": -100_000, "2026-11-02": -800_000 });
    }
    const income = (await api.get("/transactions?other=true&group=income").expect(200)).body;
    expect(income.items).toEqual([]);
    expect(income.summary).toEqual({ total: 0, count: 0 });
    // With «желаемое», which is purchases in the limit: nothing.
    expect((await api.get("/transactions?other=true&want=true").expect(200)).body.items).toEqual([]);
  });

  it("refuses anything but other=true and a place's key", async () => {
    await api.get("/transactions?other=false").expect(400);
    await api.get("/transactions?other=1").expect(400);
    await api.get("/transactions?place=Apple").expect(400);
    await api.get("/transactions?place=0123456789ABCDEF").expect(400);
    await api.get("/transactions?place=").expect(400);
    await api.get("/transactions?placeKey=0123456789abcdef").expect(400);
  });

  it("names the filters it understands beyond the old ones, on the first page only, so a newer app knows to send them", async () => {
    const a = await account();
    await tx(a, { description: "A", at: "2026-11-05T10:00:00.000Z" });
    await tx(a, { description: "B", at: "2026-11-04T10:00:00.000Z" });
    const first = (await api.get("/transactions?limit=1").expect(200)).body;
    expect(first.filters).toEqual(["other", "place"]);
    const next = (await api.get(`/transactions?limit=1&cursor=${first.nextCursor as string}`).expect(200)).body;
    expect(next.filters).toBeUndefined();
    expect((await api.get("/transactions?other=true").expect(200)).body.filters).toEqual(["other", "place"]);
  });
});

describe("a tax closed by its operations, one of them retyped (Б26)", () => {
  // 14 November: Q3 tax is due on the 20th and is paid in two payments.
  const plan = () => app.get(PlanService);
  const taxRow = async (amount: number, over: { paid?: string; estimate?: boolean } = {}) =>
    (
      await row(
        `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, paid_at, tax_quarter, is_estimate)
         VALUES ('tax','Q3',$1,'UAH','2026-11-20',$2,'2026-Q3',$3) RETURNING id`,
        [amount, over.paid ?? null, over.estimate ?? false],
      )
    ).id as number;
  const state = (id: number) => row(`SELECT paid_at IS NOT NULL AS paid, closed_by_links FROM scheduled_payments WHERE id=$1`, [id]);
  const links = async (id: number) =>
    ((await ds.query(`SELECT transaction_id FROM payment_links WHERE payment_id=$1 ORDER BY transaction_id`, [id])) as { transaction_id: number }[]).map(
      (r) => r.transaction_id,
    );
  const taxTx = (a: number, amount: number) => tx(a, { amount: -amount, type: "tax", category: "tax", at: "2026-11-14T10:00:00.000Z" });
  const dayLimit = async () => (await row(`SELECT daily_limit::int AS l FROM daily_snapshots WHERE local_date='2026-11-14'`)).l as number;
  beforeEach(async () => {
    app.get(Clock).fixed = new Date("2026-11-14T10:00:00Z");
    await ds.query(`TRUNCATE daily_snapshots`);
  });
  afterEach(() => {
    app.get(Clock).fixed = null;
  });

  it("opens the tax again when one of its two payments is retyped; the other stays linked and the day is fixed afresh", async () => {
    const a = await account();
    const id = await taxRow(795_000);
    const first = await taxTx(a, 571_000);
    await plan().onClassified(first, "tax");
    const second = await taxTx(a, 224_000);
    await plan().onClassified(second, "tax");
    expect(await state(id)).toEqual({ paid: true, closed_by_links: true });
    expect(await links(id)).toEqual([first, second]);
    await ds.query(
      `INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ('2026-11-14', 1, 'normal') ON CONFLICT (local_date) DO UPDATE SET daily_limit=1`,
    );

    await api.patch(`/transactions/${second}`, { type: "spend" }).expect(200);
    expect(await state(id)).toEqual({ paid: false, closed_by_links: false });
    expect(await links(id)).toEqual([first]);
    expect(await dayLimit()).not.toBe(1);
  });

  it("a tax closed by hand and linked to its two payments later (14 November) stays closed", async () => {
    const a = await account();
    const id = await taxRow(760_000, { estimate: true, paid: "2026-11-14T12:00:00Z" });
    const first = await taxTx(a, 571_000);
    const second = await taxTx(a, 224_000);
    await plan().linkTaxTransactions();
    expect(await links(id)).toEqual([first, second]);
    expect(await state(id)).toEqual({ paid: true, closed_by_links: false });

    await api.patch(`/transactions/${first}`, { type: "spend" }).expect(200);
    expect(await state(id)).toEqual({ paid: true, closed_by_links: false });
    expect(await links(id)).toEqual([second]);
  });
});

describe("the same sum from someone else is no transfer between own accounts (Б32)", () => {
  /** A statement row as monobank sends it, at noon UTC on 10 November 2026 plus `s` seconds. */
  const item = (id: string, amount: number, description: string, s: number) => ({
    id, time: Math.floor(Date.UTC(2026, 10, 10, 12, 0, 0) / 1000) + s, description, mcc: 4829, originalMcc: 4829, hold: false,
    amount, operationAmount: amount, currencyCode: 980, commissionRate: 0, cashbackAmount: 0, balance: 1_000_000,
  });
  const listed = async (group: string) =>
    (await api.get(`/transactions?group=${group}&from=2026-11-10&to=2026-11-10`).expect(200)).body.items as
      { id: number; type: string; inLimit: boolean; needsLabel: boolean }[];

  it("₴500 to Олена from the black card and ₴500 from Петро on the white one three minutes later stay a transfer and money from a person", async () => {
    const black = await account("black");
    const white = await account("white");
    const imp = app.get(ImportService);
    const out = await imp.upsertStatementItem(black, item("olena", -50_000, "Олена Коваль", 0));
    const inn = await imp.upsertStatementItem(white, item("petro", 50_000, "Від: Петро Сидоренко", 180));
    expect(await ds.query(`SELECT id, type, needs_label FROM transactions ORDER BY id`)).toEqual([
      { id: out.id, type: "person_transfer", needs_label: true },
      // As a lone «Від:» row on its own: money from a person, not asked about.
      { id: inn.id, type: "person_in", needs_label: false },
    ]);
    // The ₴500 counts against the day and is asked about; the money in stays under «Доходы».
    const spend = await listed("spend");
    expect(spend.map((r) => [r.id, r.type, r.inLimit, r.needsLabel])).toEqual([[out.id, "person_transfer", true, true]]);
    expect((await listed("income")).map((r) => r.id)).toEqual([inn.id]);
  });

  it("a real transfer between two own cards with the exact sum still pairs", async () => {
    const black = await account("black");
    const white = await account("white");
    const imp = app.get(ImportService);
    await imp.upsertStatementItem(black, item("to-white", -50_000, "Переказ на картку", 0));
    await imp.upsertStatementItem(white, item("from-black", 50_000, "Переказ з картки", 30));
    expect(await ds.query(`SELECT type, needs_label FROM transactions ORDER BY id`)).toEqual([
      { type: "own_transfer", needs_label: false },
      { type: "own_transfer", needs_label: false },
    ]);
    expect(await listed("spend")).toEqual([]);
    expect(await listed("income")).toEqual([]);
  });
});

describe("an owner retype that makes a loan or closes a payment fixes the day afresh (Б35)", () => {
  // 14 November. A sentinel limit of 1 stands for the morning's figure: a re-fix replaces it.
  const AT = "2026-11-14T10:00:00.000Z";
  const dayLimit = async () => (await row(`SELECT daily_limit::int AS l FROM daily_snapshots WHERE local_date='2026-11-14'`)).l as number;
  const sentinel = () =>
    ds.query(
      `INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ('2026-11-14', 1, 'normal') ON CONFLICT (local_date) DO UPDATE SET daily_limit=1`,
    );
  const loans = () => ds.query(`SELECT source_transaction_id, amount::int AS amount FROM loans ORDER BY id`);
  beforeEach(async () => {
    app.get(Clock).fixed = new Date("2026-11-14T10:00:00Z");
    await ds.query(`TRUNCATE daily_snapshots`);
  });
  afterEach(() => {
    app.get(Clock).fixed = null;
  });

  it("a row retyped to loan_in by hand records the loan and fixes the day at once", async () => {
    const a = await account();
    const t = await tx(a, { amount: 300_000, type: "person_in", description: "Від: Петро", at: AT });
    await sentinel();

    await api.patch(`/transactions/${t}`, { type: "loan_in" }).expect(200);
    expect(await loans()).toEqual([{ source_transaction_id: t, amount: 300_000 }]);
    expect(await dayLimit()).not.toBe(1);
  });

  it("a row retyped away from loan_in by hand drops its loan and fixes the day; retyped back, the loan returns", async () => {
    const a = await account();
    const t = await tx(a, { amount: 300_000, type: "person_in", description: "Від: Петро", at: AT });
    await api.patch(`/transactions/${t}`, { type: "loan_in" }).expect(200);
    expect(await loans()).toHaveLength(1);
    await sentinel();

    await api.patch(`/transactions/${t}`, { type: "person_in" }).expect(200);
    expect(await loans()).toEqual([]);
    expect(await dayLimit()).not.toBe(1);

    await sentinel();
    await api.patch(`/transactions/${t}`, { type: "loan_in" }).expect(200);
    expect(await loans()).toEqual([{ source_transaction_id: t, amount: 300_000 }]);
    expect(await dayLimit()).not.toBe(1);
  });

  it("a loan already partly repaid stays when its row is retyped", async () => {
    const a = await account();
    const t = await tx(a, { amount: 300_000, type: "person_in", description: "Від: Петро", at: AT });
    await api.patch(`/transactions/${t}`, { type: "loan_in" }).expect(200);
    await ds.query(`UPDATE loans SET repaid_amount = 100000`);

    await api.patch(`/transactions/${t}`, { type: "person_in" }).expect(200);
    expect(await loans()).toEqual([{ source_transaction_id: t, amount: 300_000 }]);
  });

  it("a row retyped to obligation by hand closes the planned payment and fixes the day at once", async () => {
    const a = await account();
    await ds.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation','Rent',1700000,'UAH','2026-11-14')`,
    );
    const t = await tx(a, { amount: -1_700_000, description: "Landlord", at: AT });
    await sentinel();

    await api.patch(`/transactions/${t}`, { type: "obligation" }).expect(200);
    expect((await row(`SELECT transaction_id FROM scheduled_payments`)).transaction_id).toBe(t);
    expect(await dayLimit()).not.toBe(1);
  });

  it("an obligation answer about a recipient closes the planned payment and fixes the day at once", async () => {
    const a = await account();
    const t = await tx(a, { name: "Olena K", description: "Переказ", type: "person_transfer", needsLabel: true, amount: -80_000, at: AT });
    const key = ((await api.get("/transactions").expect(200)).body.items as { id: number; counterKey: string }[]).find((i) => i.id === t)!.counterKey;
    await ds.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation','Support',80000,'UAH','2026-11-14')`,
    );
    await sentinel();

    await api.post("/recipients/label", { counterKey: key, label: "obligation" }).expect(201);
    expect((await row(`SELECT transaction_id FROM scheduled_payments`)).transaction_id).toBe(t);
    expect(await dayLimit()).not.toBe(1);
  });

  it("a plain retype that settles nothing leaves the day's limit as it was", async () => {
    const a = await account();
    const t = await tx(a, { amount: -10_000, at: AT });
    await sentinel();

    await api.patch(`/transactions/${t}`, { type: "cash_out" }).expect(200);
    expect(await dayLimit()).toBe(1);
  });

  it("an automatic classification that records a loan keeps the morning's limit", async () => {
    const a = await account();
    const t = await tx(a, { amount: 300_000, type: "loan_in", description: "Кредит", at: AT });
    await sentinel();

    await app.get(PlanService).onClassified(t, "loan_in");
    expect(await loans()).toHaveLength(1);
    expect(await dayLimit()).toBe(1);
  });
});

describe("a loan with repayments whose row is no longer loan_in can be deleted (Б48)", () => {
  const AT = "2026-11-14T10:00:00.000Z";
  const del = (p: string) => request(http()).delete(p).set("Authorization", auth);
  const dayLimit = async () => (await row(`SELECT daily_limit::int AS l FROM daily_snapshots WHERE local_date='2026-11-14'`)).l as number;
  const sentinel = () =>
    ds.query(
      `INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ('2026-11-14', 1, 'normal') ON CONFLICT (local_date) DO UPDATE SET daily_limit=1`,
    );
  const loans = () => ds.query(`SELECT id, source_transaction_id FROM loans ORDER BY id`);
  const listed = async (id: number) => {
    const h = (await api.get("/plan/loans/history").expect(200)).body as Record<"open" | "old" | "repaid", { id: number }[]>;
    return [...h.open, ...h.old, ...h.repaid].find((l) => l.id === id);
  };
  /** A bank row recorded as a loan by hand, with part of it repaid. */
  const repaidBankLoan = async () => {
    const a = await account();
    const t = await tx(a, { amount: 300_000, type: "person_in", description: "Від: Петро", at: AT });
    await api.patch(`/transactions/${t}`, { type: "loan_in" }).expect(200);
    const id = (await row(`SELECT id FROM loans WHERE source_transaction_id=$1`, [t])).id as number;
    await api.post(`/plan/loans/${id}/repay`, { amount: 100_000, date: "2026-11-14" }).expect(201);
    return { t, id };
  };
  beforeEach(async () => {
    app.get(Clock).fixed = new Date("2026-11-14T10:00:00Z");
    await ds.query(`TRUNCATE daily_snapshots`);
  });
  afterEach(() => {
    app.get(Clock).fixed = null;
  });

  it("a loan whose row was retyped stays, can be deleted, fixes the day afresh and does not come back", async () => {
    const { t, id } = await repaidBankLoan();
    await api.patch(`/transactions/${t}`, { type: "person_in" }).expect(200);
    expect(await loans()).toEqual([{ id, source_transaction_id: t }]);
    expect(await listed(id)).toMatchObject({ manual: false, removable: true });
    await sentinel();

    await del(`/plan/loans/${id}`).expect(200);
    expect(await loans()).toEqual([]);
    expect(await dayLimit()).not.toBe(1);

    await app.get(ReclassifyService).reclassifyIds([t]);
    await app.get(ReclassifyService).reclassifyPending();
    await app.get(PlanService).onClassified(t, "person_in");
    expect(await loans()).toEqual([]);
  });

  it("a loan whose row is still loan_in cannot be deleted: it would come back", async () => {
    const { id } = await repaidBankLoan();
    expect(await listed(id)).toMatchObject({ manual: false, removable: false });
    await del(`/plan/loans/${id}`).expect(409);
    expect(await loans()).toHaveLength(1);
  });

  it("a loan whose row has no type yet cannot be deleted: classification may make it loan_in again", async () => {
    const { t, id } = await repaidBankLoan();
    await ds.query(`UPDATE transactions SET type=NULL, type_source=NULL WHERE id=$1`, [t]);
    expect(await listed(id)).toMatchObject({ removable: false });
    await del(`/plan/loans/${id}`).expect(409);
  });

  it("a manual loan is removable as before", async () => {
    const id = (await api.post("/plan/loans", { amount: 50_000, received_on: "2026-11-14", note: "друг" }).expect(201)).body.id as number;
    expect(await listed(id)).toMatchObject({ manual: true, removable: true });
    await del(`/plan/loans/${id}`).expect(200);
  });
});

describe("deleting a rule returns only what was changed through it (Б36)", () => {
  const del = (p: string) => request(http()).delete(p).set("Authorization", auth);
  const reclassifyIds = (ids: number[]) => app.get(ReclassifyService).reclassifyIds(ids);
  const source = async (id: number) => row("SELECT type, type_source FROM transactions WHERE id=$1", [id]);
  const ruleIds = async () => ((await api.get("/rules").expect(200)).body as { id: number }[]).map((r) => r.id);
  const transfer = (a: number, o: TxOver = {}) =>
    tx(a, { iban: IBAN, name: "Olena K", description: "Переказ", mcc: 4829, type: "person_transfer", amount: -80_000, ...o });

  it("leaves a row the owner then changed alone, and returns the rows changed through the rule", async () => {
    const a = await account();
    const edited = await transfer(a);
    const similar = await transfer(a);
    const alone = await transfer(a);
    await api.patch(`/transactions/${edited}`, { type: "obligation", applyToSimilar: true }).expect(200);
    // The owner sets the same type on one of them by itself: from now on it is the owner's.
    await api.patch(`/transactions/${alone}`, { type: "obligation" }).expect(200);
    const [rule] = await ruleIds();

    expect((await del(`/rules/${rule}`).expect(200)).body).toEqual({ updated: 2 });
    expect((await source(edited)).type_source).not.toBe("owner");
    expect((await source(similar)).type_source).not.toBe("owner");
    expect(await source(alone)).toEqual({ type: "obligation", type_source: "owner" });
  });

  it("leaves a later row the owner typed alone, and returns a later row the rule typed", async () => {
    const a = await account();
    const first = await transfer(a);
    await api.patch(`/transactions/${first}`, { type: "obligation", applyToSimilar: true }).expect(200);
    const byRule = await transfer(a, { type: null, source: null });
    await reclassifyIds([byRule]);
    expect(await source(byRule)).toEqual({ type: "obligation", type_source: "rule" });
    const byHand = await transfer(a);
    await api.patch(`/transactions/${byHand}`, { type: "obligation" }).expect(200);
    const [rule] = await ruleIds();

    expect((await del(`/rules/${rule}`).expect(200)).body).toEqual({ updated: 2 });
    expect((await source(byRule)).type_source).not.toBe("rule");
    expect((await source(first)).type_source).not.toBe("owner");
    expect(await source(byHand)).toEqual({ type: "obligation", type_source: "owner" });
  });

  it("a recipient answer gives back its rows, but not one the owner changed alone after it", async () => {
    const a = await account();
    const one = await transfer(a, { needsLabel: true });
    const two = await transfer(a, { needsLabel: true });
    const key = (await api.get("/transactions").expect(200)).body.items[0].counterKey as string;
    await api.post("/recipients/label", { counterKey: key, label: "obligation" }).expect(201);
    await api.patch(`/transactions/${two}`, { type: "obligation" }).expect(200);
    const [rule] = await ruleIds();

    expect((await del(`/rules/${rule}`).expect(200)).body).toEqual({ updated: 1 });
    expect(await row("SELECT type, needs_label FROM transactions WHERE id=$1", [one])).toEqual({ type: "person_transfer", needs_label: true });
    expect(await source(two)).toEqual({ type: "obligation", type_source: "owner" });
  });

  it("a rule saved again under a new id still gives back the rows changed through the first one", async () => {
    const a = await account();
    const one = await transfer(a);
    const two = await transfer(a);
    await api.patch(`/transactions/${one}`, { type: "obligation", applyToSimilar: true }).expect(200);
    const [old] = await ruleIds();
    // The same counterparty answered: the stored rule is replaced by a new row.
    const key = ((await api.get("/transactions").expect(200)).body.items as { id: number; counterKey: string }[]).find((i) => i.id === two)!.counterKey;
    await api.post("/recipients/label", { counterKey: key, label: "obligation" }).expect(201);
    const [rule] = await ruleIds();
    expect(rule).not.toBe(old);
    expect((await row("SELECT count(*)::int AS n FROM transactions WHERE owner_rule_id=$1", [old])).n).toBe(0);

    expect((await del(`/rules/${rule}`).expect(200)).body).toEqual({ updated: 2 });
    expect((await source(one)).type_source).not.toBe("owner");
    expect((await source(two)).type_source).not.toBe("owner");
  });

  it("a rule saved again moves the marks of rows the new save does not reach", async () => {
    const a = await account();
    const one = await transfer(a);
    await api.patch(`/transactions/${one}`, { type: "obligation", applyToSimilar: true }).expect(200);
    const [old] = await ruleIds();
    expect((await row("SELECT owner_rule_id FROM transactions WHERE id=$1", [one])).owner_rule_id).toBe(old);
    // The stored rule is found case-insensitively, the counterparty key is not: an account number written in
    // other case replaces the rule from outside the first save's rows, and `one` keeps a mark of the new rule.
    const other = await transfer(a, { iban: IBAN.toLowerCase() });
    await api.patch(`/transactions/${other}`, { type: "obligation", applyToSimilar: true }).expect(200);
    const [rule] = await ruleIds();
    expect(rule).not.toBe(old);
    expect((await row("SELECT owner_rule_id FROM transactions WHERE id=$1", [one])).owner_rule_id).toBe(rule);
  });

  it("a row the owner typed before rules were marked is given back as before; one typed alone since is kept", async () => {
    const a = await account();
    const old = await transfer(a, { type: "obligation", source: "owner" });
    await ds.query(`UPDATE transactions SET owner_rule_id = -1 WHERE id=$1`, [old]);
    const alone = await transfer(a, { type: "obligation", source: "owner" });
    const rule = (
      await ds.query(`INSERT INTO rules (match_kind, match_value, type, direction) VALUES ('iban',$1,'obligation','out') RETURNING id`, [IBAN])
    )[0].id as number;

    expect((await del(`/rules/${rule}`).expect(200)).body).toEqual({ updated: 1 });
    expect((await source(old)).type_source).not.toBe("owner");
    expect(await row("SELECT owner_rule_id FROM transactions WHERE id=$1", [old])).toEqual({ owner_rule_id: null });
    expect(await source(alone)).toEqual({ type: "obligation", type_source: "owner" });
  });
});

describe("a reclassify that changes a row's type frees what the row settled, as an edit by hand does (Б52)", () => {
  const AT = "2026-11-14T10:00:00.000Z";
  const reclassify = () => app.get(ReclassifyService).reclassifyPending();
  const dayLimit = async () => (await row(`SELECT daily_limit::int AS l FROM daily_snapshots WHERE local_date='2026-11-14'`)).l as number;
  const sentinel = () =>
    ds.query(
      `INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES ('2026-11-14', 1, 'normal') ON CONFLICT (local_date) DO UPDATE SET daily_limit=1`,
    );
  const rule = (value: string, type: string) =>
    ds.query(`INSERT INTO rules (match_kind, match_value, type, direction) VALUES ('merchant', $1, $2, NULL)`, [value, type]);
  const payment = async () => row(`SELECT transaction_id, paid_at IS NOT NULL AS paid FROM scheduled_payments`);
  const loans = () => ds.query(`SELECT source_transaction_id FROM loans ORDER BY id`);
  const typeOf = async (id: number) => (await row(`SELECT type FROM transactions WHERE id=$1`, [id])).type as string | null;
  beforeEach(async () => {
    app.get(Clock).fixed = new Date("2026-11-14T10:00:00Z");
    await ds.query(`TRUNCATE daily_snapshots`);
  });
  afterEach(() => {
    app.get(Clock).fixed = null;
  });

  /** A rent payment closed by a bank row its rule typed as obligation. */
  const rentClosedByRule = async () => {
    const a = await account();
    await ds.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation','Rent',1700000,'UAH','2026-11-14')`,
    );
    const t = await tx(a, { amount: -1_700_000, description: "Landlord", at: AT, type: null, source: null });
    await rule("Landlord", "obligation");
    await reclassify();
    expect(await payment()).toEqual({ transaction_id: t, paid: true });
    return t;
  };

  it("a payment closed by a row its rule typed opens again when the rule is gone, and the day is fixed afresh", async () => {
    const t = await rentClosedByRule();
    await ds.query(`DELETE FROM rules`);
    await sentinel();

    await reclassify();
    expect(await typeOf(t)).not.toBe("obligation");
    expect(await payment()).toEqual({ transaction_id: null, paid: false });
    expect(await dayLimit()).not.toBe(1);
  });

  it("a row whose type stays keeps its payment closed and the day's limit as it was", async () => {
    const t = await rentClosedByRule();
    await sentinel();

    await reclassify();
    expect(await payment()).toEqual({ transaction_id: t, paid: true });
    expect(await dayLimit()).toBe(1);
  });

  it("a store installment the plan stored as debt_payment keeps its payment and the day's limit on every pass", async () => {
    const a = await account();
    await ds.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, match_hint) VALUES ('installment','Skay',529500,'UAH','2026-11-17','skay')`,
    );
    const t = await tx(a, { amount: -529_500, description: "Skay", mcc: 5411, at: "2026-11-17T10:00:00.000Z", type: null, source: null });
    await reclassify();
    expect(await typeOf(t)).toBe("debt_payment");
    expect(await payment()).toEqual({ transaction_id: t, paid: true });
    await sentinel();

    await reclassify();
    await reclassify();
    expect(await typeOf(t)).toBe("debt_payment");
    expect(await payment()).toEqual({ transaction_id: t, paid: true });
    expect(await dayLimit()).toBe(1);
  });

  it("a transfer to a planned recipient the plan stored as obligation keeps its payment when the rate moves", async () => {
    const a = await account();
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-01T09:00:00Z', 40)`);
    await ds.query(
      `INSERT INTO rules (match_kind, match_value, type, label, direction) VALUES ('recipient','olena k','person_transfer','close_regular','out')`,
    );
    await ds.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation','Support',80000,'USD','2026-11-05')`,
    );
    const t = await tx(a, { name: "Olena K", description: "Переказ", amount: -3_200_000, at: "2026-11-06T10:00:00.000Z", type: null, source: null });
    await reclassify();
    expect(await typeOf(t)).toBe("obligation");
    expect(await payment()).toEqual({ transaction_id: t, paid: true });
    await ds.query(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-13T09:00:00Z', 44)`);
    await sentinel();

    await reclassify();
    expect(await typeOf(t)).toBe("obligation");
    expect(await payment()).toEqual({ transaction_id: t, paid: true });
    expect(await dayLimit()).toBe(1);
  });

  it("a transfer whose recipient is no longer planned frees the payment it closed", async () => {
    const a = await account();
    await ds.query(
      `INSERT INTO rules (match_kind, match_value, type, label, direction) VALUES ('recipient','olena k','person_transfer','close_regular','out')`,
    );
    await ds.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation','Support',80000,'UAH','2026-11-05')`,
    );
    const t = await tx(a, { name: "Olena K", description: "Переказ", amount: -80_000, at: "2026-11-05T10:00:00.000Z", type: null, source: null });
    await reclassify();
    expect(await payment()).toEqual({ transaction_id: t, paid: true });
    await ds.query(`UPDATE rules SET label='one_off'`);
    await sentinel();

    await reclassify();
    expect(await typeOf(t)).toBe("person_transfer");
    expect(await payment()).toEqual({ transaction_id: null, paid: false });
    expect(await dayLimit()).not.toBe(1);
  });

  it("an owner row is never freed by a reclassify", async () => {
    const t = await rentClosedByRule();
    await ds.query(`UPDATE transactions SET type_source='owner' WHERE id=$1`, [t]);
    await ds.query(`DELETE FROM rules`);
    await sentinel();

    await reclassify();
    expect(await typeOf(t)).toBe("obligation");
    expect(await payment()).toEqual({ transaction_id: t, paid: true });
    expect(await dayLimit()).toBe(1);
  });

  it("a tax row that is no longer tax frees its link, and a payment its links closed opens again", async () => {
    const a = await account();
    const t = await tx(a, { amount: -500_000, description: "Landlord", at: AT, type: "tax", source: "rule" });
    const p = (
      await row(
        `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, paid_at, closed_by_links)
         VALUES ('tax','ЄП',500000,'UAH','2026-11-14', $1, true) RETURNING id`,
        [AT],
      )
    ).id as number;
    await ds.query(`INSERT INTO payment_links (payment_id, transaction_id) VALUES ($1,$2)`, [p, t]);
    await sentinel();

    await reclassify();
    expect(await typeOf(t)).not.toBe("tax");
    expect(await ds.query(`SELECT * FROM payment_links`)).toEqual([]);
    expect(await payment()).toEqual({ transaction_id: null, paid: false });
    expect(await dayLimit()).not.toBe(1);
  });

  it("a loan its rule recorded with nothing repaid goes when the rule is gone, and the day is fixed afresh", async () => {
    const a = await account();
    const t = await tx(a, { amount: 300_000, description: "Від: Петро", at: AT, type: null, source: null });
    await rule("Від: Петро", "loan_in");
    await reclassify();
    expect(await loans()).toEqual([{ source_transaction_id: t }]);
    await ds.query(`DELETE FROM rules`);
    await sentinel();

    await reclassify();
    expect(await typeOf(t)).not.toBe("loan_in");
    expect(await loans()).toEqual([]);
    expect(await dayLimit()).not.toBe(1);
  });

  it("a loan with a repayment stays when its row is retyped, and can then be deleted (Б48)", async () => {
    const a = await account();
    const t = await tx(a, { amount: 300_000, description: "Від: Петро", at: AT, type: null, source: null });
    await rule("Від: Петро", "loan_in");
    await reclassify();
    await ds.query(`UPDATE loans SET repaid_amount = 100000`);
    await ds.query(`DELETE FROM rules`);
    await sentinel();

    await reclassify();
    expect(await typeOf(t)).not.toBe("loan_in");
    expect(await loans()).toEqual([{ source_transaction_id: t }]);
    expect(await dayLimit()).toBe(1);
    const id = (await row(`SELECT id FROM loans`)).id as number;
    await request(http()).delete(`/plan/loans/${id}`).set("Authorization", auth).expect(200);
  });
});
