/**
 * Loads the owner's planned data (private/seed.json, git-ignored) into the database.
 *
 *   DATABASE_URL=postgres://... pnpm seed:private
 *
 * Idempotent: everything is inserted only when no row with the same natural key exists
 * (incomes by source, payments by kind + name + due
 * date, recurring series by name, balances by name), so running it again changes nothing.
 * Settings are written only while the settings row is still at its defaults.
 * Today's fixed limit is removed: it was computed without this data. Income events and recurring
 * payments are made by the API on restart or within the hour, not here.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { kyivDate } from "../apps/api/src/domain/money";
import { precedingQuarter } from "../apps/api/src/domain/quarter";
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

/** Per-payment installment rows and explicit payments, with explicit due dates. */
export function expandPayments(seed: SeedFile): SeedPayment[] {
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
  return out;
}

export function parseSeed(text: string): SeedFile {
  return seedFile.parse(JSON.parse(text));
}

export interface SeedResult {
  incomes: number;
  payments: number;
  recurring: number;
  balances: number;
}

export async function applySeed(db: Queryable, seed: SeedFile, now: Date = new Date()): Promise<SeedResult> {
  const today = kyivDate(now);
  const inserted = async (sql: string, params: unknown[]) => ((await db.query(sql, params)) as unknown[]).length;
  const result: SeedResult = { incomes: 0, payments: 0, recurring: 0, balances: 0 };

  // Settings are the owner's to change in the app: write them only while the row is untouched.
  const s = seed.settings;
  if (s && Object.keys(s).length > 0) {
    const cols = Object.keys(s);
    if (cols.some((k) => !/^[a-z_]+$/.test(k))) throw new Error("bad settings key");
    await db.query(
      // The seed date in Kyiv is when tracking starts: loans imported from earlier history never alert or count.
      `UPDATE settings SET ${cols.map((k, i) => `${k}=$${i + 1}`).join(", ")}, tracking_start=$${cols.length + 1}::date
        WHERE id=1 AND lifestyle_cap=0 AND food_floor=0 AND tax_rate_bp=600 AND esv_quarter=0 AND limit_visual='mercury'`,
      [...Object.values(s), today],
    );
  }
  for (const e of seed.expected_incomes) {
    result.incomes += await inserted(
      `INSERT INTO expected_incomes (source, amount, currency, window_start_day, window_end_day)
       SELECT $1::text,$2,$3,$4,$5 WHERE NOT EXISTS (SELECT 1 FROM expected_incomes WHERE source=$1::text) RETURNING id`,
      [e.source, e.amount, e.currency, e.window_start_day, e.window_end_day],
    );
  }
  for (const p of expandPayments(seed)) {
    const taxQuarter = p.kind === "tax" ? (p.tax_quarter ?? precedingQuarter(p.due_on)) : null;
    result.payments += await inserted(
      `INSERT INTO scheduled_payments (kind, name, amount, currency, due_on, paid_at, match_hint, overpayment, tax_quarter)
       SELECT $1::text,$2::text,$3,$4,$5::date, CASE WHEN $6::boolean THEN $5::date::timestamptz END,$7,$8,$9::text
        WHERE NOT EXISTS (SELECT 1 FROM scheduled_payments WHERE kind=$1::text AND name=$2::text AND due_on=$5::date)
       RETURNING id`,
      [p.kind, p.name, p.amount, p.currency, p.due_on, p.paid ?? false, p.match_hint ?? null, p.overpayment ?? false, taxQuarter],
    );
    // The owner's real figures replace any estimate the API made for that quarter.
    if (taxQuarter) await db.query(`DELETE FROM scheduled_payments WHERE is_estimate AND tax_quarter=$1`, [taxQuarter]);
  }
  for (const r of seed.recurring) {
    result.recurring += await inserted(
      `INSERT INTO recurring_payments (kind, name, amount, currency, day_of_month, match_hint, active, starts_on)
       SELECT $1::text,$2::text,$3,$4,$5,$6,$7,$8 WHERE NOT EXISTS (SELECT 1 FROM recurring_payments WHERE name=$2::text)
       RETURNING id`,
      [r.kind ?? "obligation", r.name, r.amount, r.currency, r.day_of_month, r.match_hint ?? null, r.active ?? true, today],
    );
  }
  for (const b of seed.manual_balances) {
    result.balances += await inserted(
      `INSERT INTO manual_balances (name, amount, currency, counts_as_own) VALUES ($1,$2,$3,$4)
       ON CONFLICT (name) DO NOTHING RETURNING id`,
      [b.name, b.amount, b.currency, b.counts_as_own ?? true],
    );
  }
  await db.query(`DELETE FROM daily_snapshots WHERE local_date=$1`, [today]);
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
    const r = await applySeed(ds, seed);
    console.log(
      `seeded: ${r.incomes} incomes, ${r.payments} payments, ${r.recurring} recurring, ${r.balances} balances (new rows only)`,
    );
  } finally {
    await ds.destroy();
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
