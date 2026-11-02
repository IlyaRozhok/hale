/**
 * Golden check 2: sums the transactions in the API database (black and white cards,
 * 1 Jan - 29 Oct 2026) per report group, with the app's types mapped through
 * golden-mapping, and prints them next to the report's totals. A human judges the result.
 *
 *   DATABASE_URL=postgres://... pnpm golden:import
 *
 * Needs a database filled by the real monobank import (owner gate: it needs the owner's
 * token). The expected totals are read from private/golden-expected.json (git-ignored):
 *   {"Доход": n, "Расходы": n, "Долги": n, "Займы": n, "Переводы": n}   (whole hryvnias)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FOP_WITHDRAWAL, type TxType } from "../apps/api/src/domain/classify";
import {
  compareTotals,
  type ExpectedTotals,
  REPORT_GROUPS,
  type ReportGroup,
  sumByReportGroup,
  type SummableRow,
} from "./golden-mapping";

export const PERIOD = { from: "2026-01-01", to: "2026-10-29" };
const EXPECTED_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "private", "golden-expected.json");

export interface DbRow {
  type: string | null;
  /** Kopecks. */
  amount_uah: number | null;
  description: string;
  hold: boolean;
}

export interface DbSummary {
  sums: Record<ReportGroup, number>;
  skipped: { hold: number; noAmount: number; untyped: number };
}

/** Kopecks to hryvnias, dropping holds, rows with no UAH amount and untyped rows. */
export function summarizeDb(rows: readonly DbRow[]): DbSummary {
  const skipped = { hold: 0, noAmount: 0, untyped: 0 };
  const rowsOut: SummableRow[] = [];
  for (const r of rows) {
    if (r.hold) skipped.hold++;
    else if (r.amount_uah === null) skipped.noAmount++;
    else if (r.type === null) skipped.untyped++;
    else {
      const amount = r.amount_uah / 100;
      rowsOut.push({
        type: r.type as TxType,
        amount,
        fopWithdrawal: amount > 0 && FOP_WITHDRAWAL.test(r.description),
      });
    }
  }
  return { sums: sumByReportGroup(rowsOut), skipped };
}

export function parseExpected(json: string): ExpectedTotals {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const out: Partial<ExpectedTotals> = {};
  for (const g of REPORT_GROUPS) {
    if (g === "Свои счета") continue;
    const v = raw[g];
    if (typeof v !== "number") throw new Error(`expected totals: "${g}" must be a number`);
    out[g] = v;
  }
  return out as ExpectedTotals;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function renderComparison(summary: DbSummary, expected: ExpectedTotals): string {
  const lines = ["group        report      app    diff"];
  for (const d of compareTotals(summary.sums, expected)) {
    const diff = `${d.diff > 0 ? "+" : ""}${fmt(d.diff)}`;
    lines.push(`${d.group.padEnd(10)}  ${fmt(d.expected).padStart(10)}  ${fmt(d.actual).padStart(10)}  ${diff.padStart(10)}`);
  }
  const s = summary.skipped;
  lines.push(`own accounts (not compared): ${fmt(summary.sums["Свои счета"])}`);
  lines.push(`skipped: ${s.hold} on hold, ${s.noAmount} without UAH amount, ${s.untyped} not yet classified`);
  return lines.join("\n");
}

export async function main(): Promise<number> {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error("golden-import: set DATABASE_URL to the database the real import filled");
    return 2;
  }
  if (!existsSync(EXPECTED_PATH)) {
    console.error(`golden-import: ${EXPECTED_PATH} is missing (expected report totals, see the file header)`);
    return 2;
  }
  const expected = parseExpected(readFileSync(EXPECTED_PATH, "utf8"));
  const { createDataSource } = await import("../apps/api/src/db/data-source");
  const ds = createDataSource(url);
  await ds.initialize();
  try {
    const rows: DbRow[] = await ds.query(
      `SELECT t.type, t.amount_uah::float8 AS amount_uah, t.description, t.hold
         FROM transactions t JOIN accounts a ON a.id = t.account_id
        WHERE a.kind IN ('black','white') AND t.local_date BETWEEN $1 AND $2`,
      [PERIOD.from, PERIOD.to],
    );
    console.log(`${rows.length} rows, ${PERIOD.from} to ${PERIOD.to}, black and white cards`);
    console.log(renderComparison(summarizeDb(rows), expected));
  } finally {
    await ds.destroy();
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
