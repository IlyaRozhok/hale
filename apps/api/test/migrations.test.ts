import { describe, expect, it } from "vitest";
import pg from "pg";
import { createDataSource } from "../src/db/data-source";
import { createTestDatabase } from "./db";

const TABLES = [
  "accounts", "transactions", "rules", "expected_incomes", "income_events",
  "scheduled_payments", "manual_balances", "loans", "settings", "bridge_plans",
  "daily_snapshots", "fx_rates", "jobs", "devices", "notifications_log",
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

    await ds.undoLastMigration();
    await ds.undoLastMigration();
    expect(await listTables(url)).toEqual([]);
    await ds.destroy();
  });
});
