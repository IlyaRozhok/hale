import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DataSource } from "typeorm";
import { createDataSource } from "../db/data-source";
import { createMigratedDatabase } from "../../test/app";
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
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,'{}') RETURNING id`,
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
