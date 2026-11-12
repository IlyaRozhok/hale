// What the Plan screen's lines say, from the same rows its windows list. No native imports: runs in node tests.
import type { ExpectedIncomeDto, GoalDto, IncomeEventDto, ScheduledPaymentDto } from "@hale/contracts";
import { formatDollars, formatMoney, shortDate } from "./format";

/** An amount in its own currency, whole units: the lines are a summary. */
export const moneyIn = (minor: number, currency: string): string => (currency === "USD" ? formatDollars(minor) : formatMoney(minor));

const NONE = "нет";

const unpaid = (payments: readonly ScheduledPaymentDto[], kind: ScheduledPaymentDto["kind"]) =>
  payments.filter((p) => p.kind === kind && p.paid_at === null).sort((a, b) => a.due_on.localeCompare(b.due_on));

export function nextEvent(events: readonly IncomeEventDto[], expectedId?: number): IncomeEventDto | undefined {
  return events
    .filter((e) => e.status !== "received" && (expectedId === undefined || e.expected_income_id === expectedId))
    .sort((a, b) => a.expected_on.localeCompare(b.expected_on))[0];
}

export function incomesLine(expected: readonly ExpectedIncomeDto[], events: readonly IncomeEventDto[]): string {
  const event = nextEvent(events);
  const income = event && expected.find((x) => x.id === event.expected_income_id);
  if (!event || !income) return "не указаны";
  return `следующий ${shortDate(event.expected_on)}, ${moneyIn(income.amount, income.currency)}`;
}

export function paymentsLine(payments: readonly ScheduledPaymentDto[]): string {
  const first = unpaid(payments, "obligation")[0];
  return first ? `ближайший ${shortDate(first.due_on)}, ${moneyIn(first.amount, first.currency)}` : NONE;
}

export interface InstallmentGroup {
  name: string;
  amount: number;
  currency: string;
  left: number;
  nextDue: string;
  total: number;
}

/** Installments are stored payment by payment; to the owner each series is one thing, known by its name. */
export function installmentGroups(payments: readonly ScheduledPaymentDto[]): InstallmentGroup[] {
  const groups = new Map<string, InstallmentGroup>();
  for (const p of unpaid(payments, "installment")) {
    const g = groups.get(p.name);
    if (g) {
      g.left += 1;
      g.total += p.amount;
    } else {
      groups.set(p.name, { name: p.name, amount: p.amount, currency: p.currency, left: 1, nextDue: p.due_on, total: p.amount });
    }
  }
  return [...groups.values()];
}

/**
 * What is left of all series, in hryvnias. The rate comes with "Сегодня" and may not be here yet:
 * a dollar series then has no honest sum, so there is no line (undefined) rather than a wrong one.
 */
export function installmentsLine(payments: readonly ScheduledPaymentDto[], usdRate: number | undefined): string | undefined {
  const groups = installmentGroups(payments);
  if (groups.length === 0) return NONE;
  const rate = usdRate !== undefined && usdRate > 0 ? usdRate : undefined;
  if (rate === undefined && groups.some((g) => g.currency === "USD")) return undefined;
  return `осталось ${formatMoney(groups.reduce((s, g) => s + (g.currency === "USD" ? g.total * (rate ?? 0) : g.total), 0))}`;
}

export function taxLine(payments: readonly ScheduledPaymentDto[]): string {
  const rows = unpaid(payments, "tax");
  if (rows.length === 0) return NONE;
  return `${formatMoney(rows.reduce((s, p) => s + p.amount, 0))}, ближайший ${shortDate(rows[0]!.due_on)}`;
}

export function goalsLine(goals: readonly GoalDto[]): string {
  if (goals.length === 0) return NONE;
  const sum = (pick: (g: GoalDto) => number) => goals.reduce((s, g) => s + pick(g), 0);
  return `${formatDollars(sum((g) => g.saved_cents))} из ${formatDollars(sum((g) => g.target_cents))}`;
}
