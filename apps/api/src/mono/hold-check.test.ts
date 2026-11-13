import { describe, expect, it } from "vitest";
import { type AccountStatement, type HoldRow, checkHolds, kyivDayNumber } from "./hold-check";
import type { MonoStatementItem } from "./mono.schemas";

const DAY = 86_400;
/** Kyiv midnight, 1 October 2026: the period start. */
const FROM = Date.parse("2026-10-01T00:00:00+03:00") / 1000;
const at = (day: number, hour = 12) => FROM + day * DAY + hour * 3600;

const bank = (id: string, time: number, over: Partial<MonoStatementItem> = {}): MonoStatementItem => ({
  id,
  time,
  description: "Uklon",
  mcc: 4121,
  originalMcc: 4121,
  hold: true,
  amount: -15_000,
  operationAmount: -15_000,
  currencyCode: 980,
  commissionRate: 0,
  cashbackAmount: 0,
  balance: 1,
  ...over,
});

const hold = (id: string, time: number, over: Partial<HoldRow> = {}): HoldRow => ({
  id,
  account: "acc-1",
  time,
  amount: -15_000,
  mcc: 4121,
  description: "Uklon",
  ...over,
});

const statement = (rows: MonoStatementItem[], over: Partial<AccountStatement> = {}): AccountStatement => ({
  account: "acc-1",
  rows,
  unread: false,
  ...over,
});

function run(holds: HoldRow[], statements: AccountStatement[], holdIds: string[] = holds.map((h) => h.id)) {
  return checkHolds({ from: FROM, holds, holdIds, statements });
}

const sumOfSeven = (c: ReturnType<typeof run>) =>
  c.holdStillHold + c.holdSettled + c.holdUnchecked + c.holdSameAmountOtherId +
  c.holdCancelled + c.holdOtherAmountNearby + c.holdNothingSimilar;

describe("checkHolds: one counter per hold row, first match wins", () => {
  it("holdStillHold: the id is at the bank and still a hold", () => {
    const c = run([hold("h1", at(0))], [statement([bank("h1", at(0))])]);
    expect(c).toMatchObject({ holdRows: 1, holdStillHold: 1, holdSettled: 0, holdNothingSimilar: 0 });
  });

  it("holdSettled: the id is at the bank, no longer a hold, even with another amount and time", () => {
    const c = run([hold("h1", at(0))], [statement([bank("h1", at(2), { hold: false, amount: -15_300 })])]);
    expect(c).toMatchObject({ holdSettled: 1, holdStillHold: 0 });
  });

  it("holdUnchecked: the id is missing and the account's statement was not fully read", () => {
    const c = run([hold("h1", at(0))], [statement([], { unread: true })]);
    expect(c).toMatchObject({ holdUnchecked: 1, holdNothingSimilar: 0 });
  });

  it("holdUnchecked wins over every similarity counter when the statement is incomplete", () => {
    const rows = [
      bank("other", at(0), { hold: false }),
      bank("cancel", at(0, 13), { hold: false, amount: 15_000, description: "Скасування. Uklon" }),
    ];
    const c = run([hold("h1", at(0))], [statement(rows, { unread: true })]);
    expect(c).toMatchObject({ holdUnchecked: 1, holdSameAmountOtherId: 0, holdCancelled: 0, holdOtherAmountNearby: 0 });
  });

  it("holdUnchecked: a hold whose account was not fetched at all", () => {
    const c = run([hold("h1", at(0), { account: "acc-9" })], [statement([])]);
    expect(c).toMatchObject({ holdUnchecked: 1 });
  });

  it("holdSameAmountOtherId: same amount and MCC under another id nearby", () => {
    const c = run([hold("h1", at(0))], [statement([bank("x1", at(1), { hold: false })])]);
    expect(c).toMatchObject({ holdSameAmountOtherId: 1, holdNothingSimilar: 0 });
  });

  it("holdSameAmountOtherId needs the same MCC: a different MCC with the same amount is not it", () => {
    const c = run([hold("h1", at(0))], [statement([bank("x1", at(1), { hold: false, mcc: 5411, description: "Shop" })])]);
    expect(c.holdSameAmountOtherId).toBe(0);
  });

  it("holdCancelled: a plus row starting with «Скасування» on the same amount nearby, case-insensitive", () => {
    const rows = [bank("c1", at(0, 13), { hold: false, amount: 15_000, description: "СКАСУВАННЯ. Uklon" })];
    const c = run([hold("h1", at(0))], [statement(rows)]);
    expect(c).toMatchObject({ holdCancelled: 1, holdNothingSimilar: 0 });
  });

  it("holdCancelled needs the opposite sign and the exact amount", () => {
    const rows = [bank("c1", at(0, 13), { hold: false, amount: 15_100, description: "Скасування. Uklon" })];
    expect(run([hold("h1", at(0))], [statement(rows)]).holdCancelled).toBe(0);
  });

  it("holdOtherAmountNearby: a settled debit with another amount and the same MCC", () => {
    const rows = [bank("x1", at(1), { hold: false, amount: -15_800, description: "Something else" })];
    const c = run([hold("h1", at(0))], [statement(rows)]);
    expect(c).toMatchObject({ holdOtherAmountNearby: 1, holdNothingSimilar: 0 });
  });

  it("holdOtherAmountNearby: a settled debit with another amount and the same description, other MCC", () => {
    const rows = [bank("x1", at(1), { hold: false, amount: -15_800, mcc: 5999 })];
    expect(run([hold("h1", at(0))], [statement(rows)]).holdOtherAmountNearby).toBe(1);
  });

  it("holdOtherAmountNearby takes neither a hold row nor a plus row nor a row with another MCC and text", () => {
    const stillHold = [bank("x1", at(1), { hold: true, amount: -15_800 })];
    const plus = [bank("x2", at(1), { hold: false, amount: 15_800 })];
    const unrelated = [bank("x3", at(1), { hold: false, amount: -15_800, mcc: 5411, description: "Shop" })];
    for (const rows of [stillHold, plus, unrelated]) {
      const c = run([hold("h1", at(0))], [statement(rows)]);
      expect(c).toMatchObject({ holdOtherAmountNearby: 0, holdNothingSimilar: 1 });
    }
  });

  it("holdNothingSimilar: the id is missing and nothing nearby looks like it", () => {
    const c = run([hold("h1", at(0))], [statement([])]);
    expect(c).toMatchObject({ holdNothingSimilar: 1 });
  });

  it("a hold found by id is never counted as similar to something else", () => {
    const rows = [bank("h1", at(0)), bank("x1", at(0, 14), { hold: false })];
    const c = run([hold("h1", at(0))], [statement(rows)]);
    expect(c).toMatchObject({ holdStillHold: 1, holdSameAmountOtherId: 0 });
  });
});

describe("checkHolds: nearby is the Kyiv day before through three days after", () => {
  const settled = (day: number) => [bank("x1", at(day), { hold: false })];

  it("day −1 and day +3 are nearby", () => {
    expect(run([hold("h1", at(2))], [statement(settled(1))]).holdSameAmountOtherId).toBe(1);
    expect(run([hold("h1", at(2))], [statement(settled(5))]).holdSameAmountOtherId).toBe(1);
  });

  it("day −2 and day +4 are not", () => {
    expect(run([hold("h1", at(2))], [statement(settled(0))]).holdNothingSimilar).toBe(1);
    expect(run([hold("h1", at(2))], [statement(settled(6))]).holdNothingSimilar).toBe(1);
  });

  it("days are Kyiv days: 23:30 Kyiv the day before is day −1, not day 0", () => {
    // Hold at 00:30 Kyiv on day 2; a row at 23:30 Kyiv on day 0 is two Kyiv days away.
    const h = hold("h1", at(2, 0) + 1800);
    expect(run([h], [statement([bank("x1", at(0, 23) + 1800, { hold: false })])]).holdNothingSimilar).toBe(1);
    expect(run([h], [statement([bank("x1", at(1, 23) + 1800, { hold: false })])]).holdSameAmountOtherId).toBe(1);
  });

  it("a row on another account is never nearby", () => {
    const c = run([hold("h1", at(0))], [statement([]), statement(settled(0), { account: "acc-2" })]);
    expect(c.holdNothingSimilar).toBe(1);
  });
});

describe("checkHolds: one bank row matches at most one hold", () => {
  it("two missing holds and one similar row: the earlier hold takes it, the other has nothing", () => {
    const c = run([hold("h2", at(0, 15)), hold("h1", at(0, 10))], [statement([bank("x1", at(0, 11), { hold: false })])]);
    expect(c).toMatchObject({ holdSameAmountOtherId: 1, holdNothingSimilar: 1, holdRows: 2 });
  });

  it("two identical Uklon holds, A missing and B still at the bank: B keeps its own row, A never takes it", () => {
    const a = hold("A", at(0, 10));
    const b = hold("B", at(0, 11));
    const stillHold = run([a, b], [statement([bank("B", at(0, 11))])]);
    expect(stillHold).toMatchObject({ holdStillHold: 1, holdNothingSimilar: 1, holdSameAmountOtherId: 0 });
    const settled = run([a, b], [statement([bank("B", at(0, 11), { hold: false })])]);
    expect(settled).toMatchObject({ holdSettled: 1, holdNothingSimilar: 1, holdSameAmountOtherId: 0 });
  });

  it("a bank row whose id is a hold row before the period is not a similarity candidate either", () => {
    const rows = [bank("old", at(-1, 23) + 1800, { hold: false })];
    const c = run([hold("h1", at(0, 1))], [statement(rows)], ["h1", "old"]);
    expect(c).toMatchObject({ holdNothingSimilar: 1, holdSameAmountOtherId: 0 });
  });
});

describe("checkHolds: the first day of the period", () => {
  it("a first-day hold whose bank row moved to the day before is still found by id", () => {
    const c = run([hold("h1", at(0, 1))], [statement([bank("h1", at(-1, 23), { hold: false })])]);
    expect(c).toMatchObject({ holdSettled: 1, holdNothingSimilar: 0 });
  });
});

describe("checkHolds: cancellations over all accounts", () => {
  const cancel = (id: string, time: number, over: Partial<MonoStatementItem> = {}) =>
    bank(id, time, { hold: false, amount: 15_000, description: "Скасування. Uklon", ...over });

  it("counts a cancellation with its original, and whether the original is still a hold", () => {
    const rows = [bank("o1", at(3, 10)), cancel("c1", at(3, 10) + 60)];
    const c = run([], [statement(rows)]);
    expect(c).toMatchObject({ cancelRows: 1, cancelWithOriginal: 1, cancelOriginalStillHold: 1 });
    const settled = run([], [statement([bank("o1", at(3, 10), { hold: false }), cancel("c1", at(3, 10) + 60)])]);
    expect(settled).toMatchObject({ cancelRows: 1, cancelWithOriginal: 1, cancelOriginalStillHold: 0 });
  });

  it("a cancellation without an original: wrong MCC, wrong amount or another account", () => {
    const wrongMcc = [bank("o1", at(3), { mcc: 5411 }), cancel("c1", at(3, 13))];
    const wrongAmount = [bank("o1", at(3), { amount: -15_100 }), cancel("c1", at(3, 13))];
    const c1 = run([], [statement(wrongMcc)]);
    const c2 = run([], [statement(wrongAmount)]);
    const c3 = run([], [statement([bank("o1", at(3))]), statement([cancel("c1", at(3, 13))], { account: "acc-2" })]);
    for (const c of [c1, c2, c3]) expect(c).toMatchObject({ cancelRows: 1, cancelWithOriginal: 0, cancelOriginalStillHold: 0 });
  });

  it("the original may be the same Kyiv day or up to 30 days earlier, not 31, and may sit in the day before the period", () => {
    expect(run([], [statement([bank("o1", at(0)), cancel("c1", at(30, 13))])]).cancelWithOriginal).toBe(1);
    expect(run([], [statement([bank("o1", at(0)), cancel("c1", at(31, 13))])]).cancelWithOriginal).toBe(0);
    expect(run([], [statement([bank("o1", at(-1)), cancel("c1", at(0, 13))])]).cancelWithOriginal).toBe(1);
    expect(run([], [statement([bank("o1", at(4)), cancel("c1", at(3, 13))])]).cancelWithOriginal).toBe(0);
  });

  it("cancellations are counted from the period start, not from the day before", () => {
    const c = run([], [statement([bank("o1", at(-1, 9)), cancel("c1", at(-1, 10))])]);
    expect(c).toMatchObject({ cancelRows: 0, cancelWithOriginal: 0 });
  });

  it("one original serves at most one cancellation, the nearest first", () => {
    const rows = [bank("o1", at(3, 10)), cancel("c1", at(3, 10) + 60), cancel("c2", at(3, 12))];
    expect(run([], [statement(rows)])).toMatchObject({ cancelRows: 2, cancelWithOriginal: 1 });
  });

  it("only plus rows count: a minus row starting with «Скасування» is not a cancellation", () => {
    const c = run([], [statement([cancel("c1", at(3), { amount: -15_000 })])]);
    expect(c.cancelRows).toBe(0);
  });

  it("does not depend on the hold flag of anything in the database", () => {
    const c = run([hold("h1", at(0))], [statement([bank("h1", at(0)), cancel("c1", at(0, 13))])]);
    expect(c).toMatchObject({ holdStillHold: 1, cancelRows: 1, cancelWithOriginal: 1, cancelOriginalStillHold: 1 });
  });
});

describe("checkHolds: totals", () => {
  it("apiRows is the number of bank rows over all accounts", () => {
    const c = run([], [statement([bank("a", at(0)), bank("b", at(1))]), statement([bank("c", at(0))], { account: "acc-2" })]);
    expect(c.apiRows).toBe(3);
  });

  it("holdRows equals the sum of the seven hold counters", () => {
    const holds = [
      hold("still", at(0)),
      hold("settled", at(0, 13)),
      hold("unchecked", at(0), { account: "acc-2" }),
      hold("same", at(2)),
      hold("cancelled", at(4)),
      hold("other", at(6)),
      hold("nothing", at(8)),
    ];
    const rows = [
      bank("still", at(0)),
      bank("settled", at(0, 13), { hold: false }),
      bank("x-same", at(2, 13), { hold: false }),
      bank("x-cancel", at(4, 13), { hold: false, amount: 15_000, description: "Скасування. Uklon" }),
      bank("x-other", at(6, 13), { hold: false, amount: -16_000 }),
    ];
    const c = run(holds, [statement(rows), statement([], { account: "acc-2", unread: true })]);
    expect(c).toMatchObject({
      holdRows: 7, holdStillHold: 1, holdSettled: 1, holdUnchecked: 1, holdSameAmountOtherId: 1,
      holdCancelled: 1, holdOtherAmountNearby: 1, holdNothingSimilar: 1,
    });
    expect(sumOfSeven(c)).toBe(c.holdRows);
  });

  it("the result carries only numbers", () => {
    const c = run([hold("h1", at(0))], [statement([bank("h1", at(0))])]);
    for (const v of Object.values(c)) expect(typeof v).toBe("number");
  });
});

describe("kyivDayNumber", () => {
  it("changes at Kyiv midnight, not UTC midnight", () => {
    const midnight = Date.parse("2026-10-01T00:00:00+03:00") / 1000;
    expect(kyivDayNumber(midnight) - kyivDayNumber(midnight - 1)).toBe(1);
    expect(kyivDayNumber(midnight + DAY - 1)).toBe(kyivDayNumber(midnight));
  });
});
