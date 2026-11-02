/**
 * Loads the owner's planned data (private/seed.json, git-ignored) into the database.
 *
 *   DATABASE_URL=postgres://... pnpm seed:private
 *
 * Idempotent: settings are overwritten with the file's values, everything else is inserted only
 * when no row with the same natural key exists (incomes by source, payments by kind + name + due
 * date, balances by name), so running it again changes nothing. Monthly payments are expanded
 * for the next few months only; running the seed again later extends them.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { seedFile, type SeedFile, type SeedPayment } from "../packages/contracts/src/index";

const SEED_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "private", "seed.json");

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD for the given month index (0-based, may exceed 11), clamping the day to the month. */
function dateIn(year: number, monthIndex: number, day: number): string {
  const y = year + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${pad(m + 1)}-${pad(Math.min(day, last))}`;
}

/** Every payment the seed describes, in one flat list with explicit due dates. */
export function expandPayments(seed: SeedFile, today: string): SeedPayment[] {
  const out: SeedPayment[] = [...seed.payments];
  for (const i of seed.installments) {
    const y = Number(i.last_payment_on.slice(0, 4));
    const m = Number(i.last_payment_on.slice(5, 7)) - 1;
    const d = Number(i.last_payment_on.slice(8, 10));
    for (let k = i.remaining - 1; k >= 0; k--) {
      out.push({
        kind: "installment",
        name: i.name,
        amount: i.amount,
        currency: i.currency,
        due_on: dateIn(y, m - k, d),
        overpayment: i.overpayment ?? false,
        ...(i.match_hint ? { match_hint: i.match_hint } : {}),
      });
    }
  }
  const ty = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7)) - 1;
  for (const p of seed.monthly_payments) {
    // First occurrence is this month if its day has not passed yet, else next month.
    const start = dateIn(ty, tm, p.day) >= today ? tm : tm + 1;
    for (let k = 0; k < p.months; k++) {
      out.push({
        kind: p.kind,
        name: p.name,
        amount: p.amount,
        currency: p.currency,
        due_on: dateIn(ty, start + k, p.day),
        ...(p.match_hint ? { match_hint: p.match_hint } : {}),
      });
    }
  }
  return out;
}

export function parseSeed(text: string): SeedFile {
  return seedFile.parse(JSON.parse(text));
}

export interface SeedResult {
  incomes: number;
  payments: number;
  balances: number;
}

export async function applySeed(db: Queryable, seed: SeedFile, today: string): Promise<SeedResult> {
  const inserted = async (sql: string, params: unknown[]) => ((await db.query(sql, params)) as unknown[]).length;
  const result: SeedResult = { incomes: 0, payments: 0, balances: 0 };

  const s = seed.settings;
  if (s) {
    for (const [k, v] of Object.entries(s)) {
      if (!/^[a-z_]+$/.test(k)) throw new Error(`bad settings key ${k}`);
      await db.query(`UPDATE settings SET ${k}=$1 WHERE id=1`, [v]);
    }
  }
  for (const e of seed.expected_incomes) {
    result.incomes += await inserted(
      `INSERT INTO expected_incomes (source, amount, currency, window_start_day, window_end_day)
       SELECT $1::text,$2,$3,$4,$5 WHERE NOT EXISTS (SELECT 1 FROM expected_incomes WHERE source=$1::text) RETURNING id`,
      [e.source, e.amount, e.currency, e.window_start_day, e.window_end_day],
    );
  }
  for (const p of expandPayments(seed, today)) {
    result.payments += await inserted(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, paid_at, match_hint, overpayment)
       SELECT $1::text,$2::text,$3,$4,$5::date, CASE WHEN $6::boolean THEN $5::date::timestamptz END,$7,$8
        WHERE NOT EXISTS (SELECT 1 FROM scheduled_payments WHERE kind=$1::text AND name=$2::text AND due_on=$5::date)
       RETURNING id`,
      [p.kind, p.name, p.amount, p.currency, p.due_on, p.paid ?? false, p.match_hint ?? null, p.overpayment ?? false],
    );
  }
  for (const b of seed.manual_balances) {
    result.balances += await inserted(
      `INSERT INTO manual_balances (name, amount, currency, counts_as_own) VALUES ($1,$2,$3,$4)
       ON CONFLICT (name) DO NOTHING RETURNING id`,
      [b.name, b.amount, b.currency, b.counts_as_own ?? true],
    );
  }
  return result;
}

export async function main(): Promise<number> {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error("seed-private: set DATABASE_URL");
    return 2;
  }
  if (!existsSync(SEED_PATH)) {
    console.error(`seed-private: ${SEED_PATH} is missing (see the file header)`);
    return 2;
  }
  const seed = parseSeed(readFileSync(SEED_PATH, "utf8"));
  const { createDataSource } = await import("../apps/api/src/db/data-source");
  const ds = createDataSource(url);
  await ds.initialize();
  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
    const r = await applySeed(ds, seed, today);
    console.log(`seeded: ${r.incomes} incomes, ${r.payments} payments, ${r.balances} balances (new rows only)`);
  } finally {
    await ds.destroy();
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
