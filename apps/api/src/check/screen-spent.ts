import { Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { spentByDaySql, spentSql } from "../domain/ledger";
import { addDays, type Minor } from "../domain/money";
import { SPEND_TAB, dayTotalsSql } from "../transactions/day-totals";

/** Every Kyiv day from `from` to `to`, both included. */
function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * What the screens show as spent per Kyiv day, read with the very queries the services run (task Б11, invariant 4):
 * the calendar (spentByDaySql), «потрачено» on «Сегодня» (spentSql, one day at a time) and the day totals of
 * «Траты» in «Операции» (dayTotalsSql with the tab's filter). A provider of its own so a test can stand in a screen
 * that disagrees.
 */
@Injectable()
export class ScreenSpent {
  async byDay(m: EntityManager, from: string, to: string): Promise<Map<string, Minor>[]> {
    const calendar: { date: string; spent: number }[] = await m.query(spentByDaySql("$1", "$2"), [from, to]);
    const today = new Map<string, Minor>();
    for (const d of days(from, to)) {
      const r: { s: number }[] = await m.query(spentSql("$1", "$2"), [d, d]);
      if (r[0]!.s !== 0) today.set(d, r[0]!.s);
    }
    const operations: { local_date: string; total: number }[] = await m.query(dayTotalsSql([SPEND_TAB.filter], SPEND_TAB.counted, "$1"), [days(from, to)]);
    return [
      new Map(calendar.map((r) => [r.date, r.spent])),
      today,
      // The list's totals are signed like amount_uah; spent is the other way round.
      new Map(operations.map((r) => [r.local_date, 0 - r.total])),
    ];
  }
}
