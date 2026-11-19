// «Нужное и желаемое» (task В6): every spending category stands on one side, «нужное» (want false) or «желаемое»
// (want true), and one purchase can be moved to the other side by the owner. «Итоги» name how much of `spent` went on
// «желаемое». Nothing about money changes: the side only splits what the limit already counts.
// «Возвраты» and «Без категории» are system categories with no side (want null), so their rows count on neither side;
// so do rows whose category is not a spending one (transfers, cash, …: no categories row) and rows that are no
// purchase. A refund filed in a category with a side lowers that side, as it lowers the category's sum.
import { limitSql } from "./ledger";
import type { Minor } from "./money";

/** The defaults migration 0037 gives the seeded categories. A category the owner adds later is «нужное» unless chosen. */
export const DEFAULT_WANT: Readonly<Record<string, boolean>> = {
  groceries: false,
  cafe: true,
  transport: false,
  subscriptions: true,
  leisure: true,
  health: false,
  utilities: false,
  telecom: false,
  shopping: true,
};

/** Only a purchase has a side. */
const PURCHASE = "spend";

/**
 * The side of one row: its own choice (`override`) when the owner made one, else its category's. Null — neither
 * side — for a row that is no purchase or whose category has no side (a system one, or none in the list); an own
 * choice left on such a row (made before its type or category changed) does not count.
 */
export function effectiveWant(type: string | null, categoryWant: boolean | null, override: boolean | null): boolean | null {
  if (type !== PURCHASE || categoryWant === null) return null;
  return override ?? categoryWant;
}

/** Whether the owner can choose a side for this one row: a purchase in a category with a side. */
export const canOverrideWant = (type: string | null, categoryWant: boolean | null): boolean => type === PURCHASE && categoryWant !== null;

/** SQL over `t` (transactions): the side of the row's category, null when it has none (or is not a live one). */
export const categoryWantSql = (t = "t"): string =>
  `(SELECT wc.want FROM categories wc WHERE wc.key = ${t}.category AND wc.deleted_at IS NULL)`;

/** SQL condition over `t`: effectiveWant of the row is true. */
export const wantSql = (t = "t"): string =>
  `(${t}.type = '${PURCHASE}' AND EXISTS (SELECT 1 FROM categories wc WHERE wc.key = ${t}.category AND wc.deleted_at IS NULL
     AND wc.want IS NOT NULL AND COALESCE(${t}.want_override, wc.want)))`;

/**
 * SQL condition over `t` and its account `a`: the row is a part of «желаемое» — it counts against the limit (the one
 * definition, limitSql) and its side is «желаемое». «Итоги» sum these rows; «Операции» with want=true list them.
 */
export const wantedSql = (t = "t", a = "a"): string => `((${limitSql(t, a)}) AND ${wantSql(t)})`;

/** What «желаемое» took over one of the two stretches of «Итоги», summed in the database (signed like `spent`). */
export interface WantedRow {
  period: "current" | "previous";
  spent: Minor;
}

/** Each stretch's sum; never below zero, so a refund larger than the purchases cannot make the line negative. */
export function buildWanted(rows: readonly WantedRow[]): { wanted: Minor; previousWanted: Minor } {
  const sum = (period: WantedRow["period"]) => Math.max(0, rows.filter((r) => r.period === period).reduce((s, r) => s + r.spent, 0));
  return { wanted: sum("current"), previousWanted: sum("previous") };
}
