import type { TxType } from "../apps/api/src/domain/classify";

/** Report groups (the owner's transactions.csv labels). */
export type ReportGroup = "Доход" | "Расходы" | "Долги" | "Займы" | "Переводы" | "Свои счета";

export const REPORT_GROUPS: readonly ReportGroup[] = ["Доход", "Расходы", "Долги", "Займы", "Переводы", "Свои счета"];

const FOP_TO_CARD_CATEGORY = "С ФОП-счёта";

const ALLOWED: Record<ReportGroup, readonly TxType[]> = {
  Доход: ["income", "cash_in", "person_in", "spend"],
  Расходы: ["spend", "tax", "cash_out", "obligation"],
  Долги: ["debt_payment"],
  Займы: ["loan_in"],
  Переводы: ["person_transfer", "obligation"],
  "Свои счета": ["own_transfer", "goal_contribution"],
};

/**
 * App types the report group accepts. Report definitions differ from the app's (design §9):
 * the report counts fop withdrawals as income, the app calls them own_transfer, so
 * own_transfer is accepted in the income group only for the "from fop" category.
 * A refund (spend) is accepted as income only when the amount is positive.
 */
export function isAllowed(group: string, category: string, type: TxType, amount: number): boolean {
  if (!(group in ALLOWED)) return false;
  const g = group as ReportGroup;
  if (g === "Доход") {
    if (type === "own_transfer") return category === FOP_TO_CARD_CATEGORY;
    if (type === "spend") return amount > 0;
  }
  return ALLOWED[g].includes(type);
}

/**
 * Report group an app-typed row is summed into, for comparing totals with the report.
 * `fopWithdrawal` marks an own_transfer that came from the fop account (report: income).
 */
export function reportGroupOf(type: TxType, amount: number, fopWithdrawal: boolean): ReportGroup {
  switch (type) {
    case "income":
    case "cash_in":
    case "person_in":
      return "Доход";
    case "own_transfer":
      return fopWithdrawal ? "Доход" : "Свои счета";
    case "spend":
      return amount > 0 ? "Доход" : "Расходы";
    case "tax":
    case "cash_out":
      return "Расходы";
    case "debt_payment":
      return "Долги";
    case "loan_in":
      return "Займы";
    case "person_transfer":
    case "loan_out":
    case "obligation":
      return "Переводы";
    case "goal_contribution":
      return "Свои счета";
  }
}

export interface SummableRow {
  type: TxType;
  /** Amount in hryvnias (or minor units, as long as the whole set agrees). */
  amount: number;
  fopWithdrawal: boolean;
}

/** Net sum per report group. */
export function sumByReportGroup(rows: readonly SummableRow[]): Record<ReportGroup, number> {
  const out = Object.fromEntries(REPORT_GROUPS.map((g) => [g, 0])) as Record<ReportGroup, number>;
  for (const r of rows) out[reportGroupOf(r.type, r.amount, r.fopWithdrawal)] += r.amount;
  return out;
}

/** The five totals the import check compares (absolute values; own accounts are not compared). */
export type ExpectedTotals = Record<Exclude<ReportGroup, "Свои счета">, number>;

export interface TotalsDiff {
  group: string;
  expected: number;
  actual: number;
  diff: number;
}

export function compareTotals(sums: Record<ReportGroup, number>, expected: ExpectedTotals): TotalsDiff[] {
  return (Object.keys(expected) as (keyof ExpectedTotals)[]).map((group) => {
    const actual = Math.abs(sums[group]);
    return { group, expected: expected[group], actual, diff: actual - expected[group] };
  });
}

/** Parses a CSV with quoted fields (RFC 4180 subset). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}
