import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { createDataSource } from "../db/data-source";
import { Account, Job, Transaction } from "../db/entities";
import { createMigratedDatabase } from "../../test/app";
import { countsAsOwnSql } from "../domain/ledger";
import { ImportService, SPLIT_THRESHOLD, WINDOW_JOB_KIND } from "./import.service";
import { JobRunner, MAX_ATTEMPTS } from "./jobs/job-runner";
import { MonoApiError } from "./mono.errors";
import type { MonoClient } from "./mono.client";
import type { MonoStatementItem } from "./mono.schemas";
import { ReclassifyService } from "../transactions/reclassify.service";

const NOW_MS = Date.UTC(2026, 10, 2, 12, 0, 0);
const NOW_S = NOW_MS / 1000;

function item(id: string, time: number, over: Partial<MonoStatementItem> = {}): MonoStatementItem {
  return {
    id,
    time,
    description: "Coffee",
    mcc: 5814,
    originalMcc: 5814,
    hold: false,
    amount: -5000,
    operationAmount: -5000,
    currencyCode: 980,
    commissionRate: 0,
    cashbackAmount: 0,
    balance: 100000,
    ...over,
  };
}

let ds: DataSource;
let now = NOW_MS;
const clock = { now: () => now };

const clientInfo = {
  clientId: "c",
  name: "n",
  accounts: [
    { id: "acc-uah", balance: 100000, creditLimit: 0, type: "black", currencyCode: 980, maskedPan: [] },
    { id: "acc-usd", balance: 2000, creditLimit: 0, type: "white", currencyCode: 840, maskedPan: [] },
  ],
  jars: [{ id: "jar-1", title: "Trip", currencyCode: 980, balance: 5000 }],
};

function setup(statement: (id: string, from: number, to: number) => Promise<MonoStatementItem[]>) {
  const client = {
    clientInfo: vi.fn(async () => clientInfo),
    statement: vi.fn(statement),
  } as unknown as MonoClient;
  const runner = new JobRunner(ds, clock);
  const service = new ImportService(ds, client, runner, clock);
  service.onModuleInit();
  return { client, runner, service };
}

async function drain(runner: JobRunner, max = 200) {
  let n = 0;
  while (n < max && (await runner.runOnce())) n++;
  return n;
}

beforeAll(async () => {
  ds = createDataSource(await createMigratedDatabase());
  await ds.initialize();
});
afterAll(async () => {
  await ds.destroy();
});
beforeEach(async () => {
  now = NOW_MS;
  await ds.query("TRUNCATE jobs, transactions, accounts, fx_rates RESTART IDENTITY CASCADE");
});

const daysAgo = (d: number) => new Date(NOW_MS - d * 86_400_000);

describe("enqueueHistory", () => {
  it("creates accounts incl. jars and one job per window", async () => {
    const { service } = setup(async () => []);
    await service.enqueueHistory(daysAgo(75));
    const accounts = await ds.getRepository(Account).find({ order: { external_id: "ASC" } });
    expect(accounts.map((a) => [a.external_id, a.kind, a.currency])).toEqual([
      ["acc-uah", "black", "UAH"],
      ["acc-usd", "white", "USD"],
      ["jar-1", "jar", "UAH"],
    ]);
    const jobs = await ds.getRepository(Job).find();
    expect(jobs.length).toBe(3 * 3);
    expect(jobs.every((j) => j.kind === WINDOW_JOB_KIND && j.status === "pending")).toBe(true);
  });

  it("brings a card of another type in as own money and a jar as set aside, and a sync keeps the person's mark (Д2а)", async () => {
    const { service } = setup(async () => []);
    const info = {
      ...clientInfo,
      accounts: [...clientInfo.accounts, { id: "acc-iron", balance: 900000, creditLimit: 1000000, type: "iron", currencyCode: 980, maskedPan: [] }],
    };
    await service.syncAccounts(info as never);
    const marks = async () =>
      (await ds.query(`SELECT external_id, kind, ${countsAsOwnSql("accounts")} AS own FROM accounts ORDER BY external_id`)) as unknown[];
    expect(await marks()).toEqual([
      { external_id: "acc-iron", kind: "other", own: true },
      { external_id: "acc-uah", kind: "black", own: true },
      { external_id: "acc-usd", kind: "white", own: true },
      { external_id: "jar-1", kind: "jar", own: false },
    ]);
    await ds.query(`UPDATE accounts SET counts_as_own = NOT ${countsAsOwnSql("accounts")} WHERE external_id IN ('acc-iron', 'jar-1')`);
    await service.syncAccounts(info as never);
    expect(await marks()).toEqual([
      { external_id: "acc-iron", kind: "other", own: false },
      { external_id: "acc-uah", kind: "black", own: true },
      { external_id: "acc-usd", kind: "white", own: true },
      { external_id: "jar-1", kind: "jar", own: true },
    ]);
  });

  it("does not duplicate windows when enqueued twice", async () => {
    const { service } = setup(async () => []);
    await service.enqueueHistory(daysAgo(75));
    await service.enqueueHistory(daysAgo(75));
    expect(await ds.getRepository(Job).count()).toBe(9);
  });

  it("queues a window again once it has failed for good, and only once", async () => {
    const { service } = setup(async () => []);
    await service.enqueueHistory(daysAgo(5));
    const before = await ds.getRepository(Job).count();
    await ds.query(`UPDATE jobs SET status='failed' WHERE payload->>'accountId'='acc-usd'`);
    await service.enqueueHistory(daysAgo(5));
    await service.enqueueHistory(daysAgo(5));
    expect(await ds.getRepository(Job).count()).toBe(before + 1);
    const again = await ds.query(`SELECT status FROM jobs WHERE payload->>'accountId'='acc-usd' ORDER BY id`);
    expect(again.map((j: { status: string }) => j.status)).toEqual(["failed", "pending"]);
  });
});

describe("import run", () => {
  it("imports items with Kyiv local_date and UAH amounts", async () => {
    // 22:30 UTC on 1 Nov is already 2 Nov in Kyiv (UTC+2).
    const t = Date.UTC(2026, 10, 1, 22, 30) / 1000;
    const { service, runner } = setup(async (id) => (id === "acc-uah" ? [item("tx1", t)] : []));
    await service.enqueueHistory(daysAgo(10));
    await drain(runner);
    const tx = await ds.getRepository(Transaction).findOneByOrFail({ external_id: "tx1" });
    expect(tx.local_date).toBe("2026-11-02");
    expect(tx.amount).toBe(-5000);
    expect(tx.amount_uah).toBe(-5000);
    expect(tx.fx_rate).toBeNull();
    expect(tx.type).toBeNull();
    expect(tx.type_source).toBe("auto");
  });

  it("converts foreign currency with the rate in force at the operation's time, null when none", async () => {
    const t = NOW_S - 3600;
    const usd = (id: string) => [item(id, t, { amount: -1000, operationAmount: -1000, currencyCode: 840 })];
    const first = setup(async (id) => (id === "acc-usd" ? usd("usd1") : []));
    await first.service.enqueueHistory(daysAgo(10));
    await drain(first.runner);
    let tx = await ds.getRepository(Transaction).findOneByOrFail({ external_id: "usd1" });
    expect(tx.amount_uah).toBeNull();
    expect(tx.fx_rate).toBeNull();

    await ds.query("TRUNCATE jobs, transactions RESTART IDENTITY CASCADE");
    // 41.5 was fetched after the operation, 40 a day before it: the operation takes 40.
    await ds.query("INSERT INTO fx_rates VALUES ('USD', $1, 41.5), ('USD', $2, 40)", [
      new Date(NOW_MS - 1000),
      new Date(NOW_MS - 86_400_000),
    ]);
    const second = setup(async (id) => (id === "acc-usd" ? usd("usd2") : []));
    await second.service.enqueueHistory(daysAgo(10));
    await drain(second.runner);
    tx = await ds.getRepository(Transaction).findOneByOrFail({ external_id: "usd2" });
    expect(tx.fx_rate).toBe(40);
    expect(tx.amount_uah).toBe(-40000);
  });

  it("converts an operation from 30 days ago at that day's rate, not today's", async () => {
    const t = Math.floor(daysAgo(30).getTime() / 1000) + 3600;
    await ds.query("INSERT INTO fx_rates VALUES ('USD', $1, 39.2), ('USD', $2, 41.8), ('USD', $3, 38)", [
      daysAgo(30),
      daysAgo(0),
      daysAgo(60),
    ]);
    const { service, runner } = setup(async (id) =>
      id === "acc-usd" ? [item("usd-old", t, { amount: -2500, operationAmount: -2500, currencyCode: 840 })] : [],
    );
    await service.enqueueHistory(daysAgo(40));
    await drain(runner);
    const tx = await ds.getRepository(Transaction).findOneByOrFail({ external_id: "usd-old" });
    expect(tx.fx_rate).toBe(39.2);
    expect(tx.amount_uah).toBe(-98000);
  });

  it("uses the earliest stored rate for history older than every rate", async () => {
    const t = Math.floor(daysAgo(50).getTime() / 1000);
    await ds.query("INSERT INTO fx_rates VALUES ('USD', $1, 39), ('USD', $2, 41)", [daysAgo(20), daysAgo(0)]);
    const { service, runner } = setup(async (id) =>
      id === "acc-usd" ? [item("usd-older", t, { amount: -1000, operationAmount: -1000, currencyCode: 840 })] : [],
    );
    await service.enqueueHistory(daysAgo(60));
    await drain(runner);
    const tx = await ds.getRepository(Transaction).findOneByOrFail({ external_id: "usd-older" });
    expect(tx.fx_rate).toBe(39);
    expect(tx.amount_uah).toBe(-39000);
  });

  it("takes the hryvnia amount of an operation made in hryvnias, whatever the stored rates", async () => {
    // $100 sold to the own hryvnia card a month ago at the bank's 41.27; stored rates say otherwise.
    const t = Math.floor(daysAgo(30).getTime() / 1000);
    await ds.query("INSERT INTO fx_rates VALUES ('USD', $1, 39.5), ('USD', $2, 42)", [daysAgo(31), daysAgo(0)]);
    const { service, runner } = setup(async (id) =>
      id === "acc-usd"
        ? [item("usd-sell", t, { amount: -10000, operationAmount: -412700, currencyCode: 980, description: "На чорну картку" })]
        : [],
    );
    await service.enqueueHistory(daysAgo(40));
    await drain(runner);
    const tx = await ds.getRepository(Transaction).findOneByOrFail({ external_id: "usd-sell" });
    expect(tx.amount_uah).toBe(-412700);
    expect(tx.fx_rate).toBe(41.27);
    // a later sync of the same row recomputes from the stored rate and lands on the same hryvnias
    const again = await service.upsertStatementItem(
      tx.account_id,
      item("usd-sell", t, { amount: -10000, operationAmount: -412700, currencyCode: 980 }),
    );
    expect(again.amount_uah).toBe(-412700);
  });

  it("resumes an interrupted import from the unfinished windows", async () => {
    const calls: Array<[string, number, number]> = [];
    const a = setup(async (id, f, t) => {
      calls.push([id, f, t]);
      return [];
    });
    await a.service.enqueueHistory(daysAgo(75));
    // Interrupted after three windows.
    for (let i = 0; i < 3; i++) await a.runner.runOnce();
    // A job was mid-flight when the process died.
    await ds.query("UPDATE jobs SET status='running' WHERE id = (SELECT min(id) FROM jobs WHERE status='pending')");
    const before = calls.length;

    const b = setup(async (id, f, t) => {
      calls.push([id, f, t]);
      return [];
    });
    await b.runner.recoverInterrupted();
    await b.service.enqueueHistory(daysAgo(75));
    await drain(b.runner);

    const statuses = await ds.query("SELECT status, count(*)::int AS n FROM jobs GROUP BY status");
    expect(statuses).toEqual([{ status: "done", n: 9 }]);
    // 9 windows total; 3 done earlier, the 6 remaining ran once each.
    expect(calls.length - before).toBe(6);
  });

  it("splits a window that returns >= threshold rows and requests both halves", async () => {
    const calls: Array<[number, number]> = [];
    const big = Array.from({ length: SPLIT_THRESHOLD }, (_, i) => item(`b${i}`, NOW_S - 100 - i));
    const { service, runner } = setup(async (id, f, t) => {
      if (id !== "acc-uah") return [];
      calls.push([f, t]);
      return calls.length === 1 ? big : [item(`s${calls.length}`, f)];
    });
    await service.enqueueHistory(daysAgo(5));
    await drain(runner);
    const [first, second, third] = calls;
    const mid = Math.floor((first![0] + first![1]) / 2);
    expect(second).toEqual([first![0], mid]);
    expect(third).toEqual([mid + 1, first![1]]);
    // The oversized response itself is not stored: the halves are authoritative.
    expect(await ds.getRepository(Transaction).count()).toBe(2);
  });

  it("retries a failing window with a pause, fails after 5 attempts, other accounts proceed", async () => {
    const { service, runner } = setup(async (id) => {
      if (id === "acc-usd") throw new Error("boom");
      return id === "acc-uah" ? [item("ok1", NOW_S - 10)] : [];
    });
    await service.enqueueHistory(daysAgo(5));
    await drain(runner);
    expect(await ds.getRepository(Transaction).count()).toBe(1);
    let failing = await ds.query(`SELECT * FROM jobs WHERE payload->>'accountId'='acc-usd'`);
    expect(failing[0].status).toBe("pending");
    expect(failing[0].attempts).toBe(1);
    expect(new Date(failing[0].run_after).getTime()).toBeGreaterThan(now);

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      now += 24 * 3600_000;
      await drain(runner);
    }
    failing = await ds.query(`SELECT * FROM jobs WHERE payload->>'accountId'='acc-usd'`);
    expect(failing[0].status).toBe("failed");
    expect(failing[0].attempts).toBe(MAX_ATTEMPTS);
    expect(failing[0].last_error).toContain("boom");
  });

  it("reschedules on 429 honouring retryAfter without counting an attempt", async () => {
    const { service, runner } = setup(async (id) => {
      if (id === "acc-uah") throw new MonoApiError("slow down", 429, 90);
      return [];
    });
    await service.enqueueHistory(daysAgo(5));
    await drain(runner);
    const rows = await ds.query(`SELECT * FROM jobs WHERE payload->>'accountId'='acc-uah'`);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].attempts).toBe(0);
    expect(new Date(rows[0].run_after).getTime()).toBe(now + 90_000);
  });
});

describe("upsertStatementItem", () => {
  it("updates amount and hold but keeps the owner's type/category", async () => {
    const { service } = setup(async () => []);
    await service.enqueueHistory(daysAgo(1));
    const acc = await ds.getRepository(Account).findOneByOrFail({ external_id: "acc-uah" });
    const t = NOW_S - 100;
    await service.upsertStatementItem(acc.id, item("u1", t, { hold: true, amount: -100 }));
    await ds.query(
      "UPDATE transactions SET type='lifestyle', category='food', type_source='owner' WHERE external_id='u1'",
    );
    const tx = await service.upsertStatementItem(acc.id, item("u1", t, { hold: false, amount: -120 }));
    expect(tx.amount).toBe(-120);
    expect(tx.amount_uah).toBe(-120);
    expect(tx.hold).toBe(false);
    expect(tx.type).toBe("lifestyle");
    expect(tx.category).toBe("food");
    expect(tx.type_source).toBe("owner");
    expect(await ds.getRepository(Transaction).count()).toBe(1);
  });
});

describe("upsertStatementItem fx recompute", () => {
  it("recomputes amount_uah from the stored fx_rate when the amount changes", async () => {
    const { service } = setup(async () => []);
    await service.enqueueHistory(daysAgo(1));
    const acc = await ds.getRepository(Account).findOneByOrFail({ external_id: "acc-usd" });
    await ds.query("INSERT INTO fx_rates VALUES ('USD', $1, 40)", [daysAgo(0)]);
    const t = NOW_S - 100;
    const first = await service.upsertStatementItem(acc.id, item("fx1", t, { hold: true, amount: -100, operationAmount: -100, currencyCode: 840 }));
    expect(first.amount_uah).toBe(-4000);
    // a newer rate appears; the row keeps its stored rate
    await ds.query("INSERT INTO fx_rates VALUES ('USD', $1, 50)", [new Date(NOW_MS + 1000)]);
    const same = await service.upsertStatementItem(acc.id, item("fx1", t, { hold: true, amount: -100, operationAmount: -100, currencyCode: 840 }));
    expect(same.fx_rate).toBe(40);
    expect(same.amount_uah).toBe(-4000);
    const second = await service.upsertStatementItem(acc.id, item("fx1", t, { hold: false, amount: -120, operationAmount: -120, currencyCode: 840 }));
    expect(second.amount).toBe(-120);
    expect(second.fx_rate).toBe(40);
    expect(second.amount_uah).toBe(-4800);
    // no rate at all any more: still the stored rate
    await ds.query("TRUNCATE fx_rates");
    const third = await service.upsertStatementItem(acc.id, item("fx1", t, { amount: -130, operationAmount: -130, currencyCode: 840 }));
    expect(third.amount_uah).toBe(-5200);
    // a row with no stored rate picks up the current one
    const fresh = await service.upsertStatementItem(acc.id, item("fx2", t, { amount: -10, operationAmount: -10, currencyCode: 840 }));
    expect(fresh.amount_uah).toBeNull();
    await ds.query("INSERT INTO fx_rates VALUES ('USD', $1, 50)", [new Date(NOW_MS + 2000)]);
    const filled = await service.upsertStatementItem(acc.id, item("fx2", t, { amount: -10, operationAmount: -10, currencyCode: 840 }));
    expect(filled.fx_rate).toBe(50);
    expect(filled.amount_uah).toBe(-500);
  });
});

describe("JobRunner", () => {
  it("leaves failed backup rows and kinds without a handler alone", async () => {
    await ds.query(
      `INSERT INTO jobs (kind, status, run_after) VALUES ('backup.failed','failed','2000-01-01'), ('restore_check.failed','failed','2000-01-01'), ('unknown.kind','pending','2000-01-01')`,
    );
    const runner = new JobRunner(ds, clock);
    const handler = vi.fn(async () => {});
    runner.register("known", handler);
    expect(await runner.runOnce()).toBe(false);
    await runner.recoverInterrupted();
    const rows = await ds.query("SELECT kind, status FROM jobs ORDER BY id");
    expect(rows).toEqual([
      { kind: "backup.failed", status: "failed" },
      { kind: "restore_check.failed", status: "failed" },
      { kind: "unknown.kind", status: "pending" },
    ]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not let two runners claim the same job", async () => {
    await ds.query(`INSERT INTO jobs (kind, run_after) VALUES ('known', '2000-01-01')`);
    const a = new JobRunner(ds, clock);
    const b = new JobRunner(ds, clock);
    const handler = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    a.register("known", handler);
    b.register("known", handler);
    const [ra, rb] = await Promise.all([a.runOnce(), b.runOnce()]);
    expect([ra, rb].filter(Boolean)).toHaveLength(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("classification after upsert", () => {
  const reclassifier = () =>
    new ReclassifyService(ds, new JobRunner(ds, clock), { ownNames: [], ownIbans: [], ownJars: [] });

  it("types rows once a window is imported", async () => {
    const t = NOW_S - 3600;
    const client = {
      clientInfo: vi.fn(async () => clientInfo),
      statement: vi.fn(async (id: string) => (id === "acc-uah" ? [item("c1", t, { mcc: 5812 })] : [])),
    } as unknown as MonoClient;
    const runner = new JobRunner(ds, clock);
    const service = new ImportService(ds, client, runner, clock, reclassifier());
    service.onModuleInit();
    await service.enqueueHistory(daysAgo(10));
    await drain(runner);
    const tx = await ds.getRepository(Transaction).findOneByOrFail({ external_id: "c1" });
    expect([tx.type, tx.category, tx.type_source]).toEqual(["spend", "cafe", "auto"]);
  });

  it("stores iban and jar title from client-info and queues a full reclassify after the last window", async () => {
    const info = {
      ...clientInfo,
      accounts: [{ ...clientInfo.accounts[0]!, iban: "UA00IBAN" }, clientInfo.accounts[1]!],
    };
    const client = {
      clientInfo: vi.fn(async () => info),
      statement: vi.fn(async () => []),
    } as unknown as MonoClient;
    const runner = new JobRunner(ds, clock);
    const service = new ImportService(ds, client, runner, clock, reclassifier());
    service.onModuleInit();
    await service.enqueueHistory(daysAgo(10));
    const rows = await ds.query(`SELECT external_id, iban, title FROM accounts ORDER BY external_id`);
    expect(rows).toEqual([
      { external_id: "acc-uah", iban: "UA00IBAN", title: null },
      { external_id: "acc-usd", iban: null, title: null },
      { external_id: "jar-1", iban: null, title: "Trip" },
    ]);
    await drain(runner);
    const kinds = await ds.query(`SELECT kind FROM jobs WHERE kind='reclassify'`);
    expect(kinds).toHaveLength(1);
  });

  const failing = (fails: (id: string) => boolean) => {
    const client = {
      clientInfo: vi.fn(async () => clientInfo),
      statement: vi.fn(async (id: string) => {
        if (fails(id)) throw new Error("boom");
        return [];
      }),
    } as unknown as MonoClient;
    const runner = new JobRunner(ds, clock);
    const service = new ImportService(ds, client, runner, clock, reclassifier());
    service.onModuleInit();
    return { service, runner };
  };
  const reclassifyJobs = () => ds.query(`SELECT 1 FROM jobs WHERE kind='reclassify'`);
  const untilFailed = async (runner: JobRunner) => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await drain(runner);
      now += 24 * 3600_000;
    }
  };

  it("queues the reclassify when the last window fails for good", async () => {
    const { service, runner } = failing(() => true);
    await service.enqueueHistory(daysAgo(5));
    await drain(runner);
    expect(await reclassifyJobs()).toHaveLength(0); // still retrying
    await untilFailed(runner);
    expect(await ds.query(`SELECT 1 FROM jobs WHERE kind=$1 AND status <> 'failed'`, [WINDOW_JOB_KIND])).toHaveLength(0);
    expect(await reclassifyJobs()).toHaveLength(1);
  });

  it("queues the reclassify when the last window succeeds after another one failed", async () => {
    const { service, runner } = failing((id) => id === "acc-uah");
    await service.enqueueHistory(daysAgo(5));
    await untilFailed(runner);
    expect(await reclassifyJobs()).toHaveLength(1);
  });

  it("does not queue the reclassify while another window is still waiting", async () => {
    const { service, runner } = failing((id) => id === "acc-uah");
    await service.enqueueHistory(daysAgo(5));
    await ds.query(`UPDATE jobs SET attempts=$1 WHERE payload->>'accountId'='acc-uah'`, [MAX_ATTEMPTS - 1]);
    await ds.query(`UPDATE jobs SET run_after=$1 WHERE payload->>'accountId'<>'acc-uah'`, [new Date(now + 3600_000)]);
    await drain(runner);
    expect(await ds.query(`SELECT 1 FROM jobs WHERE status='failed'`)).toHaveLength(1);
    expect(await reclassifyJobs()).toHaveLength(0);
  });

  it("types a single upserted item (webhook, reconcile)", async () => {
    const { service } = setup(async () => []);
    await service.syncAccounts();
    const account = await ds.getRepository(Account).findOneByOrFail({ external_id: "acc-uah" });
    const withClassifier = new ImportService(
      ds,
      {} as unknown as MonoClient,
      new JobRunner(ds, clock),
      clock,
      reclassifier(),
    );
    const tx = await withClassifier.upsertStatementItem(account.id, item("w1", NOW_S - 60, { mcc: 5411 }));
    expect(tx.type).toBe("spend");
    expect(tx.category).toBe("groceries");
  });
});
