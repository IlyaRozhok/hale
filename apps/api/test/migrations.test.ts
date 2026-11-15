import { describe, expect, it } from "vitest";
import pg from "pg";
import { DataSource } from "typeorm";
import { createDataSource, migrations } from "../src/db/data-source";
import { PaymentClosedByLinks1795392000000 } from "../src/db/migrations/0022-payment-closed-by-links";
import { createTestDatabase } from "./db";

const TABLES = [
  "accounts", "transactions", "rules", "expected_incomes", "income_events",
  "scheduled_payments", "recurring_payments", "manual_balances", "loans", "settings", "bridge_plans",
  "daily_snapshots", "fx_rates",
      "goals", "jobs", "devices", "notifications_log", "loan_repayments", "payment_links", "cash_cards", "payment_dismissals", "cash_answers",
  "ledger_checks",
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
});
