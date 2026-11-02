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

  // The two zones are 26 hours apart, so at any moment at least one has a different date from Kyiv.
  it.each(["Etc/GMT+12", "Etc/GMT-14"])("starts tracking on the seed date in Kyiv when the session is in %s", async (zone) => {
    await ds.query(
      `UPDATE settings SET lifestyle_cap=0, food_floor=0, tax_rate_bp=600, esv_quarter=0, limit_visual='mercury', tracking_start='2020-01-01'`,
    );
    await ds.transaction(async (m) => {
      await m.query(`SET LOCAL TIME ZONE '${zone}'`);
      await applySeed(m, parseSeed(SEED));
    });
    const r = (await ds.query(`SELECT tracking_start = (now() AT TIME ZONE 'Europe/Kyiv')::date AS kyiv FROM settings`))[0];
    expect(r.kyiv).toBe(true);
  });
  });
});
