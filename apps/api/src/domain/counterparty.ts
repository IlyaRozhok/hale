/** Whole bank templates only: "Переказ Тая М." names a person and must stay a question. */
const GENERIC_TEXT = /^(?:(?:переказ|перевод)(?: коштів| средств)?(?: на (?:картку|карту)(?: monobank)?)?|(?:поповнення|пополнение)(?: рахунку| счёта| счета| банки)?(?: «[^»]*»)?)$/iu;
/** Only digits, asterisks and separators: a masked card number with no name attached. */
const MASKED_CARD = /^[\d*\s-]*\*[\d*\s-]*$/;

/** Whether a statement label names someone the owner can be asked about, rather than a bank template. */
export function isCounterpartyName(label: string | null | undefined): boolean {
  const text = label?.trim() ?? "";
  return text !== "" && !GENERIC_TEXT.test(text) && !MASKED_CARD.test(text);
}

/** "перевод" in the form that follows the number n. */
export function transfersWord(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return "переводов";
  if (ones === 1) return "перевод";
  return ones >= 2 && ones <= 4 ? "перевода" : "переводов";
}
