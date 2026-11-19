import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { Clock } from "../src/time/clock";
import { ReclassifyService } from "../src/transactions/reclassify.service";

// Task В5: the categories are records the owner can rename, reorder, add and delete. Their keys are what rows,
// rules and cash operations store; a deleted one's rows go to «Без категории», and nothing else about money changes.

let app: INestApplication;
let ds: DataSource;
let auth: string;
let seq = 0;
let seeded: Record<string, unknown>[] = [];

const http = () => app.getHttpServer();
const api = {
  get: (p: string) => request(http()).get(p).set("Authorization", auth),
  post: (p: string, b: object = {}) => request(http()).post(p).set("Authorization", auth).send(b),
  patch: (p: string, b: object = {}) => request(http()).patch(p).set("Authorization", auth).send(b),
  put: (p: string, b: object = {}) => request(http()).put(p).set("Authorization", auth).send(b),
  del: (p: string) => request(http()).delete(p).set("Authorization", auth),
};

const DEFAULTS = [
  { key: "groceries", name: "Продукты", icon: "cart", system: false, want: false },
  { key: "cafe", name: "Кафе и рестораны", icon: "coffee", system: false, want: true },
  { key: "transport", name: "Транспорт", icon: "car", system: false, want: false },
  { key: "subscriptions", name: "Подписки", icon: "repeat", system: false, want: true },
  { key: "leisure", name: "Досуг", icon: "ticket", system: false, want: true },
  { key: "health", name: "Здоровье", icon: "heart", system: false, want: false },
  { key: "utilities", name: "Коммунальные", icon: "bolt", system: false, want: false },
  { key: "telecom", name: "Связь", icon: "phone", system: false, want: false },
  { key: "shopping", name: "Покупки", icon: "bag", system: false, want: true },
  { key: "refund", name: "Возвраты", icon: "arrowIn", system: true, want: null },
  { key: "uncategorized", name: "Без категории", icon: "circle", system: true, want: null },
];
const keys = async (): Promise<string[]> => ((await api.get("/categories").expect(200)).body as { key: string }[]).map((c) => c.key);

beforeAll(async () => {
  const url = await createMigratedDatabase();
  ds = new DS({ type: "postgres", url });
  await ds.initialize();
  app = await createTestApp(url);
  app.get(Clock).fixed = new Date("2026-11-10T10:00:00Z");
  const login = await request(http()).post("/auth/login").send({ password: TEST_PASSWORD, deviceName: "t" });
  auth = `Bearer ${login.body.token as string}`;
  seeded = await ds.query(`SELECT * FROM categories ORDER BY id`);
});
afterAll(async () => {
  await app.close();
  await ds.destroy();
});
beforeEach(async () => {
  await ds.query(`TRUNCATE jobs, rules, transactions, accounts, cash_answers RESTART IDENTITY CASCADE`);
  await ds.query(`TRUNCATE categories`);
  for (const c of seeded) {
    await ds.query(`INSERT INTO categories (id, key, name, icon, position, system, deleted_at, want) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
      c.id, c.key, c.name, c.icon, c.position, c.system, c.deleted_at, c.want,
    ]);
  }
  await ds.query(`UPDATE settings SET cash_start=NULL, cash_started_at=NULL, cash_counted_at=NULL`);
});

async function account(kind = "black"): Promise<number> {
  seq++;
  return (await ds.query(`INSERT INTO accounts (external_id, kind, currency, balance) VALUES ($1,$2,'UAH',0) RETURNING id`, [`acc-${seq}`, kind]))[0].id;
}
async function tx(accountId: number, category: string | null, over: { type?: string | null; source?: string | null; mcc?: number } = {}): Promise<number> {
  seq++;
  return (
    await ds.query(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, mcc, amount, amount_uah, type, category, type_source, raw)
       VALUES ($1,$2,'2026-11-09T10:00:00Z','2026-11-09','Кав''ярня',$3,-10000,-10000,$4,$5,$6,'{}') RETURNING id`,
      [`tx-${seq}`, accountId, over.mcc ?? null, over.type === undefined ? "spend" : over.type, category, over.source === undefined ? "auto" : over.source],
    )
  )[0].id;
}
const categoryOf = async (id: number): Promise<string | null> => (await ds.query(`SELECT category FROM transactions WHERE id=$1`, [id]))[0].category;

describe("the list", () => {
  it("is today's categories with their names, in the order of the app, until the owner changes it", async () => {
    expect((await api.get("/categories").expect(200)).body).toEqual(DEFAULTS);
  });

  it("needs the owner", async () => {
    await request(http()).get("/categories").expect(401);
  });
});

describe("adding", () => {
  it("adds a category at the end, with a key of its own that is not its name", async () => {
    const res = await api.post("/categories", { name: "  Кот  ", icon: "paw" }).expect(201);
    expect(res.body).toMatchObject({ name: "Кот", icon: "paw", system: false });
    const key = res.body.key as string;
    expect(DEFAULTS.map((c) => c.key)).not.toContain(key);
    expect(key).not.toMatch(/кот/i);
    expect(await keys()).toEqual([...DEFAULTS.map((c) => c.key), key]);

    const second = (await api.post("/categories", { name: "Кот 2", icon: "paw" }).expect(201)).body.key as string;
    expect(second).not.toBe(key);
    expect((await keys()).at(-1)).toBe(second);
  });

  it("refuses an empty, too long or taken name and an icon outside the set", async () => {
    await api.post("/categories", { name: "   ", icon: "paw" }).expect(400);
    await api.post("/categories", { name: "x".repeat(41), icon: "paw" }).expect(400);
    await api.post("/categories", { name: "Кот", icon: "🐈" }).expect(400);
    await api.post("/categories", { name: "Кот" }).expect(400);
    await api.post("/categories", { name: "кафе И рестораны", icon: "coffee" }).expect(409);
    await api.post("/categories", { name: "Без категории", icon: "circle" }).expect(409);
    await api.post("/categories", { name: "x".repeat(40), icon: "paw" }).expect(201);
  });

  it("gives a deleted category's name to a new one", async () => {
    await api.del("/categories/cafe").expect(200);
    const res = await api.post("/categories", { name: "Кафе и рестораны", icon: "coffee" }).expect(201);
    expect(res.body.key).not.toBe("cafe");
  });
});

describe("changing", () => {
  it("renames a category and changes its icon; its key and its rows stay", async () => {
    const t = await tx(await account(), "cafe");
    const res = await api.patch("/categories/cafe", { name: "Кофе" }).expect(200);
    expect(res.body).toEqual({ key: "cafe", name: "Кофе", icon: "coffee", system: false, want: true });
    expect((await api.patch("/categories/cafe", { icon: "star" }).expect(200)).body).toEqual({ key: "cafe", name: "Кофе", icon: "star", system: false, want: true });
    expect(await categoryOf(t)).toBe("cafe");
    expect(await keys()).toEqual(DEFAULTS.map((c) => c.key));
  });

  it("keeps a name unique, but lets a category keep its own name in another case", async () => {
    await api.patch("/categories/cafe", { name: "продукты" }).expect(409);
    await api.patch("/categories/cafe", { name: "КАФЕ и рестораны" }).expect(200);
  });

  it("does not rename «Возвраты» and «Без категории», but gives them another icon", async () => {
    await api.patch("/categories/refund", { name: "Возврат" }).expect(422);
    await api.patch("/categories/uncategorized", { name: "Прочее" }).expect(422);
    await api.patch("/categories/refund", { icon: "star" }).expect(200);
  });

  it("refuses an unknown or deleted category and an empty change", async () => {
    await api.patch("/categories/nope", { name: "Кот" }).expect(404);
    await api.del("/categories/cafe").expect(200);
    await api.patch("/categories/cafe", { name: "Кот" }).expect(404);
    await api.patch("/categories/groceries", {}).expect(400);
    await api.patch("/categories/groceries", { name: "" }).expect(400);
    await api.patch("/categories/groceries", { icon: "nope" }).expect(400);
  });
});

describe("«нужное» и «желаемое» (В6)", () => {
  it("a new category is «нужное» unless the owner says otherwise", async () => {
    expect((await api.post("/categories", { name: "Кот", icon: "paw" }).expect(201)).body).toMatchObject({ name: "Кот", want: false });
    expect((await api.post("/categories", { name: "Хобби", icon: "star", want: true }).expect(201)).body).toMatchObject({ name: "Хобби", want: true });
    await api.post("/categories", { name: "Кот 2", icon: "paw", want: null }).expect(400);
    await api.post("/categories", { name: "Кот 2", icon: "paw", want: "yes" }).expect(400);
  });

  it("moves a category to the other side alone or with a new name; its rows and their own choice stay", async () => {
    const t = await tx(await account(), "cafe");
    await ds.query(`UPDATE transactions SET want_override = true WHERE id = $1`, [t]);
    expect((await api.patch("/categories/cafe", { want: false }).expect(200)).body).toEqual({ key: "cafe", name: "Кафе и рестораны", icon: "coffee", system: false, want: false });
    expect((await api.patch("/categories/groceries", { name: "Еда", want: true }).expect(200)).body).toMatchObject({ name: "Еда", want: true });
    expect((await api.patch("/categories/groceries", { icon: "star" }).expect(200)).body).toMatchObject({ icon: "star", want: true });
    expect(await ds.query(`SELECT category, want_override FROM transactions WHERE id = $1`, [t])).toEqual([{ category: "cafe", want_override: true }]);
  });

  it("gives no side to «Возвраты» and «Без категории», and refuses a malformed one", async () => {
    await api.patch("/categories/refund", { want: true }).expect(422);
    await api.patch("/categories/uncategorized", { want: false }).expect(422);
    await api.patch("/categories/cafe", { want: null }).expect(400);
    await api.patch("/categories/cafe", { want: "true" }).expect(400);
    expect((await api.get("/categories").expect(200)).body).toEqual(DEFAULTS);
  });
});

describe("reordering", () => {
  it("puts the categories in the order given", async () => {
    const own = (await api.post("/categories", { name: "Кот", icon: "paw" }).expect(201)).body.key as string;
    const order = [own, ...DEFAULTS.map((c) => c.key).reverse()];
    const res = await api.put("/categories/order", { keys: order }).expect(200);
    expect((res.body as { key: string }[]).map((c) => c.key)).toEqual(order);
    expect(await keys()).toEqual(order);
    // A new one still goes to the end.
    const next = (await api.post("/categories", { name: "Дача", icon: "home" }).expect(201)).body.key as string;
    expect(await keys()).toEqual([...order, next]);
  });

  it("needs every live category exactly once", async () => {
    const all = DEFAULTS.map((c) => c.key);
    await api.put("/categories/order", { keys: all.slice(1) }).expect(422);
    await api.put("/categories/order", { keys: [...all, "groceries"] }).expect(422);
    await api.put("/categories/order", { keys: [...all.slice(1), "nope"] }).expect(422);
    await api.del("/categories/cafe").expect(200);
    await api.put("/categories/order", { keys: all }).expect(422);
    await api.put("/categories/order", { keys: all.filter((k) => k !== "cafe") }).expect(200);
    await api.put("/categories/order", {}).expect(400);
    expect(await keys()).toEqual(all.filter((k) => k !== "cafe"));
  });
});

describe("deleting", () => {
  it("moves the category's operations, cash operations and rules to «Без категории», in one go", async () => {
    const card = await account();
    const a = await tx(card, "cafe");
    const b = await tx(card, "cafe", { type: "person_transfer" });
    const other = await tx(card, "groceries");
    const cash = await tx(await account("cash"), "cafe");
    await ds.query(
      `INSERT INTO rules (match_kind, match_value, type, category, direction) VALUES ('merchant','кав''ярня','spend','cafe','out'), ('merchant','сільпо','spend','groceries','out')`,
    );

    const res = await api.del("/categories/cafe").expect(200);
    expect(res.body).toEqual({ deleted: true, moved: 3 });
    expect([await categoryOf(a), await categoryOf(b), await categoryOf(cash), await categoryOf(other)]).toEqual([
      "uncategorized", "uncategorized", "uncategorized", "groceries",
    ]);
    expect(await ds.query(`SELECT match_value, category FROM rules ORDER BY id`)).toEqual([
      { match_value: "кав'ярня", category: "uncategorized" },
      { match_value: "сільпо", category: "groceries" },
    ]);
    expect(await keys()).not.toContain("cafe");
    await api.del("/categories/cafe").expect(404);
  });

  it("an answer to «Откуда наличные?» undone later does not bring the deleted category back", async () => {
    const t = await tx(await account(), "cafe", { type: "own_transfer" });
    await ds.query(
      `INSERT INTO cash_answers (transaction_id, answer, type_before, category_before, type_source_before, needs_label_before, usdc_checked_before)
       VALUES ($1,'other','spend','cafe','auto',false,false)`,
      [t],
    );
    await api.del("/categories/cafe").expect(200);
    expect((await ds.query(`SELECT category_before FROM cash_answers`))[0].category_before).toBe("uncategorized");
  });

  it("does not delete «Возвраты» and «Без категории»", async () => {
    await api.del("/categories/refund").expect(422);
    await api.del("/categories/uncategorized").expect(422);
    await api.del("/categories/nope").expect(404);
    expect(await keys()).toEqual(DEFAULTS.map((c) => c.key));
  });

  it("an own category is deleted the same way", async () => {
    const own = (await api.post("/categories", { name: "Кот", icon: "paw" }).expect(201)).body.key as string;
    const t = await tx(await account(), own);
    expect((await api.del(`/categories/${own}`).expect(200)).body).toEqual({ deleted: true, moved: 1 });
    expect(await categoryOf(t)).toBe("uncategorized");
  });
});

describe("a category given to an operation", () => {
  it("is a live category: an own one works, an unknown or deleted one is refused", async () => {
    const t = await tx(await account(), "groceries");
    const own = (await api.post("/categories", { name: "Кот", icon: "paw" }).expect(201)).body.key as string;
    expect((await api.patch(`/transactions/${t}`, { category: own }).expect(200)).body.transaction.category).toBe(own);
    await api.patch(`/transactions/${t}`, { category: "taxi" }).expect(400);
    await api.del("/categories/cafe").expect(200);
    await api.patch(`/transactions/${t}`, { category: "cafe" }).expect(400);
    await api.patch(`/transactions/${t}`, { category: "cafe", applyToSimilar: true }).expect(400);
    expect(await categoryOf(t)).toBe(own);
    expect(await ds.query(`SELECT 1 FROM rules`)).toEqual([]);
  });

  it("a cash purchase takes an own category, and refuses an unknown or deleted one", async () => {
    await api.post("/cash/start", { amount: 500_000 }).expect(201);
    const own = (await api.post("/categories", { name: "Кот", icon: "paw" }).expect(201)).body.key as string;
    const created = (await api.post("/cash/operations", { kind: "spend", amount: 10_000, category: own }).expect(201)).body;
    expect(created.category).toBe(own);
    await api.post("/cash/operations", { kind: "spend", amount: 10_000, category: "groceries" }).expect(201);
    await api.post("/cash/operations", { kind: "spend", amount: 10_000, category: "taxi" }).expect(400);
    await api.patch(`/cash/operations/${created.id}`, { category: "taxi" }).expect(400);
    await api.del("/categories/cafe").expect(200);
    await api.post("/cash/operations", { kind: "spend", amount: 10_000, category: "cafe" }).expect(400);
    await api.patch(`/cash/operations/${created.id}`, { category: "cafe" }).expect(400);
    await api.patch(`/cash/operations/${created.id}`, { category: "groceries" }).expect(200);
    expect(await categoryOf(created.id)).toBe("groceries");
  });

  it("a category the classifier gives that the owner deleted is stored as «Без категории»", async () => {
    const card = await account();
    const coffee = await tx(card, null, { type: null, source: null, mcc: 5814 });
    await app.get(ReclassifyService).reclassifyIds([coffee]);
    expect(await categoryOf(coffee)).toBe("cafe");

    await api.del("/categories/cafe").expect(200);
    const later = await tx(card, null, { type: null, source: null, mcc: 5814 });
    await app.get(ReclassifyService).reclassifyIds([later]);
    expect(await categoryOf(later)).toBe("uncategorized");
    // The categories of other types are not in the list and stay as they are.
    const cash = await tx(card, null, { type: null, source: null, mcc: 6011 });
    await app.get(ReclassifyService).reclassifyIds([cash]);
    expect(await categoryOf(cash)).toBe("cash");
  });
});
