// Pure formatting for money and dates. No native imports: runs in node tests.

const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function signed(kopecksOrCents: number, symbol: string): string {
  const whole = Math.round(Math.abs(kopecksOrCents) / 100);
  return `${kopecksOrCents < 0 && whole > 0 ? "−" : ""}${symbol}${group(whole)}`;
}

/** Kopecks as whole hryvnias with comma grouping: 1032500 -> "₴10,325"; negatives get a real minus. */
export function formatMoney(kopecks: number): string {
  return signed(kopecks, "₴");
}

/** Like formatMoney, with a plus on money coming in. */
export function formatSignedMoney(kopecks: number): string {
  return `${Math.round(kopecks / 100) > 0 ? "+" : ""}${formatMoney(kopecks)}`;
}

/** Whole dollars from cents: 50000 -> "$500". */
export function formatDollars(cents: number): string {
  return signed(cents, "$");
}

/** Share of a goal reached, 0..100, rounded down so a goal only shows 100 when it is met. */
export function goalPercent(saved: number, target: number): number {
  if (!(target > 0)) return 0;
  return Math.min(100, Math.floor((saved / target) * 100));
}

/** The same amount in dollars at a UAH-per-USD rate; null when no rate is known. */
export function formatUsd(kopecks: number, usdRate: number): string | null {
  if (!(usdRate > 0)) return null;
  return signed(kopecks / usdRate, "$");
}

const DAY_MS = 86_400_000;
const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** An ISO calendar date moved by whole days. */
export function shiftDate(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The last `days` days ending today, today counted in: 7 from 9 Nov is 3–9 Nov. */
export function lastDays(today: string, days: number): { from: string; to: string } {
  return { from: shiftDate(today, 1 - days), to: today };
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** "сегодня", "завтра", "через 4 дня"; a past date is just the short date, "1 ноя". */
export function dueLabel(dueOn: string, today: string): string {
  const days = Math.round((toUtc(dueOn) - toUtc(today)) / DAY_MS);
  if (days < 0) return shortDate(dueOn);
  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  return `через ${days} ${plural(days, "день", "дня", "дней")}`;
}

/** A number as two digits: 5 -> "05". */
export const two = (n: number) => String(n).padStart(2, "0");

/** A moment's local calendar date on the device, as YYYY-MM-DD. */
const localIso = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

/** A moment in the device's local time: "сегодня 09:05", "1 ноя, 23:40", or "31 дек 2025, 23:40" for another year. */
export function formatStamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const day = localIso(d);
  const today = localIso(now);
  return day === today ? `сегодня ${time}` : `${shortDate(day, today)}, ${time}`;
}

/** Today's calendar date in Kyiv, as the server counts days. */
export function kyivDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A typed balance ("1 500,50", "12.5", "0") as minor units; null for empty, negative or malformed text. */
export function parseBalance(text: string): number | null {
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.replace(/\s/g, ""));
  if (!m) return null;
  const minor = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Typed hryvnias ("1 500,50", "12.5") as kopecks; null for empty, zero, negative or malformed text. */
export function parseHryvnias(text: string): number | null {
  const kopecks = parseBalance(text);
  return kopecks !== null && kopecks > 0 ? kopecks : null;
}

/** The quarter a tax payment is for, from its due date: the one before the due date's quarter. */
export function taxQuarterOfDue(due: string): string {
  const year = Number(due.slice(0, 4));
  const quarter = Math.floor((Number(due.slice(5, 7)) - 1) / 3) + 1;
  return quarter === 1 ? `${year - 1}-Q4` : `${year}-Q${quarter - 1}`;
}

const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€" };

/** An amount in its own account currency, cents shown only when there are any: "−$10", "€25.50" or "−1,000.50 PLN". */
export function formatOriginal(minor: number, currency: string): string {
  const abs = Math.abs(minor);
  const cents = abs % 100;
  const text = `${group(Math.floor(abs / 100))}${cents === 0 ? "" : `.${String(cents).padStart(2, "0")}`}`;
  const sign = minor < 0 ? "−" : "";
  const symbol = SYMBOLS[currency];
  return symbol ? `${sign}${symbol}${text}` : `${sign}${text} ${currency}`;
}

/** Like formatOriginal, with a plus on money coming in. */
export function formatSignedOriginal(minor: number, currency: string): string {
  return `${minor > 0 ? "+" : ""}${formatOriginal(minor, currency)}`;
}

const MASKED_CARD = /^\d{4,8}\*+(\d{4})$/;

/**
 * A transfer out whose description is only a masked card number ("545708****4563", as the bank sends it), in words:
 * «Перевод на карту ··4563». Null for anything else, money coming in included.
 */
export function cardTransferTitle(description: string, amount: number): string | null {
  if (amount >= 0) return null;
  const m = MASKED_CARD.exec(description.replace(/\s/g, ""));
  return m ? "Перевод на карту ··{last4}".replace("{last4}", m[1]!) : null;
}

/** What colour an amount carries: transfers between own accounts are neither spending nor income. */
export function amountTone(type: string | null, amount: number): "neutral" | "expense" | "income" {
  if (type === "own_transfer" || amount === 0) return "neutral";
  return amount < 0 ? "expense" : "income";
}

const WEEKDAYS = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const MONTHS_FULL = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const dayOf = (iso: string) => String(Number(iso.slice(8, 10)));
const monthOf = (iso: string) => Number(iso.slice(5, 7)) - 1;

/** "2026-11-03" as "Вторник, 3 ноября". */
export function longDate(iso: string): string {
  return `${WEEKDAYS[new Date(toUtc(iso)).getUTCDay()]}, ${dayOf(iso)} ${MONTHS_FULL[monthOf(iso)]}`;
}

/** The parts of a date tile: day and short month. */
export function dayMonth(iso: string): { day: string; month: string } {
  return { day: dayOf(iso), month: MONTHS_SHORT[monthOf(iso)]! };
}

/** A section header: "Сегодня, 3 ноя", "Вчера, 2 ноя" or "31 окт". */
export function dayHeader(iso: string, today: string): string {
  const { day, month } = dayMonth(iso);
  const date = `${day} ${month}`;
  if (iso === today) return `Сегодня, ${date}`;
  if (iso === shiftDate(today, -1)) return `Вчера, ${date}`;
  return date;
}

/**
 * The one short date of the app: "2026-12-06" as "6 дек". Given today, a date in another year gets its year,
 * "6 янв 2027", so a far date is not ambiguous.
 */
export function shortDate(iso: string, today?: string): string {
  const { day, month } = dayMonth(iso);
  return today && today.slice(0, 4) !== iso.slice(0, 4) ? `${day} ${month} ${iso.slice(0, 4)}` : `${day} ${month}`;
}

/** A real calendar date typed as YYYY-MM-DD. */
export function isIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(text);
}

/** "2026-08-04" as "4 августа". */
export function dayMonthLong(iso: string): string {
  return `${dayOf(iso)} ${MONTHS_FULL[monthOf(iso)]}`;
}

const MONTHS_IN = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];

/** A month in the prepositional case, for «в октябре». month is 1..12. */
export const inMonth = (month: number): string => MONTHS_IN[month - 1]!;

/** "2026-11-03" as "3 ноября 2026". */
export function dateLabel(iso: string): string {
  return `${dayOf(iso)} ${MONTHS_FULL[monthOf(iso)]} ${iso.slice(0, 4)}`;
}

const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

/** month is 1..12. */
export const monthTitle = (year: number, month: number): string => `${MONTH_NAMES[month - 1]} ${year}`;

/** A month's dates for a calendar, Monday first, with blanks before the first day. month is 1..12. */
export function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  return [
    ...Array.from({ length: (first + 6) % 7 }, () => null),
    ...Array.from({ length: days }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`),
  ];
}

/** "дня" and so on, in the form that follows the number n. */
function daysWord(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return "дней";
  if (ones === 1) return "день";
  return ones >= 2 && ones <= 4 ? "дня" : "дней";
}

/** The current streak in words, or the calendar's name while there is none. */
export const streakLabel = (streak: number): string => (streak > 0 ? `Серия: ${streak} ${daysWord(streak)} в лимите` : "Календарь лимитов");

/** Which of the three Russian plural forms a count takes: 1 операция, 3 операции, 12 операций. */
export function pluralIndex(n: number): 0 | 1 | 2 {
  const d = Math.abs(n) % 100;
  if (d >= 11 && d <= 14) return 2;
  const u = d % 10;
  if (u === 1) return 0;
  return u >= 2 && u <= 4 ? 1 : 2;
}

export const operationsText = (n: number): string => `${n} ${["операция", "операции", "операций"][pluralIndex(n)]}`;

/** A name as shown: its first letter capital, the rest as it was (a rule's bank text comes in lower case, Я6). */
export const firstCapital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** A chosen period, short: "9 ноя", "3–9 ноя", "28 окт – 3 ноя". */
export function periodLabel(from: string, to: string): string {
  const a = dayMonth(from);
  const b = dayMonth(to);
  if (from === to) return `${a.day} ${a.month}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${a.day}–${b.day} ${b.month}`;
  return `${a.day} ${a.month} – ${b.day} ${b.month}`;
}
