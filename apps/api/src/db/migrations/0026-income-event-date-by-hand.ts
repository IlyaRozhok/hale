import type { MigrationInterface, QueryRunner } from "typeorm";

// Б28: an income is expected on its window's last day (domain/recurring-match.ts windowEndDate), not on the 25th.
// `date_set_by_hand` marks a date the owner chose («Когда ожидается следующий доход?»); editing the window moves
// every other event still expected and leaves that one.
// Existing rows: nothing recorded a hand-set date before, so a date other than the one the old code gave (day 25
// of the event's month, or the month's last day if shorter) is taken as set by hand and kept, flag true. Every
// event not received that still has the old date moves to its window's end day in its own month (clamped to the
// month's length), flag false. Received events keep their date. A date the owner set by hand to exactly the 25th
// cannot be told apart and moves too. Down drops the flag and leaves the moved dates as they are.
// Today's limit, already fixed, picks the new dates up at the next fresh fix: the owner's next change to the
// plan or a confirmed income, else the next Kyiv day.
const LAST_DAY = (period: string) =>
  `extract(day FROM (to_date(${period}, 'YYYY-MM') + interval '1 month - 1 day'))::int`;
const ON_DAY = (period: string, day: string) => `(to_date(${period}, 'YYYY-MM') + (LEAST(${day}, ${LAST_DAY(period)}) - 1))`;

export class IncomeEventDateByHand1795737600000 implements MigrationInterface {
  name = "IncomeEventDateByHand1795737600000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE income_events ADD COLUMN date_set_by_hand boolean NOT NULL DEFAULT false`);
    await q.query(`UPDATE income_events SET date_set_by_hand = true WHERE expected_on <> ${ON_DAY("period", "25")}`);
    await q.query(
      `UPDATE income_events e SET expected_on = ${ON_DAY("e.period", "x.window_end_day")}
         FROM expected_incomes x
        WHERE x.id = e.expected_income_id AND e.status <> 'received' AND NOT e.date_set_by_hand`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE income_events DROP COLUMN date_set_by_hand`);
  }
}
