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

/** The same amount in dollars at a UAH-per-USD rate; null when no rate is known. */
export function formatUsd(kopecks: number, usdRate: number): string | null {
  if (!(usdRate > 0)) return null;
  return signed(kopecks / usdRate, "$");
}

export function formatMoneyWithUsd(kopecks: number, usdRate: number): { uah: string; usd: string | null } {
  return { uah: formatMoney(kopecks), usd: formatUsd(kopecks, usdRate) };
}

const DAY_MS = 86_400_000;
const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** An ISO calendar date moved by whole days. */
export function shiftDate(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** "сегодня", "завтра", "через 4 дня"; a past date is just DD.MM. */
export function dueLabel(dueOn: string, today: string): string {
  const days = Math.round((toUtc(dueOn) - toUtc(today)) / DAY_MS);
  if (days < 0) return `${dueOn.slice(8, 10)}.${dueOn.slice(5, 7)}`;
  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  return `через ${days} ${plural(days, "день", "дня", "дней")}`;
}

const two = (n: number) => String(n).padStart(2, "0");

/** A moment in the device's local time: "сегодня 09:05" or "01.11 23:40". */
export function formatStamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? `сегодня ${time}` : `${two(d.getDate())}.${two(d.getMonth() + 1)} ${time}`;
}

/** Today's calendar date in Kyiv, as the server counts days. */
export function kyivDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Typed hryvnias ("1 500,50", "12.5") as kopecks; null for empty, zero, negative or malformed text. */
export function parseHryvnias(text: string): number | null {
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.replace(/\s/g, ""));
  if (!m) return null;
  const kopecks = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(kopecks) && kopecks > 0 ? kopecks : null;
}

/** The quarter a tax payment is for, from its due date: the one before the due date's quarter. */
export function taxQuarterOfDue(due: string): string {
  const year = Number(due.slice(0, 4));
  const quarter = Math.floor((Number(due.slice(5, 7)) - 1) / 3) + 1;
  return quarter === 1 ? `${year - 1}-Q4` : `${year}-Q${quarter - 1}`;
}

const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€" };

/** An amount in its own account currency, cents shown: "−$10.00" or "−1,000.50 PLN". */
export function formatOriginal(minor: number, currency: string): string {
  const abs = Math.abs(minor);
  const text = `${group(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
  const sign = minor < 0 ? "−" : "";
  const symbol = SYMBOLS[currency];
  return symbol ? `${sign}${symbol}${text}` : `${sign}${text} ${currency}`;
}

/** "2026-11-02" as "02.11". */
export function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

/** A real calendar date typed as YYYY-MM-DD. */
export function isIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(text);
}
