import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DataSource } from "typeorm";
import { createDataSource } from "../db/data-source";
import { createMigratedDatabase } from "../../test/app";
import { isOwnPair, ownPairSql, type PairLeg } from "../domain/own-pair";
import { JobRunner } from "../mono/jobs/job-runner";
import { RECLASSIFY_JOB_KIND, ReclassifyService } from "./reclassify.service";

let ds: DataSource;
const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
const clock = { now: () => NOW };
const service = () =>
  new ReclassifyService(ds, new JobRunner(ds, clock), { ownNames: ["Test Owner"], ownIbans: [], ownJars: [] });

let seq = 0;
async function insertTx(
  accountId: number,
  over: {
    amount?: number;
    /** Defaults to amount (a hryvnia account). */
    amountUah?: number | null;
    description?: string;
    mcc?: number | null;
    at?: Date;
    type?: string | null;
    type_source?: string | null;
    category?: string | null;
  } = {},
): Promise<number> {
  seq++;
  const at = over.at ?? new Date(NOW - seq * 3_600_000);
  const rows: { id: number }[] = await ds.query(
    `INSERT INTO transactions
       (external_id, account_id, occurred_at, local_date, description, mcc, amount, amount_uah,
        type, category, type_source, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$11,$8,$9,$10,'{}') RETURNING id`,
    [
      `tx-${seq}`,
      accountId,
      at,
      at.toISOString().slice(0, 10),
      over.description ?? "Coffee",
      over.mcc === undefined ? 5814 : over.mcc,
      over.amount ?? -5000,
      over.type ?? null,
      over.category ?? null,
      over.type_source === undefined ? "auto" : over.type_source,
      over.amountUah === undefined ? (over.amount ?? -5000) : over.amountUah,
    ],
  );
  return rows[0]!.id;
}
const get = async (id: number) =>
  (await ds.query(`SELECT type, category, type_source FROM transactions WHERE id=$1`, [id]))[0];

let black = 0;
let white = 0;
let fop = 0;

beforeAll(async () => {
  ds = createDataSource(await createMigratedDatabase());
  await ds.initialize();
});
afterAll(async () => {
  await ds.destroy();
});
beforeEach(async () => {
  await ds.query("TRUNCATE jobs, rules, transactions, accounts RESTART IDENTITY CASCADE");
  const ins = async (ext: string, kind: string) =>
    (
      await ds.query(
        `INSERT INTO accounts (external_id, kind, currency, balance) VALUES ($1,$2,'UAH',0) RETURNING id`,
        [ext, kind],
      )
    )[0].id as number;
  black = await ins("b", "black");
  white = await ins("w", "white");
  fop = await ins("f", "fop");
});

describe("reclassify", () => {
  it("classifies untyped rows and records the source", async () => {
    const id = await insertTx(black, { mcc: 5812 });
    expect(await service().reclassifyPending()).toBe(1);
    expect(await get(id)).toEqual({ type: "spend", category: "cafe", type_source: "auto" });
  });

  it("never touches rows the owner labelled", async () => {
    const id = await insertTx(black, { type: "obligation", category: "rent", type_source: "owner", mcc: 5812 });
    await ds.query(`INSERT INTO rules (match_kind, match_value, type) VALUES ('merchant','coffee','spend')`);
    await service().reclassifyPending();
    await service().reclassifyIds([id]);
    expect(await get(id)).toEqual({ type: "obligation", category: "rent", type_source: "owner" });
  });

  it("reapplies auto and rule rows when the rules change, storing owner rules as 'rule'", async () => {
    const id = await insertTx(black, { mcc: 5812, description: "Corner Place" });
    await service().reclassifyPending();
    expect((await get(id)).category).toBe("cafe");
    await ds.query(
      `INSERT INTO rules (match_kind, match_value, type, category) VALUES ('merchant','corner place','obligation','rent')`,
    );
    await service().reclassifyPending();
    expect(await get(id)).toEqual({ type: "obligation", category: "rent", type_source: "rule" });
  });

  it("pairs the two legs of a transfer between own accounts", async () => {
    const at = new Date(NOW - 3_600_000);
    const out = await insertTx(black, { amount: -100000, mcc: 4829, description: "Переказ на картку", at });
    const inn = await insertTx(white, { amount: 100000, mcc: 4829, description: "Переказ на картку", at });
    const lone = await insertTx(black, { amount: -77700, mcc: 4829, description: "Переказ на картку" });
    await service().reclassifyPending();
    expect((await get(out)).type).toBe("own_transfer");
    expect((await get(inn)).type).toBe("own_transfer");
    expect((await get(lone)).type).toBe("person_transfer");
  });

  it.each([
    ["outgoing leg first", true],
    ["incoming leg first", false],
  ])("a transfer imported one leg at a time ends as own_transfer (%s)", async (_n, outFirst) => {
    const at = new Date(NOW - 7_200_000);
    const mk = (acc: number, amount: number) =>
      insertTx(acc, { amount, mcc: 4829, description: "Переказ на картку", at });
    const svc = service();
    const first = outFirst ? await mk(black, -250000) : await mk(white, 250000);
    await svc.reclassifyIds([first]);
    expect((await get(first)).type).toBe(outFirst ? "person_transfer" : "person_in");
    const second = outFirst ? await mk(white, 250000) : await mk(black, -250000);
    await svc.reclassifyIds([second]);
    expect((await get(first)).type).toBe("own_transfer");
    expect((await get(second)).type).toBe("own_transfer");
  });

  describe("an exchange between own accounts in different currencies (Б10)", () => {
    let usd = 0;
    let usdJar = 0;
    beforeEach(async () => {
      const ins = async (ext: string, kind: string) =>
        (await ds.query(`INSERT INTO accounts (external_id, kind, currency, balance) VALUES ($1,$2,'USD',0) RETURNING id`, [ext, kind]))[0]
          .id as number;
      usd = await ins("u", "black");
      usdJar = await ins("uj", "jar");
    });
    const buy = (acc: number, uah: number, usdCents: number, usdUah: number, at: Date) =>
      Promise.all([
        insertTx(black, { amount: -uah, mcc: 4829, description: "Переказ на картку", at }),
        insertTx(acc, { amount: usdCents, amountUah: usdUah, mcc: 4829, description: "З гривневого рахунку", at: new Date(at.getTime() + 30_000) }),
      ]);

    it("pairs a hryvnia debit with a dollar credit whose hryvnia amounts are within 3%", async () => {
      const [out, inn] = await buy(usd, 412_000, 10_000, 405_000, new Date(NOW - 3_600_000));
      await service().reclassifyPending();
      expect((await get(out)).type).toBe("own_transfer");
      expect((await get(inn)).type).toBe("own_transfer");
    });

    it("does not pair when the hryvnia amounts are 4% apart, or with a jar", async () => {
      const [out, inn] = await buy(usd, 412_000, 10_000, 395_500, new Date(NOW - 3_600_000));
      const [toJar] = await buy(usdJar, 300_000, 7_300, 299_300, new Date(NOW - 7_200_000));
      await service().reclassifyPending();
      expect((await get(out)).type).toBe("person_transfer");
      expect((await get(inn)).type).toBe("person_in");
      expect((await get(toJar)).type).toBe("person_transfer");
    });

    it("the leg that arrives second makes the first one an own transfer", async () => {
      const at = new Date(NOW - 3_600_000);
      const svc = service();
      const inn = await insertTx(usd, { amount: 10_000, amountUah: 410_000, mcc: 4829, description: "З гривневого рахунку", at });
      await svc.reclassifyIds([inn]);
      expect((await get(inn)).type).toBe("person_in");
      const out = await insertTx(black, { amount: -413_000, mcc: 4829, description: "Переказ на картку", at });
      await svc.reclassifyIds([out]);
      expect((await get(inn)).type).toBe("own_transfer");
      expect((await get(out)).type).toBe("own_transfer");
    });

    it("the SQL form of the pair rule agrees with isOwnPair on every pair of rows", async () => {
      const t0 = NOW - 3_600_000;
      // [account, amount, hryvnia amount (undefined: the amount itself), seconds after the first × 1000]
      const legs: [number, number, number | null | undefined, number][] = [
        [black, -413_000, undefined, 0],
        [usd, 10_000, 410_000, 40_000], // within 3%
        [usd, 10_000, 395_500, 60_000], // 4% apart
        [usd, 10_000, null, 70_000], // no rate
        [white, 413_000, undefined, 80_000], // exact opposite
        [usdJar, 10_000, 412_000, 90_000], // a jar
        [usd, 10_000, 410_000, 700_000], // outside the window from the first
        [black, 0, undefined, 100_000],
        [usd, 0, 0, 110_000],
      ];
      for (const [acc, amount, amountUah, dt] of legs) {
        await insertTx(acc, { amount, amountUah, at: new Date(t0 + dt) });
      }
      const rows: (PairLeg & { id: number })[] = await ds.query(
        `SELECT t.id, t.account_id AS "accountId", a.kind AS "accountKind", a.currency, extract(epoch FROM t.occurred_at)::float8 * 1000 AS at,
                t.amount::float8 AS amount, t.amount_uah::float8 AS "amountUah"
           FROM transactions t JOIN accounts a ON a.id = t.account_id`,
      );
      const sql: { t: number; o: number }[] = await ds.query(
        `SELECT t.id AS t, o.id AS o FROM transactions t JOIN accounts ta ON ta.id = t.account_id
           JOIN transactions o ON o.id <> t.id JOIN accounts oa ON oa.id = o.account_id
          WHERE ${ownPairSql("t", "ta", "o", "oa")}`,
      );
      const fromSql = sql.map((p) => `${p.t}-${p.o}`).sort();
      const fromTs = rows.flatMap((a) => rows.filter((b) => b.id !== a.id && isOwnPair(a, b)).map((b) => `${a.id}-${b.id}`)).sort();
      expect(fromSql).toEqual(fromTs);
      expect(fromTs.length).toBeGreaterThan(0);
    });
  });

  it("loads own ibans and jar titles from accounts (production context)", async () => {
    await ds.query(`UPDATE accounts SET iban='UA00OWNIBAN' WHERE id=$1`, [white]);
    const jar = (await ds.query(
      `INSERT INTO accounts (external_id, kind, currency, balance, title) VALUES ('j','jar','UAH',0,'Trip') RETURNING id`,
    ))[0].id as number;
    expect(jar).toBeGreaterThan(0);
    const toIban = await insertTx(black, { amount: -1000, mcc: 4829, description: "Переказ" });
    await ds.query(`UPDATE transactions SET counter_iban='UA00OWNIBAN' WHERE id=$1`, [toIban]);
    const toJar = await insertTx(black, { amount: -2000, mcc: 4829, description: "Поповнення «Trip»" });
    const stranger = await insertTx(black, { amount: -3000, mcc: 4829, description: "Поповнення «Other»" });
    const svc = new ReclassifyService(ds, new JobRunner(ds, clock), { ownNames: [], ownIbans: [], ownJars: [] });
    await svc.reclassifyPending();
    expect((await get(toIban)).type).toBe("own_transfer");
    expect((await get(toJar)).type).toBe("own_transfer");
    expect((await get(stranger)).type).toBe("person_transfer");
  });

  it("persists needs_label", async () => {
    const person = await insertTx(black, { amount: -1000, mcc: 4829, description: "Тест Тестовий" });
    const cafe = await insertTx(black, { mcc: 5812 });
    await service().reclassifyPending();
    const flags = async (id: number) =>
      (await ds.query(`SELECT needs_label FROM transactions WHERE id=$1`, [id]))[0].needs_label;
    expect(await flags(person)).toBe(true);
    expect(await flags(cafe)).toBe(false);
  });

  it("does not select owner rows even when their type is null", async () => {
    const id = await insertTx(black, { type: null, type_source: "owner", mcc: 5812 });
    await service().reclassifyPending();
    await service().reclassifyIds([id]);
    expect(await get(id)).toEqual({ type: null, category: null, type_source: "owner" });
  });

  it("uses the account kind: fop income is income, and does not require a label", async () => {
    const id = await insertTx(fop, { amount: 900000, mcc: 4829, description: "Оплата послуг" });
    await service().reclassifyPending();
    expect(await get(id)).toMatchObject({ type: "income" });
  });

  it("queues at most one pending job", async () => {
    await service().enqueue();
    await service().enqueue();
    expect((await ds.query(`SELECT count(*)::int AS n FROM jobs WHERE kind=$1`, [RECLASSIFY_JOB_KIND]))[0].n).toBe(1);
  });

  it("runs as a job", async () => {
    const runner = new JobRunner(ds, clock);
    const svc = new ReclassifyService(ds, runner, { ownNames: [], ownIbans: [], ownJars: [] });
    svc.onModuleInit();
    const id = await insertTx(black, { mcc: 5411 });
    await ds.query(`INSERT INTO jobs (kind, run_after) VALUES ($1, $2)`, [RECLASSIFY_JOB_KIND, new Date(NOW)]);
    expect(await runner.runOnce()).toBe(true);
    expect((await get(id)).category).toBe("groceries");
  });
});
