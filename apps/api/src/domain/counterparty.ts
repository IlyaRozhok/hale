import { cardDigits, cardDots, isMaskedCard } from "./text-format";

/** Whole bank templates only: "Переказ Тая М." names a person and must stay a question. */
const GENERIC_TEXT = /^(?:(?:переказ|перевод)(?: коштів| средств)?(?: на (?:картку|карту)(?: monobank)?)?|(?:поповнення|пополнение)(?: рахунку| счёта| счета| банки)?(?: «[^»]*»)?)$/iu;

/** Whether a statement label names someone the owner can be asked about, rather than a bank template. */
export function isCounterpartyName(label: string | null | undefined): boolean {
  const text = label?.trim() ?? "";
  return text !== "" && !GENERIC_TEXT.test(text) && !isMaskedCard(text);
}

/** "*4563" for a masked card number with digits after its stars; null for anything else. */
export function cardTail(label: string): string | null {
  const digits = cardDigits(label);
  return digits === null ? null : `*${digits}`;
}

/**
 * «Что это за перевод?» about transfers with no name (Б10): where the bank says the money went, a
 * masked card shortened to its last digits. `amount` and `day` come formatted; `amount` is the total.
 */
export function unnamedTransferQuestion(label: string, count: number, amount: string, day: string): { subject: string; text: string } {
  const text = label.trim();
  const tail = cardTail(text);
  const dots = cardDots(text);
  if (tail && dots) {
    return {
      subject: `Карта ${tail}`,
      text: count === 1
        ? `Перевод ${amount} на карту ${dots} (${day})`
        : `${count} ${transfersWord(count)} на карту ${dots}, ${amount}, последний ${day}`,
    };
  }
  return {
    subject: text,
    text: count === 1
      ? `Перевод ${amount} (${day}): ${text}`
      : `${count} ${transfersWord(count)}, ${amount}, последний ${day}: ${text}`,
  };
}

/** "перевод" in the form that follows the number n. */
export function transfersWord(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return "переводов";
  if (ones === 1) return "перевод";
  return ones >= 2 && ones <= 4 ? "перевода" : "переводов";
}
