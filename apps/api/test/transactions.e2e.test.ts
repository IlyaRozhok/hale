import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
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
    const spendTypes = ["spend", "obligation", "tax", "debt_payment", "person_transfer", "cash_out"];
    const incomeTypes = ["income", "person_in", "cash_in"];
    const onlyAll = ["own_transfer", "loan_in", "goal_contribution", null];
    for (const type of [...spendTypes, ...incomeTypes, ...onlyAll]) await tx(a, { type, description: `t:${type}` });
    const types = async (q: string) =>
      ((await api.get(`/transactions${q}`).expect(200)).body.items as { type: string | null }[]).map((t) => t.type);
    expect((await types("?group=spend")).sort()).toEqual([...spendTypes].sort());
    expect((await types("?group=income")).sort()).toEqual([...incomeTypes].sort());
    expect(await types("?group=all")).toHaveLength(13);
    expect(await types("")).toHaveLength(13);
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
        "accountKind", "amount", "amountUah", "category", "counterKey", "counterName", "currency", "description",
        "fxRate", "hold", "id", "localDate", "needsLabel", "occurredAt", "type",
      ].sort(),
    );
    expect(x).toMatchObject({ accountKind: "fop", currency: "UAH", counterName: "Ivan P", hold: false });
    expect(x.counterKey).toMatch(/^[0-9a-f]{16}$/);
    expect(x.counterKey).toBe(y.counterKey);
    expect(x.occurredAt).toBe("2026-11-18T10:00:00.000Z");
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
    const res = await api.patch(`/transactions/${t}`, { type: "cash_out", category: "cash" }).expect(200);
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

    // A new row of the same merchant picks up the rule through classify.
    const later = await tx(a, { description: "UKLON ride", type: null, source: null, at: "2026-11-20T10:00:00.000Z" });
    await app.get(ReclassifyService).reclassifyIds([later]);
    expect(await row("SELECT type, type_source FROM transactions WHERE id=$1", [later])).toEqual({
      type: "person_transfer",
      type_source: "rule",
    });
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
    await api.patch(`/transactions/${t}`, { type: "spend", category: "taxi", applyToSimilar: true }).expect(200);
    expect(await ds.query(`SELECT match_value, type, category FROM rules`)).toEqual([
      { match_value: "uklon", type: "spend", category: "taxi" },
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
