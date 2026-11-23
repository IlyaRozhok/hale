/**
 * How the server writes dates and card numbers inside the texts it assembles (questions, bad cases,
 * notifications), the same way the app writes them (`shortDate`, `cardTransferTitle` in apps/mobile/src/format.ts).
 */

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** A Kyiv day as "6 дек"; a day of another year than `today` as "6 янв 2027". */
export function shortDate(iso: string, today: string): string {
  const date = `${Number(iso.slice(8, 10))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}`;
  return iso.slice(0, 4) === today.slice(0, 4) ? date : `${date} ${iso.slice(0, 4)}`;
}

/** Only digits, asterisks and separators: a masked card number with no name attached. */
const MASKED_CARD = /^[\d*\s-]*\*[\d*\s-]*$/;

/** Whether a label is only a masked card number ("545708****4563", "**** 4563"). */
export function isMaskedCard(label: string): boolean {
  return MASKED_CARD.test(label.trim());
}

/** The last (up to four) digits after the stars of a masked card number; null for anything else. */
export function cardDigits(label: string): string | null {
  const text = label.trim();
  if (!MASKED_CARD.test(text)) return null;
  const digits = text.slice(text.lastIndexOf("*") + 1).replace(/\D/g, "");
  return digits === "" ? null : digits.slice(-4);
}

/** A masked card number as the app shows it: "545708****4563" -> "··4563"; null for anything else. */
export function cardDots(label: string): string | null {
  const digits = cardDigits(label);
  return digits === null ? null : `··${digits}`;
}
