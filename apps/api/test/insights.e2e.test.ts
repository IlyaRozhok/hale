import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insightsMonthDto } from "@hale/contracts";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { spentSql } from "../src/domain/ledger";
import { Clock, kyivDaySql } from "../src/time/clock";

// Task В1: «Итоги» for a month. Spending is the limit's one definition, so for any stretch the categories add up to
// exactly what spentSql (the «потрачено» of «Сегодня») gives over the same days, whatever else lies in the table.

let app: INestApplication;
let ds: DataSource;
let auth: string;
let seq = 0;

const NOW = new Date("2026-11-16T10:00:00Z");
const http = () => app.getHttpServer();
const get = (p: string) => request(http()).get(p).set("Authorization", auth);

beforeAll(async () => {
  const url = await createMigratedDatabase();
  ds = new DS({ type: "postgres", url });
  await ds.initialize();
  app = await createTestApp(url);
  app.get(Clock).fixed = NOW;
  const login = await request(http()).post("/auth/login").send({ password: TEST_PASSWORD, deviceName: "t" });
  auth = `Bearer ${login.body.token as string}`;
});
afterAll(async () => {
  await app.close();
  await ds.destroy();
});

async function account(kind: string): Promise<number> {
  seq++;
  return (await ds.query(`INSERT INTO accounts (external_id, kind, currency, balance) VALUES ($1,$2,'UAH',0) RETURNING id`, [`acc-${seq}`, kind]))[0].id;
}

/** `at` is an instant; its Kyiv day is the row's day. `amountUah` null is a row the rate was not known for. */
async function tx(accountId: number, at: string, amount: number, type: string, category: string | null, amountUah: number | null = amount): Promise<void> {
  seq++;
  await ds.query(
    `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, category, raw)
     VALUES ($1,$2,$3,${kyivDaySql("$3::timestamptz")},'x',$4,$5,$6,$7,'{}')`,
    [`tx-${seq}`, accountId, at, amount, amountUah, type, category],
  );
}

const limitSpent = async (from: string, to: string): Promise<number> => (await ds.query(spentSql("$1", "$2"), [from, to]))[0].s;

beforeEach(async () => {
  await ds.query(
    `TRUNCATE jobs, rules, transactions, accounts, fx_rates, income_events, expected_incomes,
              scheduled_payments, recurring_payments, manual_balances, loans, bridge_plans, daily_snapshots, goals
     RESTART IDENTITY CASCADE`,
  );
  await ds.query(`UPDATE settings SET cash_start='2026-11-10'`);
  const black = await account("black");
  const white = await account("white");
  const jar = await account("jar");

  // November, up to the 16th.
  await tx(black, "2026-11-02T10:00:00Z", -40_000, "spend", "groceries");
  await tx(black, "2026-11-03T10:00:00Z", -12_000, "spend", "groceries");
  await tx(white, "2026-11-04T10:00:00Z", -9_000, "spend", "cafe");
  await tx(black, "2026-11-05T10:00:00Z", -30_000, "spend", "shopping");
  await tx(black, "2026-11-06T10:00:00Z", 12_000, "spend", "refund"); // a refund of part of the purchase
  await tx(black, "2026-11-06T11:00:00Z", 2_000, "spend", "cafe"); // a refund inside a category
  await tx(black, "2026-11-07T10:00:00Z", -25_000, "person_transfer", "people");
  await tx(black, "2026-11-08T10:00:00Z", -5_000, "cash_out", null); // before the wallet start: counts
  await tx(black, "2026-11-11T10:00:00Z", -7_000, "cash_out", null); // after it: moves money into the wallet
  await tx(jar, "2026-11-09T10:00:00Z", -99_000, "spend", "shopping"); // a purchase from a jar
  await tx(black, "2026-11-09T12:00:00Z", -50_000, "own_transfer", "own");
  await tx(white, "2026-11-09T12:01:00Z", 50_000, "own_transfer", "own");
  await tx(black, "2026-11-10T10:00:00Z", -80_000, "obligation", "utilities"); // a payment outside the limit
  await tx(black, "2026-11-12T10:00:00Z", -3_000, "spend", "subscriptions", null); // no hryvnia amount
  await tx(black, "2026-11-13T10:00:00Z", -1_500, "spend", null);

  // October: up to the 16th by Kyiv day, and after it.
  await tx(black, "2026-10-01T10:00:00Z", -20_000, "spend", "groceries");
  await tx(white, "2026-10-10T10:00:00Z", -6_000, "spend", "transport");
  await tx(black, "2026-10-16T20:59:00Z", -4_000, "spend", "cafe"); // 23:59 in Kyiv: still the 16th
  await tx(black, "2026-10-16T21:01:00Z", -70_000, "spend", "groceries"); // 00:01 on the 17th in Kyiv
  await tx(black, "2026-10-25T10:00:00Z", -11_000, "spend", "health");
  // September.
  await tx(black, "2026-09-30T10:00:00Z", -8_000, "spend", "leisure");
});

describe("GET /insights/month", () => {
  it("needs the owner's sign-in", async () => {
    await request(http()).get("/insights/month").expect(401);
    await request(http()).get("/insights/month?month=2026-10").expect(401);
  });

  it("counts the current Kyiv month to today against the same days of the month before", async () => {
    const r = await get("/insights/month").expect(200);
    expect(insightsMonthDto.safeParse(r.body).success).toBe(true);
    expect(r.body).toEqual({
      month: "2026-11",
      through: "2026-11-16",
      previous: { from: "2026-10-01", to: "2026-10-16" },
      spent: 40_000 + 12_000 + 9_000 - 2_000 + 30_000 - 12_000 + 25_000 + 5_000 + 1_500,
      previousSpent: 20_000 + 6_000 + 4_000,
      categories: [
        { category: "groceries", spent: 52_000, previousSpent: 20_000, count: 2 },
        { category: "shopping", spent: 30_000, previousSpent: 0, count: 1 },
        { category: "people", spent: 25_000, previousSpent: 0, count: 1 },
        { category: "cafe", spent: 7_000, previousSpent: 4_000, count: 2 },
        { category: "uncategorized", spent: 6_500, previousSpent: 0, count: 2 },
        { category: "transport", spent: 0, previousSpent: 6_000, count: 0 },
        { category: "refund", spent: -12_000, previousSpent: 0, count: 1 },
      ],
      // Every row here has the bank text 'x': one place. The purchases from the jar and without a hryvnia amount are
      // not the limit's, the refunds lower it and are not visits. The history starts in September: nothing is new.
      places: [{ key: expect.stringMatching(/^[0-9a-f]{16}$/), name: "x", spent: 40_000 + 12_000 + 9_000 + 30_000 - 12_000 - 2_000 + 1_500, visits: 5, isNew: false }],
      // The planned payment of the 10th, outside the limit and outside `spent` (В2а).
      otherPayments: 80_000,
      previousOtherPayments: 0,
    });
  });

  it("sums the payments outside the limit — planned payments, taxes, debts — over the same stretches, apart from `spent` (В2а)", async () => {
    const [black, white, jar] = ((await ds.query(`SELECT id FROM accounts ORDER BY id`)) as { id: number }[]).map((r) => r.id) as [number, number, number];
    const cash = await account("cash");
    const before = (await get("/insights/month").expect(200)).body;

    // In: each payment type, on a card and from the cash wallet.
    await tx(black, "2026-11-03T10:00:00Z", -795_000, "tax", "tax");
    await tx(white, "2026-11-05T10:00:00Z", -730_100, "debt_payment", "debt"); // an installment or a loan repaid
    await tx(cash, "2026-11-12T10:00:00Z", -30_000, "obligation", "transfer"); // a planned payment paid in cash
    // Out: what the limit leaves out for its own reasons, and moves of money that are not payments.
    await tx(black, "2026-11-04T10:00:00Z", -11_000, "obligation", "transfer", null); // no hryvnia amount
    await tx(jar, "2026-11-04T11:00:00Z", -12_000, "obligation", "transfer"); // on a jar
    await tx(black, "2026-11-06T10:00:00Z", -200_000, "loan_out", "people"); // a loan given: comes back
    await tx(black, "2026-11-06T11:00:00Z", -100_000, "goal_contribution", "own"); // into savings
    await tx(black, "2026-11-12T11:00:00Z", -300_000, "own_transfer", "own"); // own money moved
    await tx(black, "2026-11-12T12:00:00Z", -40_000, "cash_out", null); // into the wallet, after its start
    seq++;
    await ds.query(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, category, raw)
       VALUES ($1,$2,'2026-11-14T10:00:00Z','2026-11-14','Не записано',-60000,-60000,'spend','uncategorized','{"cash_count":"short"}')`,
      [`tx-${seq}`, cash],
    );
    // The month before: on its first sixteen days, and after them.
    await tx(black, "2026-10-14T10:00:00Z", -120_000, "tax", "tax");
    await tx(black, "2026-10-20T10:00:00Z", -1_870_500, "obligation", "transfer");

    const now = (await get("/insights/month").expect(200)).body;
    expect(insightsMonthDto.safeParse(now).success).toBe(true);
    expect(now.otherPayments).toBe(80_000 + 795_000 + 730_100 + 30_000);
    expect(now.previousOtherPayments).toBe(120_000);
    // «Потрачено» and its categories stay the limit's alone.
    expect(now.spent).toBe(before.spent);
    expect(now.categories).toEqual(before.categories);
    expect(now.spent).toBe(await limitSpent("2026-11-01", now.through));

    const october = (await get("/insights/month?month=2026-10").expect(200)).body;
    expect(october.otherPayments).toBe(120_000 + 1_870_500);
    expect(october.previousOtherPayments).toBe(0);
  });

  it("names the month's largest places, with visits and the sum after refunds, and marks the new ones (В3)", async () => {
    const black = (await ds.query(`SELECT id FROM accounts WHERE kind='black'`))[0].id as number;
    const jar = (await ds.query(`SELECT id FROM accounts WHERE kind='jar'`))[0].id as number;
    const cash = await account("cash");
    const at = async (accountId: number, when: string, amount: number, type: string, description: string, counterName: string | null = null, raw = "{}") => {
      seq++;
      await ds.query(
        `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, counter_name, amount, amount_uah, type, category, raw)
         VALUES ($1,$2,$3,${kyivDaySql("$3::timestamptz")},$4,$5,$6,$6,$7,'cafe',$8::jsonb)`,
        [`tx-${seq}`, accountId, when, description, counterName, amount, type, raw],
      );
    };
    // The history reaches back over the three months before November.
    await at(black, "2026-07-20T10:00:00Z", -50_000, "spend", "Rozetka");
    // A coffee shop seen in September: three visits in November and a refund there, named as the purchase.
    await at(black, "2026-09-12T10:00:00Z", -6_000, "spend", "Aroma Kava");
    await at(black, "2026-11-02T08:00:00Z", -6_000, "spend", "Aroma Kava");
    await at(black, "2026-11-05T08:00:00Z", -6_000, "spend", "aroma  kava "); // the same place, as the key normalises it
    await at(black, "2026-11-09T08:00:00Z", -6_000, "spend", "Aroma Kava");
    await at(black, "2026-11-09T09:00:00Z", 2_000, "spend", "Aroma Kava");
    // Last bought at before the lookback: new again.
    await at(black, "2026-11-03T10:00:00Z", -50_000, "spend", "Rozetka");
    // Named by the counterparty, as «Операции» names it; never seen before.
    await at(black, "2026-11-04T10:00:00Z", -7_000, "spend", "Оплата", "ФОП Петренко");
    await at(black, "2026-11-06T10:00:00Z", -3_000, "spend", "Uklon");
    await at(black, "2026-11-07T10:00:00Z", -1_000, "spend", "Kiosk"); // the sixth: below the top five
    // Not places: a person, the cash wallet, a withdrawal, the jar, a count's shortfall, a refund with no purchase.
    await at(black, "2026-11-08T10:00:00Z", -900_000, "person_transfer", "Олена");
    await at(cash, "2026-11-10T10:00:00Z", -900_000, "spend", "Ринок");
    await at(black, "2026-11-08T11:00:00Z", -900_000, "cash_out", "Банкомат");
    await at(jar, "2026-11-08T12:00:00Z", -900_000, "spend", "Jar Shop");
    await at(cash, "2026-11-14T10:00:00Z", -900_000, "spend", "Не записано", null, `{"cash_count":"short"}`);
    await at(black, "2026-11-14T11:00:00Z", -900_000, "spend", "Short Shop", null, `{"cash_count":"short"}`);
    await at(black, "2026-11-12T10:00:00Z", 4_000, "spend", "Скасування. Zara");

    const { body } = await get("/insights/month").expect(200);
    expect(insightsMonthDto.safeParse(body).success).toBe(true);
    expect(body.places.map((p: Record<string, unknown>) => [p.name, p.spent, p.visits, p.isNew])).toEqual([
      ["x", 78_500, 5, false], // bought at in September and October
      ["Rozetka", 50_000, 1, true],
      ["Aroma Kava", 16_000, 3, false],
      ["ФОП Петренко", 7_000, 1, true],
      ["Uklon", 3_000, 1, true],
    ]);
    // The key is the counterparty's, as on the transaction in «Операции».
    const list = (await get("/transactions?group=spend&limit=200&from=2026-11-01&to=2026-11-16").expect(200)).body.items as {
      counterKey: string;
      description: string;
    }[];
    expect(body.places[2].key).toBe(list.find((i) => i.description === "Aroma Kava")!.counterKey);
  });

  it("counts the places of a past month to its last day (В3)", async () => {
    const { body } = await get("/insights/month?month=2026-10").expect(200);
    expect(body.places).toEqual([{ key: expect.any(String), name: "x", spent: 20_000 + 6_000 + 4_000 + 70_000 + 11_000, visits: 5, isNew: false }]);
  });

  it("adds up to the limit's spending over the same days, for both stretches", async () => {
    for (const q of ["", "?month=2026-10", "?month=2026-09"]) {
      const { body } = await get(`/insights/month${q}`).expect(200);
      expect(insightsMonthDto.safeParse(body).success).toBe(true);
      const sum = (k: "spent" | "previousSpent") => body.categories.reduce((s: number, c: Record<string, number>) => s + c[k]!, 0);
      expect(sum("spent")).toBe(body.spent);
      expect(sum("previousSpent")).toBe(body.previousSpent);
      expect(body.spent).toBe(await limitSpent(`${body.month}-01`, body.through));
      expect(body.previousSpent).toBe(await limitSpent(body.previous.from, body.previous.to));
    }
  });

  it("leaves out a count's shortfall «Не записано», as the limit does (Б47 (2))", async () => {
    const before = (await get("/insights/month").expect(200)).body;
    const cash = await account("cash");
    seq++;
    await ds.query(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, category, raw)
       VALUES ($1,$2,'2026-11-14T10:00:00Z','2026-11-14','Не записано',-60000,-60000,'spend','uncategorized','{"cash_count":"short"}')`,
      [`tx-${seq}`, cash],
    );
    const after = (await get("/insights/month").expect(200)).body;
    expect(after).toEqual(before);
    expect(after.spent).toBe(await limitSpent("2026-11-01", after.through));
  });

  it("matches the «Траты» list under each category's filter, «Без категории» with empty categories included (В8)", async () => {
    const black = (await ds.query(`SELECT id FROM accounts WHERE kind='black'`))[0].id as number;
    await tx(black, "2026-11-14T12:00:00Z", -4_000, "spend", "uncategorized"); // the key itself, next to empty ones
    await tx(black, "2026-10-03T10:00:00Z", -2_500, "spend", null); // an empty category in the month before
    await tx(black, "2026-11-15T10:00:00Z", -6_000, "obligation", null); // listed, outside the limit
    const cash = await account("cash");
    seq++;
    await ds.query(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, category, raw)
       VALUES ($1,$2,'2026-11-14T10:00:00Z','2026-11-14','Не записано',-60000,-60000,'spend','uncategorized','{"cash_count":"short"}')`,
      [`tx-${seq}`, cash],
    );
    const list = async (category: string, from: string, to: string) =>
      (await get(`/transactions?group=spend&limit=200&category=${category}&from=${from}&to=${to}`).expect(200)).body;

    for (const q of ["", "?month=2026-10"]) {
      const { body } = await get(`/insights/month${q}`).expect(200);
      expect(body.categories.map((c: { category: string }) => c.category)).toContain("uncategorized");
      for (const c of body.categories as { category: string; spent: number; previousSpent: number; count: number }[]) {
        const current = await list(c.category, `${body.month}-01`, body.through);
        expect(current.summary, `${body.month} ${c.category}`).toEqual({ total: 0 - c.spent, count: c.count });
        const previous = await list(c.category, body.previous.from, body.previous.to);
        expect(previous.summary.total, `${body.previous.from} ${c.category}`).toBe(0 - c.previousSpent);
      }
    }

    // The shortfall and the payment are on the list under «Без категории», marked outside the limit, and not counted.
    // In the limit: the withdrawal before the wallet start, the empty spend and the one filed under the key itself.
    const items = (await list("uncategorized", "2026-11-01", "2026-11-16")).items as { amount: number; inLimit: boolean }[];
    expect(items.filter((i) => !i.inLimit).map((i) => i.amount)).toEqual([-6_000, -60_000]);
    expect(items.filter((i) => i.inLimit).map((i) => i.amount)).toEqual([-4_000, -1_500, -5_000]);
  });

  it("counts a past month to its last day", async () => {
    const { body } = await get("/insights/month?month=2026-10").expect(200);
    expect(body).toMatchObject({ month: "2026-10", through: "2026-10-31", previous: { from: "2026-09-01", to: "2026-09-30" } });
    expect(body.spent).toBe(20_000 + 6_000 + 4_000 + 70_000 + 11_000);
    expect(body.previousSpent).toBe(8_000);
  });

  it("answers a month with nothing in it with zeros", async () => {
    const { body } = await get("/insights/month?month=2025-01").expect(200);
    expect(body).toEqual({ month: "2025-01", through: "2025-01-31", previous: { from: "2024-12-01", to: "2024-12-31" }, spent: 0, previousSpent: 0, categories: [], places: [], otherPayments: 0, previousOtherPayments: 0 });
  });

  it("refuses a malformed month and a month in the future", async () => {
    for (const q of ["?month=2026-13", "?month=2026-1", "?month=nov", "?month=2026-11&x=1"]) await get(`/insights/month${q}`).expect(400);
    await get("/insights/month?month=2026-12").expect(400);
  });
});
