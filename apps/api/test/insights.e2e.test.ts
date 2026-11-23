import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource as DS, type DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insightsMonthDto } from "@hale/contracts";
import { createMigratedDatabase, createTestApp, TEST_PASSWORD } from "./app";
import { isPaidToPerson, paidToPersonSql } from "../src/domain/insights";
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
              scheduled_payments, recurring_payments, manual_balances, loans, bridge_plans, daily_snapshots, goals, not_subscriptions
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
      // No place here charges about the same sum about monthly (В4).
      subscriptions: { monthly: 0, items: [] },
      // «Желаемое» (В6): the cafe after its refund and the shopping; not the jar, not the subscription without a
      // hryvnia amount, not «Возвраты», the transfer or «Без категории». October: the cafe.
      wanted: 9_000 - 2_000 + 30_000,
      previousWanted: 4_000,
      // This server remembers «Не подписка» (ЯМ6): the app may offer it.
      canMarkNotSubscription: true,
    });
  });

  it("names the part of `spent` that went on «желаемое», by the category's side or the operation's own; «Операции» with want=true list exactly those rows (В6)", async () => {
    const black = (await ds.query(`SELECT id FROM accounts WHERE kind='black'`))[0].id as number;
    await ds.query(`INSERT INTO categories (key, name, icon, position, want) VALUES ('c_hobby', 'Хобби', 'star', 20, true) ON CONFLICT (key) DO NOTHING`);
    await tx(black, "2026-11-14T10:00:00Z", -3_000, "spend", "c_hobby"); // an own category on «желаемое»
    // The operation's own choice wins over its category's, both ways.
    await ds.query(`UPDATE transactions SET want_override = true WHERE category = 'groceries' AND amount = -40000`);
    await ds.query(`UPDATE transactions SET want_override = false WHERE category = 'shopping' AND local_date = '2026-11-05'`);
    // A choice left on a row that is no purchase, or in a system category, puts it on neither side.
    await ds.query(`UPDATE transactions SET want_override = true WHERE type = 'person_transfer' OR category IN ('refund') OR category IS NULL`);

    const { body } = await get("/insights/month").expect(200);
    expect(insightsMonthDto.safeParse(body).success).toBe(true);
    expect(body.wanted).toBe(40_000 + 9_000 - 2_000 + 3_000);
    expect(body.previousWanted).toBe(4_000);
    expect(body.spent).toBe(await limitSpent("2026-11-01", body.through)); // a part of «потрачено», not added to it

    const list = async (q: string) => (await get(`/transactions?want=true&limit=200&${q}`).expect(200)).body;
    const current = await list("from=2026-11-01&to=2026-11-16");
    expect(current.summary).toEqual({ total: -body.wanted, count: 4 });
    expect(current.items.map((i: { amount: number }) => i.amount)).toEqual([-3_000, 2_000, -9_000, -40_000]);
    expect(current.items.every((i: { inLimit: boolean; want: boolean }) => i.inLimit && i.want)).toBe(true);
    expect((await list("group=spend&from=2026-11-01&to=2026-11-16")).summary).toEqual(current.summary);
    expect((await list("from=2026-10-01&to=2026-10-16")).summary).toEqual({ total: -4_000, count: 1 });
  });

  it("never names a negative «желаемое»: a refund larger than the purchases makes it zero, while «Операции» show the sum as it is (В6)", async () => {
    const black = (await ds.query(`SELECT id FROM accounts WHERE kind='black'`))[0].id as number;
    await tx(black, "2026-09-10T10:00:00Z", 20_000, "spend", "leisure"); // a refund bigger than September's leisure
    const { body } = await get("/insights/month?month=2026-09").expect(200);
    expect(body.wanted).toBe(0);
    expect((await get(`/transactions?want=true&from=2026-09-01&to=2026-09-30`).expect(200)).body.summary).toEqual({ total: 12_000, count: 2 });
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

    // Task Я8: «Операции» with other=true list exactly those rows, and their summary is the line's sum over the same
    // days — under «Траты» too, where these rows are listed but do not count against the limit.
    const list = async (q: string) => (await get(`/transactions?other=true&limit=200&${q}`).expect(200)).body;
    for (const group of ["", "group=spend&"]) {
      const current = await list(`${group}from=2026-11-01&to=${now.through}`);
      expect(current.summary, group).toEqual({ total: -now.otherPayments, count: 4 });
      expect(current.items.map((i: { amount: number }) => i.amount)).toEqual([-30_000, -80_000, -730_100, -795_000]);
      expect(current.items.every((i: { inLimit: boolean }) => !i.inLimit)).toBe(true);
      expect(current.dayTotals).toEqual({ "2026-11-12": -30_000, "2026-11-10": -80_000, "2026-11-05": -730_100, "2026-11-03": -795_000 });
      expect((await list(`${group}from=${now.previous.from}&to=${now.previous.to}`)).summary).toEqual({ total: -now.previousOtherPayments, count: 1 });
      expect((await list(`${group}from=2026-10-01&to=${october.through}`)).summary).toEqual({ total: -october.otherPayments, count: 2 });
    }
    // None of them is income.
    expect((await list("group=income")).items).toEqual([]);
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

  it("finds the subscriptions among the card purchases of the limit: the price rise, the one not charged for a while (В4)", async () => {
    const black = (await ds.query(`SELECT id FROM accounts WHERE kind='black'`))[0].id as number;
    const white = (await ds.query(`SELECT id FROM accounts WHERE kind='white'`))[0].id as number;
    const jar = (await ds.query(`SELECT id FROM accounts WHERE kind='jar'`))[0].id as number;
    const cash = await account("cash");
    const at = async (accountId: number, day: string, amount: number, type: string, description: string, counterName: string | null = null, amountUah: number | null = amount) => {
      seq++;
      await ds.query(
        `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, counter_name, amount, amount_uah, type, category, raw)
         VALUES ($1,$2,$3,${kyivDaySql("$3::timestamptz")},$4,$5,$6,$7,$8,'subscriptions','{}')`,
        [`tx-${seq}`, accountId, `${day}T10:00:00Z`, description, counterName, amount, amountUah, type],
      );
    };
    const monthly = async (days: string[], accountId: number, amount: number, type: string, description: string, counterName: string | null = null, amountUah: number | null = amount) => {
      for (const d of days) await at(accountId, d, amount, type, description, counterName, amountUah);
    };
    // A subscription, its price risen in November. October's charge was refunded two days later: the refund is not a
    // charge, and the charge it returned still keeps the chain (a refunded month is not a missed one).
    await monthly(["2026-08-05", "2026-09-05", "2026-10-05"], black, -24_900, "spend", "Netflix");
    await at(black, "2026-11-05", -29_900, "spend", "Netflix");
    await at(black, "2026-10-07", 24_900, "spend", "Netflix");
    // Charged to the white card under the counterparty's name, last in August.
    await monthly(["2026-06-04", "2026-07-04", "2026-08-04"], white, -90_000, "spend", "Оплата", "Sport Life");
    // Not subscriptions: not the limit's (a jar, a planned payment, no hryvnia amount), a person, the cash wallet.
    await monthly(["2026-08-10", "2026-09-10", "2026-10-10", "2026-11-10"], jar, -10_000, "spend", "Jar Shop");
    await monthly(["2026-08-11", "2026-09-11", "2026-10-11", "2026-11-11"], black, -20_000, "obligation", "Kyivstar");
    await monthly(["2026-08-12", "2026-09-12", "2026-10-12", "2026-11-12"], black, -30_000, "spend", "Google", null, null);
    await monthly(["2026-08-13", "2026-09-13", "2026-10-13", "2026-11-13"], black, -40_000, "person_transfer", "Олена");
    await monthly(["2026-08-14", "2026-09-14", "2026-10-14", "2026-11-14"], cash, -50_000, "spend", "Оренда");

    const { body } = await get("/insights/month").expect(200);
    expect(insightsMonthDto.safeParse(body).success).toBe(true);
    expect(body.subscriptions).toEqual({
      monthly: 29_900,
      items: [
        { key: expect.stringMatching(/^[0-9a-f]{16}$/), name: "Netflix", amount: 29_900, lastDate: "2026-11-05", raisedBy: 5_000, missed: 0 },
        // Due on 4 September and 4 October; not on the total.
        { key: expect.stringMatching(/^[0-9a-f]{16}$/), name: "Sport Life", amount: 90_000, lastDate: "2026-08-04", raisedBy: 0, missed: 2 },
      ],
    });
    // The key is the counterparty's, as on the transaction in «Операции».
    const list = (await get("/transactions?group=spend&limit=200&from=2026-11-01&to=2026-11-16").expect(200)).body.items as {
      counterKey: string;
      description: string;
    }[];
    expect(body.subscriptions.items[0].key).toBe(list.find((i) => i.description === "Netflix")!.counterKey);

    // Task Я8: «Операции» with place=<key> list that place's operations — its charges and the refund — and nothing else.
    const place = async (key: string, q = "") => (await get(`/transactions?place=${key}&limit=200${q}`).expect(200)).body;
    const netflix = await place(body.subscriptions.items[0].key);
    expect(netflix.items.map((i: { localDate: string; amount: number }) => [i.localDate, i.amount])).toEqual([
      ["2026-11-05", -29_900],
      ["2026-10-07", 24_900],
      ["2026-10-05", -24_900],
      ["2026-09-05", -24_900],
      ["2026-08-05", -24_900],
    ]);
    expect(netflix.summary).toEqual({ total: -29_900 - 24_900 * 2, count: 5 });
    const sportLife = await place(body.subscriptions.items[1].key, "&group=spend");
    expect(sportLife.items.map((i: { counterName: string | null; amount: number }) => [i.counterName, i.amount])).toEqual([
      ["Sport Life", -90_000],
      ["Sport Life", -90_000],
      ["Sport Life", -90_000],
    ]);
    expect(sportLife.summary).toEqual({ total: -270_000, count: 3 });

    // A past month is seen as of its last day: November's charge and rise are not there yet.
    const october = (await get("/insights/month?month=2026-10").expect(200)).body;
    expect(october.subscriptions.monthly).toBe(24_900);
    expect(october.subscriptions.items.map((i: Record<string, unknown>) => [i.name, i.amount, i.lastDate, i.raisedBy, i.missed])).toEqual([
      ["Netflix", 24_900, "2026-10-05", 0, 0],
      ["Sport Life", 90_000, "2026-08-04", 0, 2],
    ]);
  });

  it("leaves a transfer to a person out of places and subscriptions when the owner made it a purchase; the limit still counts it (Б56)", async () => {
    const black = (await ds.query(`SELECT id FROM accounts WHERE kind='black'`))[0].id as number;
    const at = async (day: string, amount: number, mcc: number | null, typeSource: string | null, description: string, counterName: string | null) => {
      seq++;
      await ds.query(
        `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, counter_name, mcc, amount, amount_uah, type, type_source, category, raw)
         VALUES ($1,$2,$3,${kyivDaySql("$3::timestamptz")},$4,$5,$6,$7,$7,'spend',$8,'leisure','{}')`,
        [`tx-${seq}`, black, `${day}T10:00:00Z`, description, counterName, mcc, amount, typeSource],
      );
    };
    const before = (await get("/insights/month").expect(200)).body;
    // Sent to a person every month by card transfer, marked a purchase by the owner (a rule by recipient, or by hand).
    for (const d of ["2026-08-03", "2026-09-03", "2026-10-03", "2026-11-03"]) await at(d, -150_000, 4829, "owner", "Марта Л.", "Марта Л.");
    await at("2026-11-04", -90_000, 4829, "owner", "Переказ на картку", "*1234");
    // Still places: a company paid by account number every month, a store installment the bank's text names.
    for (const d of ["2026-08-06", "2026-09-06", "2026-10-06", "2026-11-06"]) await at(d, -40_000, 4829, "owner", "Оплата за інтернет", "ТОВ Мережа");
    await at("2026-11-07", -60_000, 4829, "rule", "Платіж Comfy", null);

    const { body } = await get("/insights/month").expect(200);
    expect(insightsMonthDto.safeParse(body).success).toBe(true);
    const names = body.places.map((p: { name: string }) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Платіж Comfy", "ТОВ Мережа"]));
    expect(names).not.toContain("Марта Л.");
    expect(names).not.toContain("*1234");
    expect(body.subscriptions.items.map((i: { name: string }) => i.name)).toEqual(["ТОВ Мережа"]);
    // Only the places changed: the transfers count in the limit and in their category as before.
    expect(body.spent - before.spent).toBe(150_000 + 90_000 + 40_000 + 60_000);
    expect(body.spent).toBe(await limitSpent("2026-11-01", "2026-11-16"));
    expect(body.categories.find((c: { category: string }) => c.category === "leisure")).toMatchObject({ spent: 150_000 + 90_000 + 40_000 + 60_000, count: 4 });

    // The database says what the pure rule says, row by row.
    const rows = (await ds.query(
      `SELECT t.mcc, t.type_source AS "typeSource", t.description, t.counter_name AS "counterName", ${paidToPersonSql("t")} AS person
         FROM transactions t WHERE t.category = 'leisure'`,
    )) as { mcc: number | null; typeSource: string | null; description: string; counterName: string | null; person: boolean }[];
    expect(rows.filter((r) => r.person)).toHaveLength(5);
    for (const r of rows) expect([r.description, r.person]).toEqual([r.description, isPaidToPerson(r)]);
  });

  it("leaves out a place marked «Не подписка» in this month and a past one, and brings it back once unmarked; the limit stays the same (ЯМ6)", async () => {
    const black = (await ds.query(`SELECT id FROM accounts WHERE kind='black'`))[0].id as number;
    const at = async (day: string, amount: number, description: string) => {
      seq++;
      await ds.query(
        `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, category, raw)
         VALUES ($1,$2,$3,${kyivDaySql("$3::timestamptz")},$4,$5,$5,'spend','subscriptions','{}')`,
        [`tx-${seq}`, black, `${day}T10:00:00Z`, description, amount],
      );
    };
    for (const d of ["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"]) await at(d, -24_900, "Netflix");
    // A pharmacy visited about monthly at one price: found as a subscription, which it is not.
    for (const d of ["2026-08-09", "2026-09-09", "2026-10-09", "2026-11-09"]) await at(d, -30_000, "Аптека");
    const today = async () => (await get("/today").expect(200)).body;
    const limitBefore = await today();

    const found = (await get("/insights/month").expect(200)).body;
    expect(found.subscriptions.items.map((i: { name: string }) => i.name)).toEqual(["Аптека", "Netflix"]);
    expect(found.subscriptions.monthly).toBe(54_900);
    const pharmacy = found.subscriptions.items[0].key as string;

    // Marked twice: the same as once.
    await request(http()).put(`/insights/not-subscriptions/${pharmacy}`).set("Authorization", auth).expect(204);
    await request(http()).put(`/insights/not-subscriptions/${pharmacy}`).set("Authorization", auth).expect(204);
    expect(await ds.query(`SELECT key FROM not_subscriptions`)).toEqual([{ key: pharmacy }]);
    const marked = (await get("/insights/month").expect(200)).body;
    expect(insightsMonthDto.safeParse(marked).success).toBe(true);
    expect(marked.subscriptions).toEqual({ monthly: 24_900, items: [found.subscriptions.items[1]] });
    expect((await get("/insights/month?month=2026-10").expect(200)).body.subscriptions.items.map((i: { name: string }) => i.name)).toEqual(["Netflix"]);
    // Only the list changed: the place is still a place, its purchases still the limit's spending, and «Сегодня» reads the same.
    expect(marked.spent).toBe(found.spent);
    expect(marked.places).toEqual(found.places);
    expect(await today()).toEqual(limitBefore);

    // «Вернуть»: unmarked twice, the same as once.
    await request(http()).delete(`/insights/not-subscriptions/${pharmacy}`).set("Authorization", auth).expect(204);
    await request(http()).delete(`/insights/not-subscriptions/${pharmacy}`).set("Authorization", auth).expect(204);
    expect(await ds.query(`SELECT key FROM not_subscriptions`)).toEqual([]);
    expect((await get("/insights/month").expect(200)).body.subscriptions).toEqual(found.subscriptions);
  });

  it("marks and unmarks «Не подписка» only for the owner and only by a counterparty key (ЯМ6)", async () => {
    const key = "0123456789abcdef";
    await request(http()).put(`/insights/not-subscriptions/${key}`).expect(401);
    await request(http()).delete(`/insights/not-subscriptions/${key}`).expect(401);
    for (const bad of ["0123456789ABCDEF", "0123456789abcde", "0123456789abcdef0", "xyz", "0123456789abcdeg"]) {
      await request(http()).put(`/insights/not-subscriptions/${bad}`).set("Authorization", auth).expect(400);
      await request(http()).delete(`/insights/not-subscriptions/${bad}`).set("Authorization", auth).expect(400);
    }
    expect(await ds.query(`SELECT key FROM not_subscriptions`)).toEqual([]);
    // A key with no subscription behind it is remembered all the same: the place may charge again later.
    await request(http()).put(`/insights/not-subscriptions/${key}`).set("Authorization", auth).expect(204);
    expect(await ds.query(`SELECT key FROM not_subscriptions`)).toEqual([{ key }]);
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
    expect(body).toEqual({ month: "2025-01", through: "2025-01-31", previous: { from: "2024-12-01", to: "2024-12-31" }, spent: 0, previousSpent: 0, categories: [], places: [], otherPayments: 0, previousOtherPayments: 0, subscriptions: { monthly: 0, items: [] }, wanted: 0, previousWanted: 0, canMarkNotSubscription: true });
  });

  it("refuses a malformed month and a month in the future", async () => {
    for (const q of ["?month=2026-13", "?month=2026-1", "?month=nov", "?month=2026-11&x=1"]) await get(`/insights/month${q}`).expect(400);
    await get("/insights/month?month=2026-12").expect(400);
  });
});
