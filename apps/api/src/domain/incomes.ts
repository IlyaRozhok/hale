import type { ExpectedIncomeDto, ExpectedIncomeInput, ExpectedIncomePatch, IncomeAccount, IncomeSchedule } from "@hale/contracts";
import type { Minor } from "./money";

/**
 * An income as it is stored (task Д3а): a name, an amount, a schedule, the account it comes to and two flags. What used
 * to be its kind is now the flags: `pays_fop_tax` (the fop tax, and the income received by money on the fop account)
 * and `crypto` (Binance: «Пришло на Binance?» and «Это вывод с Binance?»). `source` is kept only for an older app and
 * always follows the flags.
 */
export interface IncomeRow {
  source: "fop" | "usdc" | null;
  name: string;
  amount: Minor;
  currency: string;
  window_start_day: number;
  window_end_day: number;
  schedule: IncomeSchedule;
  second_day: number | null;
  pays_fop_tax: boolean;
  crypto: boolean;
  account_id: number | null;
  manual_balance_id: number | null;
  to_cash: boolean;
}

/** The names the two old kinds get (the migration gives the owner's incomes the same ones). */
export const INCOME_NAMES = { fop: "ФОП", usdc: "USDC" } as const;

/** Without a schedule the income may come any day: its window is the whole month. */
const ANY_DAY = { window_start_day: 1, window_end_day: 31 };

/** The old kind an older app shows: the fop tax first, as it was the main income. */
export function sourceOf(f: { pays_fop_tax: boolean; crypto: boolean }): "fop" | "usdc" | null {
  return f.pays_fop_tax ? "fop" : f.crypto ? "usdc" : null;
}

function accountColumns(a: IncomeAccount | null): Pick<IncomeRow, "account_id" | "manual_balance_id" | "to_cash"> {
  return {
    account_id: a?.source === "account" ? a.id : null,
    manual_balance_id: a?.source === "manual" ? a.id : null,
    to_cash: a?.source === "cash",
  };
}

function withSource(row: Omit<IncomeRow, "source">): IncomeRow {
  return { ...row, source: sourceOf(row) } as IncomeRow;
}

/** A new income. An older app sends only the old kind: the name and the flag follow from it. */
export function newIncome(i: ExpectedIncomeInput): IncomeRow {
  const schedule = i.schedule ?? "monthly";
  return withSource({
    name: i.name ?? INCOME_NAMES[i.source!],
    amount: i.amount,
    currency: i.currency,
    window_start_day: i.window_start_day ?? ANY_DAY.window_start_day,
    window_end_day: i.window_end_day ?? ANY_DAY.window_end_day,
    schedule,
    second_day: i.second_day ?? null,
    pays_fop_tax: i.pays_fop_tax ?? i.source === "fop",
    crypto: i.crypto ?? i.source === "usdc",
    ...accountColumns(i.account ?? null),
  });
}

/** The income after a change: what the patch names changes, the rest stays. Leaving «Два раза в месяц» drops the second day. */
export function changedIncome(cur: IncomeRow, p: ExpectedIncomePatch): IncomeRow {
  const schedule = p.schedule ?? cur.schedule;
  return withSource({
    ...cur,
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.amount !== undefined ? { amount: p.amount } : {}),
    ...(p.currency !== undefined ? { currency: p.currency } : {}),
    ...(p.window_start_day !== undefined ? { window_start_day: p.window_start_day } : {}),
    ...(p.window_end_day !== undefined ? { window_end_day: p.window_end_day } : {}),
    schedule,
    second_day: p.second_day !== undefined ? p.second_day : schedule === "twice" ? cur.second_day : null,
    pays_fop_tax: p.pays_fop_tax ?? (p.source !== undefined ? p.source === "fop" : cur.pays_fop_tax),
    crypto: p.crypto ?? (p.source !== undefined ? p.source === "usdc" : cur.crypto),
    ...(p.account !== undefined ? accountColumns(p.account) : {}),
  });
}

/** What makes the whole income wrong, or null. The API refuses such an income, new or changed. */
export function incomeProblem(r: IncomeRow): string | null {
  if (r.window_start_day > r.window_end_day) return "window start is after its end";
  if (r.schedule !== "twice") return r.second_day === null ? null : "only a twice-monthly income has a second day";
  if (r.second_day === null) return "a twice-monthly income needs its second day";
  if (r.second_day <= r.window_end_day) return "the second payment comes after the first";
  // The fop income is received by the month's money on the fop account (domain/fop-income): one event a month.
  if (r.pays_fop_tax) return "an income that pays the fop tax comes once a month or without a schedule";
  return null;
}

/** How many payments of its amount an income brings a month: none without a schedule, as nothing is expected. */
export function paymentsPerMonth(schedule: IncomeSchedule): number {
  return schedule === "twice" ? 2 : schedule === "monthly" ? 1 : 0;
}

/** The answer: the fields an older app reads, then the new ones, with the account named as `GET /today` names it. */
export function incomeDto(r: IncomeRow & { id: number }): ExpectedIncomeDto {
  const account: IncomeAccount | null =
    r.account_id !== null
      ? { source: "account", id: r.account_id }
      : r.manual_balance_id !== null
        ? { source: "manual", id: r.manual_balance_id }
        : r.to_cash
          ? { source: "cash" }
          : null;
  return {
    id: r.id,
    source: r.source,
    amount: r.amount,
    currency: r.currency,
    window_start_day: r.window_start_day,
    window_end_day: r.window_end_day,
    name: r.name,
    schedule: r.schedule,
    second_day: r.second_day,
    pays_fop_tax: r.pays_fop_tax,
    crypto: r.crypto,
    account,
  };
}
