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
  monthly_payments: [{ kind: "obligation", name: "Rent", amount: 5000, currency: "UAH", day: 6, months: 3 }],
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

  it("expands installments back from the last payment and monthly rent forward", () => {
    const dates = (name: string) =>
      expandPayments(parseSeed(SEED), "2026-11-02").filter((p) => p.name === name).map((p) => p.due_on);
    expect(dates("Shop")).toEqual(["2026-11-18", "2026-12-18", "2027-01-18", "2027-02-18"]);
    expect(dates("Rent")).toEqual(["2026-11-06", "2026-12-06", "2027-01-06"]);
    expect(
      expandPayments(parseSeed(SEED), "2026-11-10").filter((p) => p.name === "Rent").map((p) => p.due_on),
    ).toEqual(["2026-12-06", "2027-01-06", "2027-02-06"]);
  });

  it("is idempotent and keeps installment flags and paid state", async () => {
    const seed = parseSeed(SEED);
    const first = await applySeed(ds, seed, "2026-11-02");
    const second = await applySeed(ds, seed, "2026-11-02");
    expect(first).toEqual({ incomes: 1, payments: 8, balances: 0 });
    expect(second).toEqual({ incomes: 0, payments: 0, balances: 0 });
    const rows = await ds.query(
      `SELECT kind, count(*)::int AS n, bool_or(overpayment) AS over, count(paid_at)::int AS paid FROM scheduled_payments GROUP BY kind ORDER BY kind`,
    );
    expect(rows).toEqual([
      { kind: "installment", n: 4, over: true, paid: 0 },
      { kind: "obligation", n: 3, over: false, paid: 0 },
      { kind: "tax", n: 1, over: false, paid: 1 },
    ]);
    expect((await ds.query(`SELECT lifestyle_cap::int AS c FROM settings`))[0].c).toBe(1000);
  });
});
