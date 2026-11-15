import { limitSql, spendGroupSql } from "../domain/ledger";

/** The row counts against the day limit: one definition, domain/ledger.ts, evaluated in the database. */
export const IN_LIMIT = `(${limitSql("t", "a")})`;

/** The «Траты» tab: which rows it lists and which of them add up (Б2: the limit's rows). */
export const SPEND_TAB = { filter: spendGroupSql("t"), counted: IN_LIMIT } as const;

/**
 * SQL for the totals of the `counted` rows per Kyiv day under `filters`, for the days in the date-array parameter
 * `dates` (e.g. "$3"): rows (local_date text, total float8, signed like amount_uah). A day with no counted row with
 * a known hryvnia amount has no total at all rather than a misleading zero. The «Операции» list and the ledger
 * check run exactly this query.
 */
export function dayTotalsSql(filters: readonly string[], counted: string, dates: string): string {
  return `SELECT t.local_date::text AS local_date, COALESCE(SUM(t.amount_uah) FILTER (WHERE ${counted}), 0)::float8 AS total
        FROM transactions t JOIN accounts a ON a.id = t.account_id
        WHERE ${[...filters, `t.local_date = ANY(${dates}::date[])`].join(" AND ")}
        GROUP BY t.local_date
       HAVING COUNT(t.amount_uah) FILTER (WHERE ${counted}) > 0`;
}
