// What the Plan screen's lines say, from the same rows its windows list. No native imports: runs in node tests.
import type { ExpectedIncomeDto, IncomeAccount, IncomeEventDto, OwnMoneyItemDto, RecurringDto, ScheduledPaymentDto } from "@hale/contracts";
import { formatDollars, formatMoney } from "./format";
import { placeName } from "./ownMoney";

/** An amount in its own currency, whole units: the lines are a summary. */
export const moneyIn = (minor: number, currency: string): string => (currency === "USD" ? formatDollars(minor) : formatMoney(minor));

const unpaid = (payments: readonly ScheduledPaymentDto[], kind: ScheduledPaymentDto["kind"]) =>
  payments.filter((p) => p.kind === kind && p.paid_at === null).sort((a, b) => a.due_on.localeCompare(b.due_on));

export function nextEvent(events: readonly IncomeEventDto[], expectedId?: number): IncomeEventDto | undefined {
  return events
    .filter((e) => e.status !== "received" && (expectedId === undefined || e.expected_income_id === expectedId))
    .sort((a, b) => a.expected_on.localeCompare(b.expected_on))[0];
}

/** When an income comes (Д3б): its window or day, both days of a twice-monthly one, or no schedule. An older server: its window. */
export function incomeWhen(i: ExpectedIncomeDto): string {
  const end = i.window_end_day;
  if (i.schedule === "none") return "без расписания";
  if (i.schedule === "twice" && i.second_day != null) return `${end}-го и ${i.second_day}-го`;
  return i.window_start_day === end ? `${end}-го` : `${i.window_start_day}–${end} числа`;
}

/** A place money lies that an income can come to, with the account the server knows it by. */
export interface IncomePlace {
  account: IncomeAccount;
  name: string;
  /** A bank account reads «на счёт …», a balance kept by hand «на …», the wallet «наличными». */
  to: string;
}

/** The places «Сегодня» lists (own and set aside) that an income can be sent to: those with an id, and the wallet. */
export function incomePlaces(items: readonly OwnMoneyItemDto[]): IncomePlace[] {
  const out: IncomePlace[] = [];
  for (const item of items) {
    if (item.source === "cash") out.push({ account: { source: "cash" }, name: item.name, to: "наличными" });
    else if (item.id === undefined) continue;
    else if (item.source === "account") out.push({ account: { source: "account", id: item.id }, name: placeName(item), to: `на счёт ${placeName(item)}` });
    else if (item.source === "manual") out.push({ account: { source: "manual", id: item.id }, name: item.name, to: `на ${item.name}` });
  }
  return out;
}

export const sameAccount = (a: IncomeAccount | null | undefined, b: IncomeAccount | null | undefined): boolean =>
  !!a && !!b && a.source === b.source && (a.source === "cash" || a.id === (b as { id: number }).id);

/** An income's row: its amount, when it comes and, when known, where to. */
export function incomeDetail(i: ExpectedIncomeDto, items: readonly OwnMoneyItemDto[]): string {
  const place = incomePlaces(items).find((p) => sameAccount(p.account, i.account));
  return [moneyIn(i.amount, i.currency), incomeWhen(i), ...(place ? [place.to] : [])].join(" · ");
}

/** A server since Д3а names every income; an older one does not, and takes only the old fields. No incomes: a newer server is assumed. */
export const hasNamedIncomes = (incomes: readonly ExpectedIncomeDto[]): boolean => incomes.every((i) => i.name !== undefined);

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
 * Task Д4: «Налоги» is on «План» unless the server says the person has no taxes (no income pays the fop tax) and no
 * tax payment here is still unpaid. An older server does not say, and then it is shown, as before.
 */
export function taxesShown(taxes: boolean | undefined, payments: readonly ScheduledPaymentDto[] | undefined): boolean {
  return taxes !== false || (payments !== undefined && unpaid(payments, "tax").length > 0);
}

/** «Платежи» on «План»: the monthly obligations and the one-off ones still to pay, as its window lists them. */
export function paymentsCount(recurring: readonly RecurringDto[], payments: readonly ScheduledPaymentDto[]): number {
  const monthly = recurring.filter((r) => r.active && r.kind === "obligation").length;
  return monthly + payments.filter((p) => p.kind === "obligation" && p.recurring_id === null && p.paid_at === null).length;
}

/** «Налоги» on «План»: the tax payments still to pay. */
export const unpaidTaxCount = (payments: readonly ScheduledPaymentDto[]): number => unpaid(payments, "tax").length;

/** The expected income whose payment not yet received falls on `day` (the runway's income day), if one is known. */
export function incomeOnDay(expected: readonly ExpectedIncomeDto[], events: readonly IncomeEventDto[], day: string): ExpectedIncomeDto | undefined {
  for (const e of events) {
    if (e.status === "received" || e.expected_on !== day) continue;
    const income = expected.find((x) => x.id === e.expected_income_id);
    if (income) return income;
  }
  return undefined;
}
