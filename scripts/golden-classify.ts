/**
 * Golden check 1: runs classify() over the owner's report rows (private/transactions.csv,
 * git-ignored) and compares the result with the report's own grouping, weighted by amount.
 *
 *   pnpm golden:classify          exit 1 below 95%, exit 0 and a note when the file is absent
 *
 * Output is aggregates only. Texts are shown masked: every word outside a small bank-template
 * vocabulary is replaced by `*`, so recipient names never reach the terminal.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  classify,
  FOP_WITHDRAWAL,
  findOwnPairs,
  type ClassifyContext,
  type ClassifyInput,
  type TxType,
} from "../apps/api/src/domain/classify";
import { isAllowed, parseCsv, REPORT_GROUPS, sumByReportGroup } from "./golden-mapping";

export const THRESHOLD = 0.95;
const DEFAULT_CSV = join(dirname(fileURLToPath(import.meta.url)), "..", "private", "transactions.csv");

export interface GoldenRow {
  id: string;
  group: string;
  category: string;
  details: string;
  mcc: number | null;
  /** Hryvnias. */
  amount: number;
  at: number;
  card: string;
}

export function loadRows(path: string): GoldenRow[] {
  return parseCsv(readFileSync(path, "utf8")).map((r) => ({
    id: r["id"] ?? "",
    group: r["group"] ?? "",
    category: r["category"] ?? "",
    details: r["details"] ?? "",
    mcc: r["mcc"] ? Number(r["mcc"]) : null,
    amount: Number(r["amount"]),
    at: Date.parse(`${r["date"]}T${r["time"] ?? "00:00:00"}Z`),
    card: r["card"] ?? "",
  }));
}

const accountOf = (card: string) => (card.startsWith("Бел") ? 2 : 1);
const kindOf = (card: string): "black" | "white" => (card.startsWith("Бел") ? "white" : "black");

/**
 * The CSV has no account holder or jar list, so own names and own jars are read off the rows
 * the report itself files under "Свои счета" (counterparty texts only, never printed).
 */
export function deriveContext(rows: readonly GoldenRow[]): ClassifyContext {
  const names = new Set<string>();
  const jars = new Set<string>();
  for (const r of rows) {
    if (r.group !== "Свои счета") continue;
    const from = /^від:\s*(.+)$/i.exec(r.details);
    if (from?.[1]) names.add(from[1].trim());
    const jar = /^поповнення\s+[«"]([^»"]+)[»"]/i.exec(r.details);
    if (jar?.[1]) jars.add(jar[1].trim());
  }
  return { ownIbans: new Set(), ownNames: [...names], ownJars: [...jars], rules: [] };
}

const SAFE = new Set(
  (
    "з від до на картку картки білої чорної переказ поповнення банки банка часткове зняття виплата " +
    "платіж платежу щомісячний розстрочки повне погашення наступного кредит завтра днів дні готівкою " +
    "банкомат видача готівки термінал списання відсотків за скасування повернення виведення кешбеку " +
    "гривневого рахунку фоп гу дпс гук штраф порушення заборгованості коштів в рамках міграції " +
    "зарахування розстрочка monomarket easypay city uklon bolt food"
  ).split(" "),
);

export function maskText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[\p{L}]+/gu, (w) => (SAFE.has(w) ? w : "*"))
    .replace(/(\*[\s.,'`’-]*)+/g, "* ")
    .trim()
    .slice(0, 48);
}

export interface Disagreement {
  group: string;
  category: string;
  predicted: TxType;
  mcc: number | null;
  text: string;
  count: number;
  amount: number;
}

export interface GoldenResult {
  total: number;
  matched: number;
  share: number;
  byGroup: Record<string, { total: number; matched: number }>;
  disagreements: Disagreement[];
  sums: Record<string, number>;
  reportSums: Record<string, number>;
}

export function evaluate(rows: readonly GoldenRow[], ctx: ClassifyContext): GoldenResult {
  const paired = findOwnPairs(
    rows.map((r) => ({ id: r.id, accountId: accountOf(r.card), at: r.at, amount: Math.round(r.amount * 100) })),
  );
  let total = 0;
  let matched = 0;
  const byGroup: GoldenResult["byGroup"] = {};
  const classes = new Map<string, Disagreement>();
  const summable = [];
  const reportSums: Record<string, number> = Object.fromEntries(REPORT_GROUPS.map((g) => [g, 0]));

  for (const r of rows) {
    const input: ClassifyInput = {
      amount: Math.round(r.amount * 100),
      mcc: r.mcc,
      description: r.details,
      accountKind: kindOf(r.card),
      pairedOwnTransfer: paired.has(r.id),
    };
    const out = classify(input, ctx);
    const weight = Math.abs(r.amount);
    const ok = isAllowed(r.group, r.category, out.type, r.amount);
    total += weight;
    const g = (byGroup[r.group] ??= { total: 0, matched: 0 });
    g.total += weight;
    if (ok) {
      matched += weight;
      g.matched += weight;
    } else {
      const text = maskText(r.details);
      const key = `${r.group}|${r.category}|${out.type}|${r.mcc}|${text}`;
      const d = classes.get(key) ?? {
        group: r.group,
        category: r.category,
        predicted: out.type,
        mcc: r.mcc,
        text,
        count: 0,
        amount: 0,
      };
      d.count++;
      d.amount += weight;
      classes.set(key, d);
    }
    summable.push({ type: out.type, amount: r.amount, fopWithdrawal: FOP_WITHDRAWAL.test(r.details) && r.amount > 0 });
    reportSums[r.group] = (reportSums[r.group] ?? 0) + r.amount;
  }
  const sums = sumByReportGroup(summable);
  return {
    total,
    matched,
    share: total === 0 ? 1 : matched / total,
    byGroup,
    disagreements: [...classes.values()].sort((a, b) => b.amount - a.amount),
    sums,
    reportSums,
  };
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export function main(path = DEFAULT_CSV): number {
  if (!existsSync(path)) {
    console.log(`golden-classify: ${path} not found, skipping`);
    return 0;
  }
  const rows = loadRows(path);
  const ctx = deriveContext(rows);
  const res = evaluate(rows, ctx);
  console.log(`rows: ${rows.length}, own names: ${ctx.ownNames.length}, own jars: ${ctx.ownJars.length}`);
  console.log(`match by amount: ${pct(res.share)} (threshold ${pct(THRESHOLD)})`);
  for (const [g, v] of Object.entries(res.byGroup)) {
    console.log(`  ${g}: ${pct(v.total ? v.matched / v.total : 1)} of ${fmt(v.total)}`);
  }
  console.log("group totals, app types summed with report definitions vs report:");
  for (const g of REPORT_GROUPS) {
    console.log(`  ${g}: app ${fmt(res.sums[g] ?? 0)} / report ${fmt(res.reportSums[g] ?? 0)}`);
  }
  console.log("largest disagreement classes (masked):");
  for (const d of res.disagreements.slice(0, 25)) {
    console.log(`  ${fmt(d.amount)} x${d.count} [${d.group} / ${d.category}] -> ${d.predicted} mcc=${d.mcc} "${d.text}"`);
  }
  return res.share >= THRESHOLD ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv[2]));
}
