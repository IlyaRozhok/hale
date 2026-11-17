import { describe, expect, it } from "vitest";
import pg from "pg";
import { DataSource } from "typeorm";
import { createDataSource, migrations } from "../src/db/data-source";
import { PaymentClosedByLinks1795392000000 } from "../src/db/migrations/0022-payment-closed-by-links";
import { LoanDueOn1795564800000 } from "../src/db/migrations/0024-loan-due-on";
import { IncomeEventDateByHand1795737600000 } from "../src/db/migrations/0026-income-event-date-by-hand";
import { RecurringStart1795824000000 } from "../src/db/migrations/0027-recurring-start";
import { CashStartedAt1795910400000 } from "../src/db/migrations/0028-cash-started-at";
import { kyivDate } from "../src/domain/money";
import { createTestDatabase } from "./db";

const TABLES = [
  "accounts", "transactions", "rules", "expected_incomes", "income_events",
  "scheduled_payments", "recurring_payments", "manual_balances", "loans", "settings", "bridge_plans",
  "daily_snapshots", "fx_rates",
      "goals", "jobs", "devices", "notifications_log", "loan_repayments", "payment_links", "cash_cards", "payment_dismissals", "cash_answers",
  "ledger_checks", "cash_exchanges", "recurring_skips",
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
});
