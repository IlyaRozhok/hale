// «Итоги» (task В1): a month's spending by category against the same days of the month before.
// Pure: the stretches of dates and the answer built from rows the service has already summed in the database.
// What counts as spending is not decided here: the rows come from the limit's one definition (domain/ledger.ts),
// so the categories of a stretch add up to exactly what «Сегодня» calls spent over the same days.
import { BUSINESS_SENDER, STORE_INSTALLMENT } from "./classify";
import { TRANSFER_MCCS } from "./merchants";
import type { Minor } from "./money";

/** A month ('YYYY-MM') counted from its 1st to `to`, and the stretch of the month before it is compared with. */
export interface InsightsWindow {
  month: string;
  from: string;
  /** Today for the current month, the last day for a past one. */
  to: string;
  previousFrom: string;
  /** The same day number in the month before, or its last day when that month is shorter. */
  previousTo: string;
}

/** What the limit took in one category over one of the two stretches. */
export interface InsightsRow {
  /** Null is filed under 'uncategorized'; the «Траты» filter by that category finds these rows too (В8). */
  category: string | null;
  period: "current" | "previous";
  /** Kopecks, signed like limitSpend: refunds are negative. */
  spent: Minor;
  count: number;
}

export interface InsightsCategory {
  category: string;
  spent: Minor;
  previousSpent: Minor;
  /** Operations in the month's stretch. */
  count: number;
}

export interface Insights {
  month: string;
  through: string;
  previous: { from: string; to: string };
  spent: Minor;
  previousSpent: Minor;
  categories: InsightsCategory[];
}

/** The category key «Без категории»: rows with an empty category go under it, here and in the list filter. */
export const UNCATEGORIZED = "uncategorized";

const pad = (n: number): string => String(n).padStart(2, "0");

function daysIn(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

/** The stretches for `month` as of the Kyiv day `today`; null for a month that has not started. */
export function insightsWindow(month: string, today: string): InsightsWindow | null {
  const current = today.slice(0, 7);
  if (month > current) return null;
  const lastDay = month === current ? Number(today.slice(8, 10)) : daysIn(month);
  const prev = previousMonth(month);
  return {
    month,
    from: `${month}-01`,
    to: `${month}-${pad(lastDay)}`,
    previousFrom: `${prev}-01`,
    previousTo: `${prev}-${pad(Math.min(lastDay, daysIn(prev)))}`,
  };
}

/** The answer: totals are the sums of the categories, categories go by the month's sum, largest first. */
export function buildInsights(w: InsightsWindow, rows: readonly InsightsRow[]): Insights {
  const byCategory = new Map<string, InsightsCategory>();
  for (const r of rows) {
    const key = r.category ?? UNCATEGORIZED;
    const c = byCategory.get(key) ?? { category: key, spent: 0, previousSpent: 0, count: 0 };
    if (r.period === "current") {
      c.spent += r.spent;
      c.count += r.count;
    } else {
      c.previousSpent += r.spent;
    }
    byCategory.set(key, c);
  }
  const categories = [...byCategory.values()].sort(
    (a, b) => b.spent - a.spent || b.previousSpent - a.previousSpent || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0),
  );
  return {
    month: w.month,
    through: w.to,
    previous: { from: w.previousFrom, to: w.previousTo },
    spent: categories.reduce((s, c) => s + c.spent, 0),
    previousSpent: categories.reduce((s, c) => s + c.previousSpent, 0),
    categories,
  };
}

// --- Payments outside the limit (task В2а) ------------------------------------------------------------------------
// Planned payments, taxes and debt payments leave money but not the limit (OUT_OF_LIMIT_PAYMENT_TYPES in
// domain/ledger.ts). «Итоги» names them in one quiet line under the categories, apart from `spent`.

/** What the payments outside the limit took over one of the two stretches, summed in the database. */
export interface OtherPaymentsRow {
  period: "current" | "previous";
  /** Kopecks, signed like outOfLimitPayment. */
  spent: Minor;
}

/** Each stretch's sum; never below zero, so money back on such a row cannot make the line negative. */
export function buildOtherPayments(rows: readonly OtherPaymentsRow[]): { otherPayments: Minor; previousOtherPayments: Minor } {
  const sum = (period: OtherPaymentsRow["period"]) => Math.max(0, rows.filter((r) => r.period === period).reduce((s, r) => s + r.spent, 0));
  return { otherPayments: sum("current"), previousOtherPayments: sum("previous") };
}

// --- Places of the month (task В3) -------------------------------------------------------------------------------
// A place is the counterparty of a bank purchase that counts against the limit (type 'spend'), named by the one
// counterparty key the app already uses (transactions/counter-key.ts: «Применить к похожим», recipients, the
// questions on «Сегодня»). Person transfers are people, not places, typed 'spend' or not (Б56, below); entries in the cash wallet carry only the owner's
// note, not a bank's merchant; withdrawals are not purchases. A refund lowers its place's sum, as it lowers its
// category's, when the bank names it as the purchase; it is not a visit.

//
// Б56: a person stays a person when the owner made a transfer to them a purchase (the answer «Оплата услуги или
// покупка», a rule by recipient, or a type changed by hand): it still counts in the limit and its category, but it is
// not a place, nor a subscription. The signal is the bank's: the row came with a money-transfer MCC, so it was no card
// payment at a till or online, and only the owner, not the bank's recognition, made it a purchase. The recognition's
// own purchases with that MCC (a store installment, a refund) are typed 'rule' or 'auto' and stay places. Two kinds of
// counterparty the classifier already tells apart stay places even when the owner typed them: a business (a sole
// trader, a company, as BUSINESS_SENDER) paid by account number, and a store installment the owner recategorised.

/** The fields of a row that tell a transfer to a person from a purchase at a place. */
export interface PaidToPersonInput {
  mcc: number | null;
  /** transactions.type_source: 'owner' for a type or category given by the owner or by one of the owner's rules. */
  typeSource: string | null;
  description: string;
  counterName: string | null;
}

/** A transfer to a person that the owner made a purchase (Б56): not a place, whatever its type. */
export function isPaidToPerson(r: PaidToPersonInput): boolean {
  if (r.mcc === null || !TRANSFER_MCCS.has(r.mcc) || r.typeSource !== "owner") return false;
  const name = r.counterName?.trim() || r.description.trim();
  return !BUSINESS_SENDER.test(name) && !STORE_INSTALLMENT.test(r.description.trim());
}

/**
 * A word as a bank writes it: in capitals, capitalised, in lower case. The database can neither fold the case of
 * Cyrillic nor put it in a character class when its encoding or locale is not a Unicode one (the tests' database is
 * not), so the SQL lists whole words; a word in mixed case («ФоП») is the one thing the SQL misses and the regex finds.
 */
const bankCases = (word: string): string[] => [word.toUpperCase(), word[0]!.toUpperCase() + word.slice(1), word];

/** SQL over `t` (transactions): isPaidToPerson, built from the same constants. Never null, so NOT of it is safe. */
export function paidToPersonSql(t = "t"): string {
  const name = `btrim(COALESCE(NULLIF(btrim(${t}.counter_name), ''), ${t}.description))`;
  const business = [...bankCases("фоп"), ...bankCases("тов")].join("|");
  return (
    `COALESCE(${t}.mcc IN (${[...TRANSFER_MCCS].join(",")}) AND ${t}.type_source = 'owner'` +
    ` AND ${name} !~ '^(${business})\\s'` +
    ` AND btrim(${t}.description) !~ '^(${bankCases("платіж").join("|")})\\s+\\S', false)`
  );
}

/** How many places «Итоги» names: a short list that fits one card, the largest first. */
export const PLACES_TOP = 5;
/** A place is new for a month when it had no purchase in this many whole months before it (as for spikes, audit §8). */
export const NEW_PLACE_MONTHS = 3;

/** One place over the month's stretch, summed in the database. */
export interface PlaceRow {
  /** counterKeySql of its rows. */
  key: string;
  /** As «Операции» names its latest row: the counterparty's name, else the bank text. */
  name: string;
  /** Kopecks, signed like limitSpend: refunds at the place lower it. */
  spent: Minor;
  /** Purchases (money out) at the place in the stretch; refunds are not visits. */
  visits: number;
  /** A purchase at the place in the NEW_PLACE_MONTHS before the month. */
  seenBefore: boolean;
}

export interface InsightsPlace {
  key: string;
  name: string;
  spent: Minor;
  visits: number;
  isNew: boolean;
}

/** The first day of the stretch a new place is looked for in: the 1st of the month NEW_PLACE_MONTHS before. */
export function placesLookbackFrom(month: string): string {
  let m = month;
  for (let i = 0; i < NEW_PLACE_MONTHS; i++) m = previousMonth(m);
  return `${m}-01`;
}

/**
 * The month's largest places. Only a place with a name, a visit and a sum left after refunds is one. A place is new only
 * when the history (the first day any operation is stored, `historyFrom`) reaches back over the whole lookback;
 * with a shorter history every place would look new, so none is marked.
 */
export function buildPlaces(rows: readonly PlaceRow[], historyFrom: string | null, month: string): InsightsPlace[] {
  const knowsHistory = historyFrom !== null && historyFrom <= placesLookbackFrom(month);
  return rows
    .filter((r) => r.visits > 0 && r.spent > 0 && r.name.trim() !== "")
    .sort((a, b) => b.spent - a.spent || b.visits - a.visits || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.key < b.key ? -1 : 1))
    .slice(0, PLACES_TOP)
    .map((r) => ({ key: r.key, name: r.name, spent: r.spent, visits: r.visits, isNew: knowsHistory && !r.seenBefore }));
}
