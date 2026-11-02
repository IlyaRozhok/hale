import type { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expandPayments, applySeed, parseSeed } from "../../../scripts/seed-private";
import { createDataSource } from "../src/db/data-source";
import { createMigratedDatabase } from "./app";

// Anonymised: shapes and arithmetic only, not the owner's figures.
const SEED = JSON.stringify({
  settings: { lifestyle_cap: 1000, food_floor: 10, tax_rate_bp: 600, esv_quarter: 500 },
  expected_incomes: [{ source: "usdc", amount: 100, currency: "USD", window_start_day: 15, window_end_day: 25 }],
  installments: [{ name: "Shop", amount: 1000, remaining: 4, last_payment_on: "2027-02-18", overpayment: true }],
  recurring: [{ name: "Rent", amount: 5000, currency: "UAH", day_of_month: 6 }],
  payments: [{ kind: "tax", name: "Tax", amount: 300, currency: "UAH", due_on: "2026-11-20", paid: true }],
});

describe("seed-private", () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = createDataSource(await createMigratedDatabase());
    await ds.initialize();
  });
  afterAll(async () => {
    await ds.destroy();
  });

  it("expands installments back from the last payment date", () => {
    const dates = expandPayments(parseSeed(SEED)).filter((p) => p.name === "Shop").map((p) => p.due_on);
    expect(dates).toEqual(["2026-11-18", "2026-12-18", "2027-01-18", "2027-02-18"]);
  });

  it("is idempotent, writes recurring rows, and keeps installment flags and paid state", async () => {
    const seed = parseSeed(SEED);
    const first = await applySeed(ds, seed);
    const second = await applySeed(ds, seed);
    expect(first).toEqual({ incomes: 1, payments: 5, recurring: 1, balances: 0 });
    expect(second).toEqual({ incomes: 0, payments: 0, recurring: 0, balances: 0 });
    const rows = await ds.query(
      `SELECT kind, count(*)::int AS n, bool_or(overpayment) AS over, count(paid_at)::int AS paid FROM scheduled_payments GROUP BY kind ORDER BY kind`,
    );
    expect(rows).toEqual([
      { kind: "installment", n: 4, over: true, paid: 0 },
      { kind: "tax", n: 1, over: false, paid: 1 },
    ]);
    expect(await ds.query(`SELECT name, day_of_month, active FROM recurring_payments`)).toEqual([
      { name: "Rent", day_of_month: 6, active: true },
    ]);
  });

  it("writes settings on the first seed only, never over the owner's changes", async () => {
    expect((await ds.query(`SELECT lifestyle_cap::int AS c FROM settings`))[0].c).toBe(1000);
    await ds.query(`UPDATE settings SET lifestyle_cap=777`);
    await applySeed(ds, parseSeed(SEED));
    expect((await ds.query(`SELECT lifestyle_cap::int AS c FROM settings`))[0].c).toBe(777);
  });

  it("starts tracking on the seed date in Kyiv, not the session's", async () => {
    await ds.query(
      `UPDATE settings SET lifestyle_cap=0, food_floor=0, tax_rate_bp=600, esv_quarter=0, limit_visual='mercury', tracking_start='2020-01-01'`,
    );
    await applySeed(ds, parseSeed(SEED), new Date("2026-11-01T22:30:00Z")); // 00:30 on the 2nd in Kyiv
    expect((await ds.query(`SELECT tracking_start::text AS d FROM settings`))[0].d).toBe("2026-11-02");
  });

  it("names the quarter of its tax rows and replaces that quarter's estimate", async () => {
    expect((await ds.query(`SELECT tax_quarter FROM scheduled_payments WHERE name='Tax'`))[0].tax_quarter).toBe("2026-Q3");
    const noQuarter = await ds.query(`SELECT 1 FROM scheduled_payments WHERE kind<>'tax' AND tax_quarter IS NOT NULL`);
    expect(noQuarter).toHaveLength(0);
    await ds.query(`DELETE FROM scheduled_payments WHERE name='Tax'`);
    await ds.query(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, tax_quarter, is_estimate)
       VALUES ('tax','Estimate',1,'UAH','2026-11-20','2026-Q3',true)`,
    );
    await applySeed(ds, parseSeed(SEED));
    const rows = await ds.query(`SELECT name FROM scheduled_payments WHERE kind='tax'`);
    expect(rows).toEqual([{ name: "Tax" }]);
  });
});
