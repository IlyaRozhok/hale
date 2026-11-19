import { describe, expect, it } from "vitest";
import pg from "pg";
import { DataSource } from "typeorm";
import { createDataSource, migrations } from "../src/db/data-source";
import { PaymentClosedByLinks1795392000000 } from "../src/db/migrations/0022-payment-closed-by-links";
import { LoanDueOn1795564800000 } from "../src/db/migrations/0024-loan-due-on";
import { IncomeEventDateByHand1795737600000 } from "../src/db/migrations/0026-income-event-date-by-hand";
import { RecurringStart1795824000000 } from "../src/db/migrations/0027-recurring-start";
import { CashStartedAt1795910400000 } from "../src/db/migrations/0028-cash-started-at";
import { CashCountAbsorbed1795996800000 } from "../src/db/migrations/0029-cash-count-absorbed";
import { OwnerRuleMark1796083200000 } from "../src/db/migrations/0030-owner-rule-mark";
import { SettingsClassifierVersion1796169600000 } from "../src/db/migrations/0031-settings-classifier-version";
import { HryvniaLegAmounts1796256000000 } from "../src/db/migrations/0032-hryvnia-leg-amounts";
import { CashCardAnsweredAt1796342400000 } from "../src/db/migrations/0033-cash-card-answered-at";
import { CashCardAnswerFrom1796428800000 } from "../src/db/migrations/0034-cash-card-answer-from";
import { Categories1796515200000 } from "../src/db/migrations/0035-categories";
import { Observations1796601600000 } from "../src/db/migrations/0036-observations";
import { Want1796688000000 } from "../src/db/migrations/0037-want";
import { CLASSIFIER_VERSION } from "../src/domain/classify";
import { JobRunner } from "../src/mono/jobs/job-runner";
import { ReclassifyService } from "../src/transactions/reclassify.service";
import { kyivDate } from "../src/domain/money";
import { createTestDatabase } from "./db";

const TABLES = [
  "accounts", "transactions", "rules", "expected_incomes", "income_events",
  "scheduled_payments", "recurring_payments", "manual_balances", "loans", "settings", "bridge_plans",
  "daily_snapshots", "fx_rates",
      "goals", "jobs", "devices", "notifications_log", "loan_repayments", "payment_links", "cash_cards", "payment_dismissals", "cash_answers",
  "ledger_checks", "cash_exchanges", "recurring_skips", "categories", "observations_shown", "observation_dismissals",
];

async function listTables(url: string): Promise<string[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const { rows } = await c.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name <> 'migrations'",
  );
  await c.end();
  return rows.map((r) => r.table_name as string).sort();
}

describe("migrations", () => {
  it("runs up on a clean database and reverts down to empty", async () => {
    const url = await createTestDatabase();
    const ds = createDataSource(url);
    await ds.initialize();
    await ds.runMigrations();
    expect(await listTables(url)).toEqual([...TABLES].sort());

    const settings = await ds.query("SELECT * FROM settings");
    expect(settings).toHaveLength(1);
    expect(settings[0].tax_rate_bp).toBe(600);
    expect(settings[0].limit_visual).toBe("mercury");

    expect(settings[0]).toHaveProperty("last_sync_at", null);
    const cols = await ds.query(
      "SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE column_name IN ('iban','title','needs_label') ORDER BY 1,2",
    );
    expect(cols.map((c: { table_name: string; column_name: string }) => `${c.table_name}.${c.column_name}`)).toEqual([
      "accounts.iban",
      "accounts.title",
      "transactions.needs_label",
    ]);

    for (let i = 0; i < migrations.length; i++) await ds.undoLastMigration();
    expect(await listTables(url)).toEqual([]);
    await ds.destroy();
  });

  it("0022 marks as closed by links only a paid non-tax payment closed through chosen operations (Б26)", async () => {
    const url = await createTestDatabase();
    const before = new DataSource({ type: "postgres", url, migrations: migrations.slice(0, migrations.indexOf(PaymentClosedByLinks1795392000000)) });
    await before.initialize();
    await before.runMigrations();
    const one = async (sql: string, args: unknown[] = []) => (await before.query(sql, args))[0].id as number;
    const account = await one(`INSERT INTO accounts (external_id, kind, currency, balance) VALUES ('a','black','UAH',0) RETURNING id`);
    const tx = (n: number) =>
      one(
        `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, amount, amount_uah, type, raw)
         VALUES ($1,$2,'2026-11-08T10:00:00Z','2026-11-08',-100000,-100000,'obligation','{}') RETURNING id`,
        [`t${n}`, account],
      );
    const [t1, t2, t3, t4] = [await tx(1), await tx(2), await tx(3), await tx(4)];
    const payment = (kind: string, name: string, paid: boolean, transactionId: number | null = null) =>
      one(
        `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, paid_at, transaction_id)
         VALUES ($1,$2,100000,'UAH','2026-11-06',$3,$4) RETURNING id`,
        [kind, name, paid ? "2026-11-08T10:00:00Z" : null, transactionId],
      );
    const chosen = await payment("obligation", "chosen", true);
    const tax = await payment("tax", "tax", true);
    await payment("obligation", "own", true, t3);
    const part = await payment("obligation", "part", false);
    await payment("installment", "byHand", true);
    await before.query(`INSERT INTO payment_links (payment_id, transaction_id) VALUES ($1,$2), ($3,$4), ($5,$6)`, [chosen, t1, tax, t2, part, t4]);
    await before.destroy();

    const ds = createDataSource(url);
    await ds.initialize();
    await ds.runMigrations();
    const flags: { name: string; closed_by_links: boolean }[] = await ds.query(`SELECT name, closed_by_links FROM scheduled_payments ORDER BY id`);
    expect(flags).toEqual([
      { name: "chosen", closed_by_links: true },
      { name: "tax", closed_by_links: false },
      { name: "own", closed_by_links: false },
      { name: "part", closed_by_links: false },
      { name: "byHand", closed_by_links: false },
    ]);
    // Back down through 0022, whatever came after it.
    for (let i = migrations.indexOf(PaymentClosedByLinks1795392000000); i < migrations.length; i++) await ds.undoLastMigration();
    expect(await ds.query(`SELECT 1 FROM information_schema.columns WHERE column_name='closed_by_links'`)).toEqual([]);
    await ds.destroy();
  });

  it("0024 gives loans a return date and leaves every existing loan without one (Б7)", async () => {
    const url = await createTestDatabase();
    const before = new DataSource({ type: "postgres", url, migrations: migrations.slice(0, migrations.indexOf(LoanDueOn1795564800000)) });
    await before.initialize();
    await before.runMigrations();
    await before.query(`INSERT INTO loans (amount, received_on) VALUES (100000, '2026-11-01'), (50000, '2026-10-01')`);
    await before.destroy();

    const ds = createDataSource(url);
    await ds.initialize();
    await ds.runMigrations();
    expect(await ds.query(`SELECT amount::int AS amount, received_on::text AS received_on, due_on FROM loans ORDER BY id`)).toEqual([
      { amount: 100_000, received_on: "2026-11-01", due_on: null },
      { amount: 50_000, received_on: "2026-10-01", due_on: null },
    ]);
    for (let i = migrations.indexOf(LoanDueOn1795564800000); i < migrations.length; i++) await ds.undoLastMigration();
    expect(await ds.query(`SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='due_on'`)).toEqual([]);
    expect(await ds.query(`SELECT count(*)::int AS n FROM loans`)).toEqual([{ n: 2 }]);
    await ds.destroy();
  });

  it("0026 moves events still expected on the old 25th to their window's end and keeps dates set by hand (Б28)", async () => {
    const url = await createTestDatabase();
    const before = new DataSource({ type: "postgres", url, migrations: migrations.slice(0, migrations.indexOf(IncomeEventDateByHand1795737600000)) });
    await before.initialize();
    await before.runMigrations();
    await before.query(
      `INSERT INTO expected_incomes (id, source, amount, currency, window_start_day, window_end_day)
       VALUES (1, 'fop', 100000, 'UAH', 5, 10), (2, 'usdc', 100000, 'USD', 25, 31)`,
    );
    await before.query(
      `INSERT INTO income_events (expected_income_id, period, expected_on, status, received_at) VALUES
         (1, '2026-10', '2026-10-25', 'received', '2026-10-24T10:00:00Z'),
         (1, '2026-11', '2026-11-25', 'expected', NULL),
         (1, '2026-12', '2026-12-19', 'expected', NULL),
         (2, '2026-11', '2026-11-25', 'expected', NULL),
         (2, '2027-02', '2027-02-25', 'expected', NULL)`,
    );
    await before.destroy();

    const ds = createDataSource(url);
    await ds.initialize();
    await ds.runMigrations();
    const rows = () =>
      ds.query(`SELECT expected_income_id AS x, period, expected_on::text AS on, date_set_by_hand AS hand FROM income_events ORDER BY expected_income_id, period`);
    expect(await rows()).toEqual([
      { x: 1, period: "2026-10", on: "2026-10-25", hand: false }, // received: untouched
      { x: 1, period: "2026-11", on: "2026-11-10", hand: false }, // the old 25th: to the window's end
      { x: 1, period: "2026-12", on: "2026-12-19", hand: true }, // not the 25th: set by the owner, kept
      { x: 2, period: "2026-11", on: "2026-11-30", hand: false }, // end 31, clamped to November
      { x: 2, period: "2027-02", on: "2027-02-28", hand: false }, // and to February
    ]);
    for (let i = migrations.indexOf(IncomeEventDateByHand1795737600000); i < migrations.length; i++) await ds.undoLastMigration();
    expect(await ds.query(`SELECT 1 FROM information_schema.columns WHERE column_name='date_set_by_hand'`)).toEqual([]);
    expect(await ds.query(`SELECT count(*)::int AS n FROM income_events`)).toEqual([{ n: 5 }]);
    await ds.destroy();
  });

  it("0027 starts each series at its earliest payment and leaves the payments alone (Б29)", async () => {
    const url = await createTestDatabase();
    const before = new DataSource({ type: "postgres", url, migrations: migrations.slice(0, migrations.indexOf(RecurringStart1795824000000)) });
    await before.initialize();
    await before.runMigrations();
    await before.query(
      `INSERT INTO recurring_payments (id, name, amount, currency, day_of_month, active) VALUES
         (1, 'Квартира', 100000, 'UAH', 10, true), (2, 'Спорт', 50000, 'UAH', 20, false)`,
    );
    await before.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, recurring_id, paid_at) VALUES
         ('obligation', 'Квартира', 100000, 'UAH', '2026-11-10', 1, NULL),
         ('obligation', 'Квартира', 100000, 'UAH', '2026-10-10', 1, '2026-10-10T10:00:00Z'),
         ('obligation', 'Квартира', 100000, 'UAH', '2026-12-10', 1, NULL)`,
    );
    const payments = `SELECT id, due_on::text AS d, recurring_id AS r, paid_at IS NOT NULL AS paid FROM scheduled_payments ORDER BY id`;
    const was = await before.query(payments);
    await before.destroy();

    const ds = createDataSource(url);
    await ds.initialize();
    await ds.runMigrations();
    expect(await ds.query(`SELECT id, starts_on::text AS s FROM recurring_payments ORDER BY id`)).toEqual([
      { id: 1, s: "2026-10-10" }, // its earliest payment: history stays as it is
      { id: 2, s: kyivDate(new Date()) }, // no payments: the day of the migration
    ]);
    expect(await ds.query(payments)).toEqual(was);
    expect(await ds.query(`SELECT count(*)::int AS n FROM recurring_skips`)).toEqual([{ n: 0 }]);
    for (let i = migrations.indexOf(RecurringStart1795824000000); i < migrations.length; i++) await ds.undoLastMigration();
    expect(await ds.query(`SELECT 1 FROM information_schema.columns WHERE column_name='starts_on'`)).toEqual([]);
    expect(await ds.query(payments)).toEqual(was);
    await ds.destroy();
  });

  it("0028 starts a started wallet at the beginning of its first Kyiv day and leaves a wallet not started alone (Б39)", async () => {
    const at = async (cashStart: string | null) => {
      const url = await createTestDatabase();
      const before = new DataSource({ type: "postgres", url, migrations: migrations.slice(0, migrations.indexOf(CashStartedAt1795910400000)) });
      await before.initialize();
      await before.runMigrations();
      await before.query(`UPDATE settings SET cash_start=$1 WHERE id=1`, [cashStart]);
      await before.destroy();
      const ds = createDataSource(url);
      await ds.initialize();
      await ds.runMigrations();
      const r = (await ds.query(`SELECT cash_start::text AS d, cash_started_at AS at FROM settings WHERE id=1`))[0] as { d: string | null; at: Date | null };
      for (let i = migrations.indexOf(CashStartedAt1795910400000); i < migrations.length; i++) await ds.undoLastMigration();
      expect(await ds.query(`SELECT 1 FROM information_schema.columns WHERE column_name='cash_started_at'`)).toEqual([]);
      expect((await ds.query(`SELECT cash_start::text AS d FROM settings WHERE id=1`))[0].d).toBe(cashStart);
      await ds.destroy();
      return r;
    };
    // Midnight in Kyiv is 22:00 UTC the day before in winter time: exactly the day-based rule the wallet had.
    expect(await at("2026-11-10")).toEqual({ d: "2026-11-10", at: new Date("2026-11-09T22:00:00Z") });
    expect(await at(null)).toEqual({ d: null, at: null });
  });

  it("0029 counts a started wallet as counted now, and leaves every kept answer absorbing nothing (Б40)", async () => {
    const at = async (cashStart: string | null) => {
      const url = await createTestDatabase();
      const before = new DataSource({ type: "postgres", url, migrations: migrations.slice(0, migrations.indexOf(CashCountAbsorbed1795996800000)) });
      await before.initialize();
      await before.runMigrations();
      await before.query(`UPDATE settings SET cash_start=$1 WHERE id=1`, [cashStart]);
      const account = (await before.query(`INSERT INTO accounts (external_id, kind, currency, balance) VALUES ('a','black','UAH',0) RETURNING id`))[0].id;
      const tx = (
        await before.query(
          `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, amount, amount_uah, type, from_wallet, raw)
           VALUES ('t',$1,'2026-11-10T10:00:00Z','2026-11-10',50000,50000,'own_transfer',true,'{}') RETURNING id`,
          [account],
        )
      )[0].id;
      await before.query(
        `INSERT INTO cash_answers (transaction_id, answer, type_before, needs_label_before, usdc_checked_before) VALUES ($1,'wallet','cash_in',false,false)`,
        [tx],
      );
      await before.destroy();
      const ds = createDataSource(url);
      await ds.initialize();
      const ran = Date.now();
      await ds.runMigrations();
      const s = (await ds.query(`SELECT cash_counted_at AS at FROM settings WHERE id=1`))[0] as { at: Date | null };
      const a = (await ds.query(`SELECT answer, count_transaction_id, count_absorbed::int AS absorbed, count_row FROM cash_answers`))[0];
      for (let i = migrations.indexOf(CashCountAbsorbed1795996800000); i < migrations.length; i++) await ds.undoLastMigration();
      expect(await ds.query(`SELECT 1 FROM information_schema.columns WHERE column_name IN ('cash_counted_at','count_absorbed','count_row')`)).toEqual([]);
      expect(await ds.query(`SELECT answer FROM cash_answers`)).toEqual([{ answer: "wallet" }]);
      await ds.destroy();
      return { counted: s.at === null ? null : s.at.getTime() >= ran - 60_000, answer: a };
    };
    const answer = { answer: "wallet", count_transaction_id: null, absorbed: 0, count_row: null };
    expect(await at("2026-11-10")).toEqual({ counted: true, answer });
    expect(await at(null)).toEqual({ counted: null, answer });
  });

  it("0030 marks every row the owner typed before it as changed by an unknown hand, and nothing else (Б36)", async () => {
    const url = await createTestDatabase();
    const before = new DataSource({ type: "postgres", url, migrations: migrations.slice(0, migrations.indexOf(OwnerRuleMark1796083200000)) });
    await before.initialize();
    await before.runMigrations();
    const account = (await before.query(`INSERT INTO accounts (external_id, kind, currency, balance) VALUES ('a','black','UAH',0) RETURNING id`))[0].id;
    for (const [ext, source] of [["owner", "owner"], ["rule", "rule"], ["auto", "auto"], ["none", null]] as const) {
      await before.query(
        `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, amount, amount_uah, type, type_source, raw)
         VALUES ($1,$2,'2026-11-10T10:00:00Z','2026-11-10',-50000,-50000,'obligation',$3,'{}')`,
        [ext, account, source],
      );
    }
    const rows = `SELECT external_id, type, type_source FROM transactions ORDER BY id`;
    const was = await before.query(rows);
    await before.destroy();

    const ds = createDataSource(url);
    await ds.initialize();
    await ds.runMigrations();
    expect(await ds.query(`SELECT external_id, owner_rule_id FROM transactions ORDER BY id`)).toEqual([
      { external_id: "owner", owner_rule_id: -1 },
      { external_id: "rule", owner_rule_id: null },
      { external_id: "auto", owner_rule_id: null },
      { external_id: "none", owner_rule_id: null },
    ]);
    expect(await ds.query(rows)).toEqual(was);
    for (let i = migrations.indexOf(OwnerRuleMark1796083200000); i < migrations.length; i++) await ds.undoLastMigration();
    expect(await ds.query(`SELECT 1 FROM information_schema.columns WHERE column_name='owner_rule_id'`)).toEqual([]);
    expect(await ds.query(rows)).toEqual(was);
    await ds.destroy();
  });

  it("0031 records that no row was classified by a numbered classifier yet, and changes nothing else (Б49)", async () => {
    const url = await createTestDatabase();
    const before = new DataSource({ type: "postgres", url, migrations: migrations.slice(0, migrations.indexOf(SettingsClassifierVersion1796169600000)) });
    await before.initialize();
    await before.runMigrations();
    await before.query(`UPDATE settings SET tax_rate_bp=500 WHERE id=1`);
    const was = await before.query(`SELECT * FROM settings`);
    await before.destroy();

    const ds = createDataSource(url);
    await ds.initialize();
    await ds.runMigrations();
    const after: Record<string, unknown>[] = await ds.query(`SELECT * FROM settings`);
    expect(after).toEqual([{ ...was[0], classifier_version: 0 }]);
    for (let i = migrations.indexOf(SettingsClassifierVersion1796169600000); i < migrations.length; i++) await ds.undoLastMigration();
    expect(await ds.query(`SELECT 1 FROM information_schema.columns WHERE column_name='classifier_version'`)).toEqual([]);
    expect(await ds.query(`SELECT * FROM settings`)).toEqual(was);
    await ds.destroy();
  });
  it("0032 takes the bank's hryvnias for old operations made in hryvnias on a currency account, and nothing else (Б50)", async () => {
    const url = await createTestDatabase();
    const before = new DataSource({ type: "postgres", url, migrations: migrations.slice(0, migrations.indexOf(HryvniaLegAmounts1796256000000)) });
    await before.initialize();
    await before.runMigrations();
    // The server before this change had already classified the rows with classifier 1.
    await before.query(`UPDATE settings SET classifier_version=1 WHERE id=1`);
    const account = async (ext: string, kind: string, currency: string): Promise<number> =>
      (await before.query(`INSERT INTO accounts (external_id, kind, currency, balance) VALUES ($1,$2,$3,0) RETURNING id`, [ext, kind, currency]))[0].id;
    const usd = await account("usd", "white", "USD");
    const card = await account("card", "black", "UAH");
    const insert = (
      ext: string,
      acc: number,
      at: string,
      amount: number,
      amountUah: number | null,
      fxRate: number | null,
      raw: object,
      over: { description?: string; type?: string; typeSource?: string } = {},
    ) =>
      before.query(
        `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, mcc, amount, amount_uah, fx_rate,
                                   type, type_source, raw)
         VALUES ($1,$2,$3,$4,$5,4829,$6,$7,$8,$9,$10,$11)`,
        [ext, acc, at, at.slice(0, 10), over.description ?? "Переказ", amount, amountUah, fxRate, over.type ?? null,
         over.typeSource ?? "auto", JSON.stringify(raw)],
      );
    const item = (amount: number, operationAmount: number, currencyCode: number) => ({ amount, operationAmount, currencyCode });
    // −$100 sold to the owner's hryvnia card for ₴4,127; stored at a guessed rate of 38 (₴3,800), 8% off.
    await insert("sell", usd, "2026-10-10T10:00:00Z", -10000, -380000, 38, item(-10000, -412700, 980), { description: "На чорну картку" });
    await insert("leg", card, "2026-10-10T10:00:30Z", 412700, 412700, null, item(412700, 412700, 980), { description: "З доларового рахунку" });
    // Typed by the owner: the hryvnias become exact, the type stays his.
    await insert("owner", usd, "2026-10-12T10:00:00Z", -5000, -190000, 38, item(-5000, -206350, 980), { type: "spend", typeSource: "owner" });
    // Not to be touched: an operation in dollars, signs that disagree, zero amounts, no bank item, a hryvnia account.
    await insert("dollars", usd, "2026-10-14T10:00:00Z", -2000, -76000, 38, item(-2000, -2000, 840));
    await insert("signs", usd, "2026-10-15T10:00:00Z", -2000, -76000, 38, item(-2000, 82000, 980));
    await insert("zero", usd, "2026-10-16T10:00:00Z", 0, 0, 38, item(0, 41000, 980));
    // Both sides zero agree in sign; only the guard on a zero amount keeps it from a division by zero.
    await insert("zeros", usd, "2026-10-16T11:00:00Z", 0, 0, 38, item(0, 0, 980));
    await insert("bare", usd, "2026-10-17T10:00:00Z", -2000, -76000, 38, {});
    await insert("uah", card, "2026-10-18T10:00:00Z", -5000, -5000, null, item(-5000, -6000, 980));

    const own = { ownNames: ["Test Owner"], ownIbans: [], ownJars: [] };
    const types = `SELECT external_id, type FROM transactions WHERE external_id IN ('sell','leg') ORDER BY id`;
    await new ReclassifyService(before, new JobRunner(before, { now: () => Date.now() }), own).reclassifyPending();
    // At the guessed rate the two sides are too far apart to be one exchange: money to and from a person.
    expect(await before.query(types)).toEqual([
      { external_id: "sell", type: "person_transfer" },
      { external_id: "leg", type: "person_in" },
    ]);
    const rows = `SELECT external_id, amount_uah::float8 AS amount_uah, fx_rate::float8 AS fx_rate, type, type_source
                    FROM transactions ORDER BY id`;
    const was: Record<string, unknown>[] = await before.query(rows);
    await before.destroy();

    const ds = createDataSource(url);
    await ds.initialize();
    await ds.runMigrations();
    const after: Record<string, unknown>[] = await ds.query(rows);
    const exact: Record<string, { amount_uah: number; fx_rate: number }> = {
      sell: { amount_uah: -412700, fx_rate: 41.27 },
      owner: { amount_uah: -206350, fx_rate: 41.27 },
    };
    expect(after).toEqual(was.map((r) => ({ ...r, ...exact[r.external_id as string] })));

    // The next start reclassifies with the raised version, and the exchange is found.
    expect(CLASSIFIER_VERSION).toBeGreaterThan(1);
    const runner = new JobRunner(ds, { now: () => Date.now() });
    const svc = new ReclassifyService(ds, runner, own);
    svc.onModuleInit();
    await svc.onApplicationBootstrap();
    expect(await runner.runOnce()).toBe(true);
    expect(await ds.query(types)).toEqual([
      { external_id: "sell", type: "own_transfer" },
      { external_id: "leg", type: "own_transfer" },
    ]);
    expect((await ds.query(`SELECT type, type_source FROM transactions WHERE external_id='owner'`))[0]).toEqual({ type: "spend", type_source: "owner" });

    // Down cannot bring the guessed amounts back and leaves the exact ones.
    for (let i = migrations.indexOf(HryvniaLegAmounts1796256000000); i < migrations.length; i++) await ds.undoLastMigration();
    expect((await ds.query(`SELECT amount_uah::float8 AS v FROM transactions WHERE external_id='sell'`))[0].v).toBe(-412700);
    await ds.destroy();
  });

  it("0033 gives every card answered before it the migration's time as its answer time, and changes nothing else (Б47.5)", async () => {
    const url = await createTestDatabase();
    const before = new DataSource({ type: "postgres", url, migrations: migrations.slice(0, migrations.indexOf(CashCardAnsweredAt1796342400000)) });
    await before.initialize();
    await before.runMigrations();
    await before.query(`INSERT INTO cash_cards (counter_key, withdraws) VALUES ('yes', true), ('no', false)`);
    const was = await before.query(`SELECT * FROM cash_cards ORDER BY counter_key`);
    await before.destroy();

    const ds = createDataSource(url);
    await ds.initialize();
    const from = new Date();
    await ds.runMigrations();
    const to = new Date();
    const after: { counter_key: string; withdraws: boolean; answered_at: Date }[] = await ds.query(`SELECT * FROM cash_cards ORDER BY counter_key`);
    expect(after.map((r) => ({ counter_key: r.counter_key, withdraws: r.withdraws }))).toEqual(was);
    for (const r of after) {
      expect(r.answered_at.getTime()).toBeGreaterThanOrEqual(from.getTime() - 1000);
      expect(r.answered_at.getTime()).toBeLessThanOrEqual(to.getTime() + 1000);
    }
    for (let i = migrations.indexOf(CashCardAnsweredAt1796342400000); i < migrations.length; i++) await ds.undoLastMigration();
    expect(await ds.query(`SELECT 1 FROM information_schema.columns WHERE table_name='cash_cards' AND column_name='answered_at'`)).toEqual([]);
    expect(await ds.query(`SELECT * FROM cash_cards ORDER BY counter_key`)).toEqual(was);
    await ds.destroy();
  });

  it("0034 makes every card's answer cover all its transfers so far, and down keeps the latest answer of a card (Б47.6)", async () => {
    const url = await createTestDatabase();
    const before = new DataSource({ type: "postgres", url, migrations: migrations.slice(0, migrations.indexOf(CashCardAnswerFrom1796428800000)) });
    await before.initialize();
    await before.runMigrations();
    await before.query(
      `INSERT INTO cash_cards (counter_key, withdraws, answered_at) VALUES ('yes', true, '2026-11-10T10:00:00Z'), ('no', false, '2026-11-11T10:00:00Z')`,
    );
    const was = await before.query(`SELECT * FROM cash_cards ORDER BY counter_key`);
    await before.destroy();

    const ds = createDataSource(url);
    await ds.initialize();
    await ds.runMigrations();
    const after: { counter_key: string; withdraws: boolean; answered_at: Date; from_at: unknown }[] = await ds.query(
      `SELECT counter_key, withdraws, answered_at, from_at::text AS from_at FROM cash_cards ORDER BY counter_key`,
    );
    expect(after).toEqual(was.map((r: object) => ({ ...r, from_at: "-infinity" })));
    // A card can now hold answers from different transfers on; down keeps the one that covers its latest transfers.
    await ds.query(`INSERT INTO cash_cards (counter_key, withdraws, answered_at, from_at) VALUES ('yes', false, '2026-12-15T12:00:00Z', '2026-12-15T10:00:00Z')`);
    for (let i = migrations.indexOf(CashCardAnswerFrom1796428800000); i < migrations.length; i++) await ds.undoLastMigration();
    expect(await ds.query(`SELECT 1 FROM information_schema.columns WHERE table_name='cash_cards' AND column_name='from_at'`)).toEqual([]);
    expect(await ds.query(`SELECT counter_key, withdraws FROM cash_cards ORDER BY counter_key`)).toEqual([
      { counter_key: "no", withdraws: false },
      { counter_key: "yes", withdraws: false },
    ]);
    await ds.destroy();
  });

  it("0035 adds the categories as today's set and changes no row that stores one (В5)", async () => {
    const url = await createTestDatabase();
    const before = new DataSource({ type: "postgres", url, migrations: migrations.slice(0, migrations.indexOf(Categories1796515200000)) });
    await before.initialize();
    await before.runMigrations();
    const account = (await before.query(`INSERT INTO accounts (external_id, kind, currency, balance) VALUES ('a','black','UAH',0) RETURNING id`))[0].id;
    for (const [n, category] of [[1, "cafe"], [2, "taxi"], [3, null], [4, "tax"]] as const) {
      await before.query(
        `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, amount, amount_uah, type, category, raw)
         VALUES ($1,$2,'2026-11-08T10:00:00Z','2026-11-08',-100,-100,'spend',$3,'{}')`,
        [`t${n}`, account, category],
      );
    }
    await before.query(`INSERT INTO rules (match_kind, match_value, type, category) VALUES ('merchant','uklon','spend','taxi')`);
    const rows = `SELECT external_id, category FROM transactions ORDER BY id`;
    const was = await before.query(rows);
    const rules = await before.query(`SELECT * FROM rules`);
    await before.destroy();

    const ds = createDataSource(url);
    await ds.initialize();
    await ds.runMigrations();
    expect(await ds.query(`SELECT key, name, icon, position, system, deleted_at FROM categories ORDER BY position`)).toEqual(
      [
        ["groceries", "Продукты", "cart"],
        ["cafe", "Кафе и рестораны", "coffee"],
        ["transport", "Транспорт", "car"],
        ["subscriptions", "Подписки", "repeat"],
        ["leisure", "Досуг", "ticket"],
        ["health", "Здоровье", "heart"],
        ["utilities", "Коммунальные", "bolt"],
        ["telecom", "Связь", "phone"],
        ["shopping", "Покупки", "bag"],
        ["refund", "Возвраты", "arrowIn"],
        ["uncategorized", "Без категории", "circle"],
      ].map(([key, name, icon], position) => ({ key, name, icon, position, system: key === "refund" || key === "uncategorized", deleted_at: null })),
    );
    expect(await ds.query(rows)).toEqual(was);
    expect(await ds.query(`SELECT * FROM rules`)).toEqual(rules);

    for (let i = migrations.indexOf(Categories1796515200000); i < migrations.length; i++) await ds.undoLastMigration();
    expect(await ds.query(`SELECT to_regclass('categories') AS t`)).toEqual([{ t: null }]);
    expect(await ds.query(rows)).toEqual(was);
    await ds.destroy();
  });

  it("0036 adds two empty tables for observations and changes no existing row (В7)", async () => {
    const url = await createTestDatabase();
    const before = new DataSource({ type: "postgres", url, migrations: migrations.slice(0, migrations.indexOf(Observations1796601600000)) });
    await before.initialize();
    await before.runMigrations();
    const account = (await before.query(`INSERT INTO accounts (external_id, kind, currency, balance) VALUES ('a','black','UAH',0) RETURNING id`))[0].id;
    await before.query(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, amount, amount_uah, type, category, raw)
       VALUES ('t1',$1,'2026-11-08T10:00:00Z','2026-11-08',-100,-100,'spend','cafe','{}')`,
      [account],
    );
    const rows = `SELECT external_id, category, amount_uah FROM transactions ORDER BY id`;
    const was = await before.query(rows);
    await before.destroy();

    const ds = createDataSource(url);
    await ds.initialize();
    await ds.runMigrations();
    expect(await ds.query(`SELECT * FROM observations_shown`)).toEqual([]);
    expect(await ds.query(`SELECT * FROM observation_dismissals`)).toEqual([]);
    expect(await ds.query(rows)).toEqual(was);
    // One a day; one dismissal per kind and category, the subscriptions kind without a category included.
    await ds.query(`INSERT INTO observations_shown (local_date, kind, category, observation) VALUES ('2026-11-19','spike','cafe','{}')`);
    await expect(ds.query(`INSERT INTO observations_shown (local_date, kind, category, observation) VALUES ('2026-11-19','subscriptions',NULL,'{}')`)).rejects.toThrow();
    await ds.query(`INSERT INTO observation_dismissals (kind, category) VALUES ('subscriptions', NULL), ('spike', 'cafe')`);
    await expect(ds.query(`INSERT INTO observation_dismissals (kind, category) VALUES ('subscriptions', NULL)`)).rejects.toThrow();
    await expect(ds.query(`INSERT INTO observation_dismissals (kind, category) VALUES ('other', NULL)`)).rejects.toThrow();

    for (let i = migrations.indexOf(Observations1796601600000); i < migrations.length; i++) await ds.undoLastMigration();
    expect(await ds.query(`SELECT to_regclass('observations_shown') AS a, to_regclass('observation_dismissals') AS b`)).toEqual([{ a: null, b: null }]);
    expect(await ds.query(rows)).toEqual(was);
    await ds.destroy();
  });

  it("0037 gives the categories a side and the operations an empty choice of their own; nothing else changes (В6)", async () => {
    const url = await createTestDatabase();
    const before = new DataSource({ type: "postgres", url, migrations: migrations.slice(0, migrations.indexOf(Want1796688000000)) });
    await before.initialize();
    await before.runMigrations();
    const account = (await before.query(`INSERT INTO accounts (external_id, kind, currency, balance) VALUES ('a','black','UAH',0) RETURNING id`))[0].id;
    await before.query(`INSERT INTO categories (key, name, icon, position) VALUES ('c_own', 'Кот', 'paw', 11), ('c_gone', 'Старое', 'star', 12)`);
    await before.query(`UPDATE categories SET deleted_at = now() WHERE key = 'c_gone'`);
    for (const [n, category] of [[1, "cafe"], [2, "groceries"], [3, null], [4, "c_own"]] as const) {
      await before.query(
        `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, amount, amount_uah, type, category, type_source, raw)
         VALUES ($1,$2,'2026-11-08T10:00:00Z','2026-11-08',-100,-100,'spend',$3,'owner','{}')`,
        [`t${n}`, account, category],
      );
    }
    const rows = `SELECT external_id, type, category, amount_uah, type_source FROM transactions ORDER BY id`;
    const categories = `SELECT key, name, icon, position, system, deleted_at FROM categories ORDER BY id`;
    const was = await before.query(rows);
    const wasCategories = await before.query(categories);
    await before.destroy();

    const ds = createDataSource(url);
    await ds.initialize();
    await ds.runMigrations();
    const sides = (await ds.query(`SELECT key, want FROM categories ORDER BY id`)) as { key: string; want: boolean | null }[];
    expect(Object.fromEntries(sides.map((c) => [c.key, c.want]))).toEqual({
      groceries: false, cafe: true, transport: false, subscriptions: true, leisure: true, health: false, utilities: false, telecom: false,
      shopping: true, refund: null, uncategorized: null, c_own: false, c_gone: false,
    });
    expect(await ds.query(`SELECT DISTINCT want_override FROM transactions`)).toEqual([{ want_override: null }]);
    expect(await ds.query(rows)).toEqual(was);
    expect(await ds.query(categories)).toEqual(wasCategories);
    // A system category has no side; every other one has one.
    await expect(ds.query(`UPDATE categories SET want = false WHERE key = 'refund'`)).rejects.toThrow();
    await expect(ds.query(`UPDATE categories SET want = NULL WHERE key = 'cafe'`)).rejects.toThrow();

    for (let i = migrations.indexOf(Want1796688000000); i < migrations.length; i++) await ds.undoLastMigration();
    expect(await ds.query(`SELECT table_name, column_name FROM information_schema.columns WHERE column_name IN ('want', 'want_override')`)).toEqual([]);
    expect(await ds.query(rows)).toEqual(was);
    expect(await ds.query(categories)).toEqual(wasCategories);
    await ds.destroy();
  });
});
