import { describe, expect, it } from "vitest";
import type { RunwayDto, TodayDto } from "@hale/contracts";
import { paymentsSection } from "./paymentsSection";

const TODAY = "2026-11-24";
type Event = RunwayDto["events"][number];
type Upcoming = TodayDto["upcoming"][number];

const event = (id: string, date: string, amount: number, name = `Платёж ${id}`): Event => ({ id, date, name, amount });
const due = (id: string, dueOn: string): Upcoming => ({ id, name: `Платёж ${id}`, amount: 100_000, dueOn, kind: "obligation", currency: "UAH" });
const run = (events: Event[], over: Partial<RunwayDto> = {}): RunwayDto => ({
  endOn: "2026-12-03",
  incomeOn: "2026-12-03",
  reserve: 520_000,
  zeroOn: null,
  points: [],
  events,
  ...over,
});

describe("paymentsSection", () => {
  it("is nothing without a runway (an older server), without an income date and without payments", () => {
    expect(paymentsSection(null, [due("1", "2026-11-25")], TODAY)).toBeNull();
    expect(paymentsSection(undefined, [], TODAY)).toBeNull();
    expect(paymentsSection(run([event("1", "2026-11-25", 1_700_000)], { incomeOn: null }), [due("1", "2026-11-25")], TODAY)).toBeNull();
    expect(paymentsSection(run([]), [due("1", "2026-11-25")], TODAY)).toBeNull();
  });

  it("one payment: the header counts it, the row carries its name, amount, day and words", () => {
    const s = paymentsSection(run([event("1", "2026-11-25", 1_700_000, "Квартплата")]), [due("1", "2026-11-25")], TODAY)!;
    expect(s.caption).toBe("1 до дохода · ₴17,000");
    expect(s.rows).toEqual([{ id: "1", name: "Квартплата", amount: 1_700_000, dueOn: "2026-11-25", due: "завтра", soon: true, payable: true }]);
    expect(s.more).toBeNull();
  });

  it("three payments: all three are rows, by due date, and nothing is left for «Ещё»", () => {
    const events = [event("3", "2026-12-02", 445_000), event("1", "2026-11-25", 1_700_000), event("2", "2026-11-28", 35_000)];
    const s = paymentsSection(run(events), events.map((e) => due(e.id, e.date)), TODAY)!;
    expect(s.caption).toBe("3 до дохода · ₴21,800");
    expect(s.rows.map((r) => [r.id, r.due, r.soon])).toEqual([
      ["1", "завтра", true],
      ["2", "через 4 дня", false],
      ["3", "через 8 дней", false],
    ]);
    expect(s.more).toBeNull();
  });

  it("more than three: the header counts and sums them all, three are rows, «Ещё» carries the rest", () => {
    const events = [
      event("5", "2026-12-02", 100_000),
      event("1", "2026-11-24", 1_700_000),
      event("4", "2026-12-01", 250_000),
      event("2", "2026-11-26", 35_000),
      event("3", "2026-11-28", 445_000),
    ];
    const s = paymentsSection(run(events), events.map((e) => due(e.id, e.date)), TODAY)!;
    expect(s.caption).toBe("5 до дохода · ₴25,300");
    expect(s.rows.map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(s.rows[0]).toMatchObject({ due: "сегодня", soon: true });
    expect(s.more).toEqual({ text: "Ещё 2 · ₴3,500" });
  });

  it("four payments leave one for «Ещё»", () => {
    const events = [event("1", "2026-11-25", 100_000), event("2", "2026-11-26", 100_000), event("3", "2026-11-27", 100_000), event("4", "2026-11-28", 120_000)];
    expect(paymentsSection(run(events), [], TODAY)!.more).toEqual({ text: "Ещё 1 · ₴1,200" });
  });

  it("an overdue payment stands on today in the runway: its real day comes from `upcoming`, and it goes first", () => {
    // The server puts an overdue payment on today's point of the chart; `upcoming` keeps the day it was due.
    const events = [event("1", TODAY, 35_000, "Интернет"), event("7", TODAY, 1_700_000, "Квартплата"), event("8", TODAY, 50_000, "Телефон")];
    const upcoming = [due("1", TODAY), due("7", "2026-11-06"), due("8", "2026-10-30")];
    const s = paymentsSection(run(events), upcoming, TODAY)!;
    expect(s.rows.map((r) => [r.id, r.dueOn, r.due, r.soon])).toEqual([
      ["8", "2026-10-30", "ждёт с 30 окт", true],
      ["7", "2026-11-06", "ждёт с 6 ноя", true],
      ["1", TODAY, "сегодня", true],
    ]);
  });

  it("payments due the same day keep the server's order", () => {
    const events = [event("b", "2026-11-26", 1), event("a", "2026-11-26", 2), event("c", "2026-11-25", 3)];
    expect(paymentsSection(run(events), [], TODAY)!.rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("a payment `upcoming` does not list keeps the event's day and cannot be marked paid from here", () => {
    const s = paymentsSection(run([event("9", "2026-11-28", 35_000)]), [due("1", "2026-11-25")], TODAY)!;
    expect(s.rows[0]).toMatchObject({ id: "9", dueOn: "2026-11-28", due: "через 4 дня", payable: false });
  });

  it("taxes are not here: only what the runway lists is counted, whatever `upcoming` holds", () => {
    const upcoming = [due("1", "2026-11-25"), { ...due("tax:1", "2026-11-26"), kind: "tax", amount: 900_000 }];
    const s = paymentsSection(run([event("1", "2026-11-25", 1_700_000)]), upcoming, TODAY)!;
    expect(s.caption).toBe("1 до дохода · ₴17,000");
    expect(s.rows.map((r) => r.id)).toEqual(["1"]);
  });
});
