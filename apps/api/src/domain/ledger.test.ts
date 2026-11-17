import { describe, expect, it } from "vitest";
import type { TxType } from "./classify";
import {
  type AccountKind,
  type LedgerContext,
  type LedgerRow,
  ACCOUNT_KINDS,
  CASH_START_SQL,
  LIMIT_EXCLUDED_ACCOUNT_KIND,
  LIMIT_TYPES,
  OWN_MONEY_ACCOUNT_KINDS,
  SPEND_GROUP_TYPES,
  cashOutCounts,
  countsAgainstLimit,
  inSpendGroup,
  ledgerEffect,
  limitSpent,
  limitSpentByDay,
  limitSql,
  spendGroupSql,
  walletChange,
} from "./ledger";

const CASH_START = "2026-11-10";
const WITH_WALLET: LedgerContext = { cashStart: CASH_START };
const NO_WALLET: LedgerContext = { cashStart: null };

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  type: "spend",
  accountKind: "black",
  amountUah: -42_000,
  localDate: "2026-11-12",
  category: "food",
  ...over,
});

const ALL_TYPES: readonly (TxType | null)[] = [
  "income", "spend", "obligation", "tax", "debt_payment", "loan_in", "own_transfer", "person_transfer",
  "person_in", "cash_in", "cash_out", "goal_contribution", "loan_out", null,
];

describe("ledgerEffect: what one operation does to the limit", () => {
  it("a purchase on a card spends its amount from the limit", () => {
    expect(ledgerEffect(row(), WITH_WALLET).limitSpend).toBe(42_000);
  });

  it("a refund on a card lowers what was spent", () => {
    expect(ledgerEffect(row({ amountUah: 15_000 }), WITH_WALLET).limitSpend).toBe(-15_000);
  });

  it("money to a person counts against the limit", () => {
    expect(ledgerEffect(row({ type: "person_transfer", amountUah: -50_000 }), WITH_WALLET).limitSpend).toBe(50_000);
  });

  it("a withdrawal counts before the cash wallet starts and not from its first day", () => {
    const out = (localDate: string) => ledgerEffect(row({ type: "cash_out", amountUah: -100_000, localDate }), WITH_WALLET).limitSpend;
    expect(out("2026-11-09")).toBe(100_000);
    expect(out(CASH_START)).toBe(0);
    expect(out("2026-11-11")).toBe(0);
  });

  it("a withdrawal always counts while there is no cash wallet", () => {
    expect(ledgerEffect(row({ type: "cash_out", amountUah: -100_000 }), NO_WALLET).limitSpend).toBe(100_000);
  });

  it("a purchase paid from the cash wallet counts", () => {
    expect(ledgerEffect(row({ accountKind: "cash", amountUah: -9_000 }), WITH_WALLET).limitSpend).toBe(9_000);
  });

  it("payments, taxes, debts, loans out, own transfers and income do not count", () => {
    for (const type of ["obligation", "tax", "debt_payment", "loan_out", "own_transfer", "goal_contribution", "loan_in", "income", "person_in", "cash_in"] as const) {
      expect(ledgerEffect(row({ type }), WITH_WALLET).limitSpend, type).toBe(0);
    }
  });

  it("a row with no type does not count", () => {
    expect(ledgerEffect(row({ type: null }), WITH_WALLET).limitSpend).toBe(0);
  });

  it("nothing on a jar counts", () => {
    expect(ledgerEffect(row({ accountKind: "jar" }), WITH_WALLET).limitSpend).toBe(0);
  });

  it("a row without a hryvnia amount (no rate) does not count", () => {
    expect(ledgerEffect(row({ amountUah: null }), WITH_WALLET).limitSpend).toBe(0);
  });

  it("an account outside own money (kind 'other') still counts today: only jars are excluded", () => {
    expect(ledgerEffect(row({ accountKind: "other" }), WITH_WALLET).limitSpend).toBe(42_000);
  });
});

describe("ledgerEffect: the «Траты» list group today", () => {
  it("shows payments, taxes, debts and loans out, which the limit does not count", () => {
    for (const type of ["obligation", "tax", "debt_payment", "loan_out"] as const) {
      const e = ledgerEffect(row({ type }), WITH_WALLET);
      expect(e.inSpendGroup, type).toBe(true);
      expect(e.limitSpend, type).toBe(0);
    }
  });

  it("hides a withdrawal from the cash wallet's first day, as the limit does", () => {
    expect(ledgerEffect(row({ type: "cash_out", localDate: "2026-11-09" }), WITH_WALLET).inSpendGroup).toBe(true);
    expect(ledgerEffect(row({ type: "cash_out", localDate: CASH_START }), WITH_WALLET).inSpendGroup).toBe(false);
  });

  it("shows jar rows and rows without a hryvnia amount, which the limit does not count", () => {
    expect(ledgerEffect(row({ accountKind: "jar" }), WITH_WALLET).inSpendGroup).toBe(true);
    expect(ledgerEffect(row({ amountUah: null }), WITH_WALLET).inSpendGroup).toBe(true);
  });

  it("leaves out own transfers, goals, loans in, income and untyped rows", () => {
    for (const type of ["own_transfer", "goal_contribution", "loan_in", "income", "person_in", "cash_in", null] as const) {
      expect(ledgerEffect(row({ type }), WITH_WALLET).inSpendGroup, String(type)).toBe(false);
    }
  });

  // The audit (6.5, step 1) wants the tab to show what the limit counts. Until that is decided and built
  // (Б1 PR 3 or Б2), this pins the difference so that it changes on purpose, not by accident.
  it("pins today's difference between the limit and the «Траты» group", () => {
    const groupOnly = SPEND_GROUP_TYPES.filter((t) => !(LIMIT_TYPES as readonly string[]).includes(t) && t !== "cash_out");
    expect([...groupOnly].sort()).toEqual(["debt_payment", "loan_out", "obligation", "tax"]);
  });
});

describe("ledgerEffect: own money", () => {
  it("a purchase on a card lowers own money by its amount", () => {
    expect(ledgerEffect(row(), WITH_WALLET).ownMoney).toBe(-42_000);
  });

  it("the fop account and the wallet are own money; jars and 'other' accounts are not", () => {
    expect(ledgerEffect(row({ accountKind: "fop" }), WITH_WALLET).ownMoney).toBe(-42_000);
    expect(ledgerEffect(row({ accountKind: "cash" }), WITH_WALLET).ownMoney).toBe(-42_000);
    expect(ledgerEffect(row({ accountKind: "jar" }), WITH_WALLET).ownMoney).toBe(0);
    expect(ledgerEffect(row({ accountKind: "other" }), WITH_WALLET).ownMoney).toBe(0);
  });

  it("a withdrawal after the wallet start only moves money into the wallet", () => {
    expect(ledgerEffect(row({ type: "cash_out", amountUah: -100_000, localDate: CASH_START }), WITH_WALLET).ownMoney).toBe(0);
  });

  it("a withdrawal from a jar on or after the wallet start is not own money and does not reach the wallet", () => {
    for (const localDate of [CASH_START, "2026-11-11"]) {
      expect(ledgerEffect(row({ type: "cash_out", accountKind: "jar", amountUah: -100_000, localDate }), WITH_WALLET).ownMoney).toBe(0);
    }
  });

  describe("on the start day, by the start moment (Б39)", () => {
    // Started at 15:00 Kyiv (13:00Z); the opening balance already holds cash withdrawn earlier that day.
    const STARTED_AT: LedgerContext = { cashStart: CASH_START, cashStartedAt: Date.parse(`${CASH_START}T13:00:00Z`) };
    const withdrawal = (time: string) => row({ type: "cash_out", amountUah: -100_000, localDate: CASH_START, occurredAt: Date.parse(`${CASH_START}T${time}Z`) });

    it("a withdrawal before the moment leaves the card and does not reach the wallet: the opening balance holds it", () => {
      const e = ledgerEffect(withdrawal("08:00:00"), STARTED_AT);
      expect(walletChange(withdrawal("08:00:00"), STARTED_AT)).toBe(0);
      expect(e.ownMoney).toBe(-100_000);
      // Not spending either, as before: the start day stays day-based on the spending side.
      expect(e.limitSpend).toBe(0);
      expect(e.inSpendGroup).toBe(false);
    });

    it("a withdrawal at or after the moment goes into the wallet", () => {
      for (const time of ["13:00:00", "14:00:00"]) {
        expect(walletChange(withdrawal(time), STARTED_AT), time).toBe(100_000);
        expect(ledgerEffect(withdrawal(time), STARTED_AT).ownMoney, time).toBe(0);
      }
    });

    it("without a moment the whole start day counts, as before", () => {
      expect(walletChange(withdrawal("08:00:00"), WITH_WALLET)).toBe(100_000);
      expect(walletChange(withdrawal("08:00:00"), { cashStart: CASH_START, cashStartedAt: null })).toBe(100_000);
    });

    it("the next day counts whatever the time", () => {
      const next = row({ type: "cash_out", amountUah: -100_000, localDate: "2026-11-11", occurredAt: Date.parse("2026-11-10T22:30:00Z") });
      expect(walletChange(next, STARTED_AT)).toBe(100_000);
    });

    it("rows on the wallet and deposits from it do not depend on the moment", () => {
      const early = Date.parse(`${CASH_START}T08:00:00Z`);
      expect(walletChange(row({ accountKind: "cash", amountUah: 50_000, localDate: CASH_START, occurredAt: early }), STARTED_AT)).toBe(50_000);
      expect(walletChange(row({ type: "cash_in", amountUah: 30_000, fromWallet: true, occurredAt: early }), STARTED_AT)).toBe(-30_000);
    });
  });

  it("a withdrawal before the wallet start leaves own money", () => {
    expect(ledgerEffect(row({ type: "cash_out", amountUah: -100_000, localDate: "2026-11-09" }), WITH_WALLET).ownMoney).toBe(-100_000);
    expect(ledgerEffect(row({ type: "cash_out", amountUah: -100_000 }), NO_WALLET).ownMoney).toBe(-100_000);
  });

  it("a deposit the owner said came from the wallet changes nothing in total", () => {
    const deposit = row({ type: "own_transfer", amountUah: 30_000, fromWallet: true, category: "own" });
    expect(ledgerEffect(deposit, WITH_WALLET).ownMoney).toBe(0);
  });

  it("cash taken from a transfer to the owner's card at another bank goes into the wallet", () => {
    const toOtherBank = row({ type: "own_transfer", amountUah: -200_000, walletCash: 150_000, category: "own" });
    expect(ledgerEffect(toOtherBank, WITH_WALLET).ownMoney).toBe(-50_000);
  });

  it("wallet rows mean nothing while there is no wallet", () => {
    expect(ledgerEffect(row({ accountKind: "cash" }), NO_WALLET).ownMoney).toBe(0);
  });

  it("a transfer to a jar leaves own money", () => {
    expect(ledgerEffect(row({ type: "goal_contribution", amountUah: -10_000 }), WITH_WALLET).ownMoney).toBe(-10_000);
  });

  it("is unknown without a hryvnia amount", () => {
    expect(ledgerEffect(row({ amountUah: null }), WITH_WALLET).ownMoney).toBeNull();
  });
});

describe("ledgerEffect: category and links", () => {
  it("keeps the stored category as it is", () => {
    expect(ledgerEffect(row({ category: "cafe" }), WITH_WALLET).category).toBe("cafe");
    expect(ledgerEffect(row({ category: null }), WITH_WALLET).category).toBeNull();
  });

  it("has no links when none are given", () => {
    expect(ledgerEffect(row(), WITH_WALLET).links).toEqual([]);
  });

  it("names every link in a fixed order", () => {
    const links = ledgerEffect(
      row({ type: "debt_payment", links: { pairId: 9, incomeEventId: 4, shortLoanRepayment: true, loanId: 3, paymentId: 7 } }),
      WITH_WALLET,
    ).links;
    expect(links).toEqual([
      { kind: "payment", id: 7 },
      { kind: "loan", id: 3 },
      { kind: "loan_repayment" },
      { kind: "income", id: 4 },
      { kind: "pair", id: 9 },
    ]);
  });

  it("a person transfer that settled a planned payment is stored as obligation and does not count", () => {
    // plan.service retypes it to 'obligation' when it settles a payment: the type decides, not the link.
    const e = ledgerEffect(row({ type: "obligation", links: { paymentId: 7 } }), WITH_WALLET);
    expect(e.limitSpend).toBe(0);
    expect(e.links).toEqual([{ kind: "payment", id: 7 }]);
  });
});

describe("rule data", () => {
  it("cashOutCounts follows the SQL: counts with no wallet or before its start", () => {
    expect(cashOutCounts("2026-11-09", CASH_START)).toBe(true);
    expect(cashOutCounts(CASH_START, CASH_START)).toBe(false);
    expect(cashOutCounts("2030-01-01", null)).toBe(true);
  });

  it("countsAgainstLimit and inSpendGroup agree with ledgerEffect", () => {
    const r = row({ type: "tax" });
    expect(countsAgainstLimit(r, WITH_WALLET)).toBe(false);
    expect(inSpendGroup(r, WITH_WALLET)).toBe(true);
  });
});

// today.service.ts counts the limit with limitSql and transactions.service.ts lists the «Траты» group with
// spendGroupSql; test/ledger.e2e.test.ts runs both in Postgres against ledgerEffect. Here only the shape.
describe("SQL built from the same data", () => {
  it("limitSql takes other table aliases", () => {
    expect(limitSql("x", "y")).toContain("y.kind <> 'jar' AND x.amount_uah IS NOT NULL");
    expect(limitSql("x", "y")).not.toMatch(/\bt\./);
  });

  it("limitSql leaves out rows without a hryvnia amount: a listing by it would show them otherwise", () => {
    // A SUM skips NULL by itself, so the e2e over sums cannot tell when this clause goes missing.
    expect(limitSql()).toContain("t.amount_uah IS NOT NULL");
  });

  it("spendGroupSql names every group type and the withdrawal rule, and takes another alias", () => {
    expect(spendGroupSql()).toContain(`NOT (t.type = 'cash_out' AND COALESCE(t.local_date >= ${CASH_START_SQL}, false))`);
    for (const t of SPEND_GROUP_TYPES) expect(spendGroupSql()).toContain(`'${t}'`);
    expect(spendGroupSql("x")).not.toMatch(/\bt\./);
    expect(spendGroupSql("x")).toContain("x.type IN (");
  });

  it("the constants are what the rule says", () => {
    expect(LIMIT_TYPES).toEqual(["spend", "person_transfer"]);
    expect(LIMIT_EXCLUDED_ACCOUNT_KIND).toBe("jar");
    expect(CASH_START_SQL).toBe("(SELECT cash_start FROM settings WHERE id=1)");
    expect([...OWN_MONEY_ACCOUNT_KINDS].sort()).toEqual(["black", "cash", "fop", "white"]);
  });
});

// --- properties ---------------------------------------------------------------------------------------

/** mulberry32: a small seeded generator, so a failure prints a seed that reproduces it. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const DATES = ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"];

function randomRow(r: () => number): LedgerRow {
  const amount = Math.round((r() - 0.8) * 1_000_000); // mostly money out, some refunds and income
  return {
    type: pick(r, ALL_TYPES),
    accountKind: pick(r, ACCOUNT_KINDS),
    amountUah: r() < 0.1 ? null : amount,
    localDate: pick(r, DATES),
    category: pick(r, ["food", "cafe", "own", "transfer", null]),
    fromWallet: r() < 0.05,
    walletCash: r() < 0.05 ? Math.round(r() * 100_000) : undefined,
  };
}

function randomCase(seed: number): { rows: LedgerRow[]; ctx: LedgerContext } {
  const r = rng(seed);
  const rows = Array.from({ length: Math.floor(r() * 40) }, () => randomRow(r));
  return { rows, ctx: { cashStart: r() < 0.3 ? null : pick(r, DATES) } };
}

function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const r = rng(seed);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The SQL predicate of today.service.ts written out literally, independent of ledger.ts. */
function sqlOracle(t: LedgerRow, cashStart: string | null): boolean {
  if (t.accountKind === "jar" || t.amountUah === null) return false;
  if (t.type === "spend" || t.type === "person_transfer") return true;
  // NOT COALESCE(local_date >= cash_start, false): NULL cash_start gives NOT false.
  return t.type === "cash_out" && !(cashStart === null ? false : t.localDate >= cashStart);
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

describe("properties (300 seeded cases each)", () => {
  it("the function counts exactly the rows the SQL predicate counts, by SUM(-amount_uah)", () => {
    for (const seed of SEEDS) {
      const { rows, ctx } = randomCase(seed);
      for (const t of rows) {
        const e = ledgerEffect(t, ctx);
        expect(e.limitSpend, `seed ${seed}`).toBe(sqlOracle(t, ctx.cashStart) ? 0 - t.amountUah! : 0);
      }
    }
  });

  it("jar rows and rows without a hryvnia amount never count", () => {
    for (const seed of SEEDS) {
      const { rows, ctx } = randomCase(seed);
      for (const t of rows.filter((x) => x.accountKind === "jar" || x.amountUah === null)) {
        expect(countsAgainstLimit(t, ctx), `seed ${seed}`).toBe(false);
        expect(ledgerEffect(t, ctx).limitSpend, `seed ${seed}`).toBe(0);
      }
    }
  });

  it("a day's spend is the sum over its rows, and the days add up to the total", () => {
    for (const seed of SEEDS) {
      const { rows, ctx } = randomCase(seed);
      const byDay = limitSpentByDay(rows, ctx);
      for (const [day, spent] of byDay) {
        const own = rows.filter((x) => x.localDate === day).reduce((s, x) => s + ledgerEffect(x, ctx).limitSpend, 0);
        expect(spent, `seed ${seed} ${day}`).toBe(own);
      }
      const total = [...byDay.values()].reduce((s, v) => s + v, 0);
      expect(limitSpent(rows, ctx), `seed ${seed}`).toBe(total);
    }
  });

  it("a day appears only when one of its rows counts, as with GROUP BY over the filtered rows", () => {
    for (const seed of SEEDS) {
      const { rows, ctx } = randomCase(seed);
      const days = new Set(rows.filter((x) => countsAgainstLimit(x, ctx)).map((x) => x.localDate));
      expect(new Set(limitSpentByDay(rows, ctx).keys()), `seed ${seed}`).toEqual(days);
    }
  });

  it("the result does not depend on row order", () => {
    for (const seed of SEEDS) {
      const { rows, ctx } = randomCase(seed);
      const shuffled = shuffle(rows, seed * 7919);
      expect(limitSpent(shuffled, ctx), `seed ${seed}`).toBe(limitSpent(rows, ctx));
      expect(limitSpentByDay(shuffled, ctx), `seed ${seed}`).toEqual(limitSpentByDay(rows, ctx));
    }
  });

  it("a refund lowers the day by exactly its amount", () => {
    for (const seed of SEEDS) {
      const { rows, ctx } = randomCase(seed);
      const r = rng(seed * 31);
      const day = pick(r, DATES);
      const amount = 1 + Math.floor(r() * 50_000);
      const before = limitSpentByDay(rows, ctx).get(day) ?? 0;
      const refund = row({ type: "spend", accountKind: pick(r, ["black", "white", "fop", "cash", "other"] as const), amountUah: amount, localDate: day });
      expect(limitSpentByDay([...rows, refund], ctx).get(day), `seed ${seed}`).toBe(before - amount);
    }
  });

  // Pins today's behaviour, not a decision: whether a refund may take a day below zero is an open question.
  it("a day with only a refund on it goes below zero", () => {
    const refund = row({ type: "spend", amountUah: 5_000, localDate: "2026-11-03" });
    expect(limitSpentByDay([refund], WITH_WALLET).get("2026-11-03")).toBe(-5_000);
    expect(limitSpent([refund], WITH_WALLET)).toBe(-5_000);
  });

  it("a row that does not count changes no day", () => {
    for (const seed of SEEDS) {
      const { rows, ctx } = randomCase(seed);
      const r = rng(seed * 17);
      const extra = { ...randomRow(r), accountKind: "jar" as AccountKind };
      expect(limitSpentByDay([...rows, extra], ctx), `seed ${seed}`).toEqual(limitSpentByDay(rows, ctx));
    }
  });

  it("whatever counts against the limit is shown in the «Траты» group", () => {
    for (const seed of SEEDS) {
      const { rows, ctx } = randomCase(seed);
      for (const t of rows.filter((x) => countsAgainstLimit(x, ctx))) {
        expect(inSpendGroup(t, ctx), `seed ${seed} ${t.type}`).toBe(true);
      }
    }
  });

  it("whole kopecks in, whole kopecks out", () => {
    for (const seed of SEEDS) {
      const { rows, ctx } = randomCase(seed);
      for (const t of rows) {
        const e = ledgerEffect(t, ctx);
        expect(Number.isInteger(e.limitSpend), `seed ${seed}`).toBe(true);
        if (e.ownMoney !== null) expect(Number.isInteger(e.ownMoney), `seed ${seed}`).toBe(true);
      }
    }
  });

  it("a transfer between two own accounts nets to zero own money", () => {
    const own = ["black", "white", "fop"] as const;
    for (const seed of SEEDS) {
      const r = rng(seed);
      const amount = 1 + Math.floor(r() * 1_000_000);
      const ctx = { cashStart: r() < 0.5 ? null : CASH_START };
      const out = row({ type: "own_transfer", accountKind: pick(r, own), amountUah: -amount, category: "own" });
      const into = row({ type: "own_transfer", accountKind: pick(r, own), amountUah: amount, category: "own" });
      expect(ledgerEffect(out, ctx).ownMoney! + ledgerEffect(into, ctx).ownMoney!, `seed ${seed}`).toBe(0);
    }
  });

  it("is a pure function: the same row gives the same answer and is not changed", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const { rows, ctx } = randomCase(seed);
      const copy = JSON.parse(JSON.stringify(rows)) as LedgerRow[];
      const first = rows.map((t) => ledgerEffect(t, ctx));
      expect(rows.map((t) => ledgerEffect(t, ctx)), `seed ${seed}`).toEqual(first);
      expect(JSON.parse(JSON.stringify(rows)), `seed ${seed}`).toEqual(copy);
    }
  });
});
