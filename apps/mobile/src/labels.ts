// Russian names for server codes. No native imports: runs in node tests.
import type { RecipientLabelName, TxTypeDto } from "@hale/contracts";
import { formatMoney, pluralIndex } from "./format";

const TYPES: Record<TxTypeDto, string> = {
  income: "Доход",
  spend: "Трата",
  obligation: "Обязательный платёж",
  tax: "Налог",
  debt_payment: "Платёж по долгу",
  loan_in: "Займ",
  own_transfer: "Между своими",
  person_transfer: "Перевод человеку",
  person_in: "От человека",
  cash_in: "Внесение наличных",
  cash_out: "Снятие наличных",
  goal_contribution: "Взнос в цель",
  loan_out: "Дал в долг",
};

export const TYPE_CHOICES = Object.keys(TYPES) as TxTypeDto[];

export const typeLabel = (type: TxTypeDto | null): string => (type ? TYPES[type] : "Не определён");

/** The types offered at once for money going out; the others wait behind "Ещё". */
export const FREQUENT_TYPES_OUT: readonly TxTypeDto[] = ["spend", "obligation", "own_transfer", "person_transfer"];
/** The same for money coming in. */
export const FREQUENT_TYPES_IN: readonly TxTypeDto[] = ["income", "person_in", "own_transfer"];

/**
 * The type chips of an operation: the frequent ones for its direction, then its own type when that is a
 * rare one, so the chosen type is always in sight; `rest` is what "Ещё" opens, in the usual order.
 */
export function typeChips(amount: number, current: TxTypeDto | null): { shown: TxTypeDto[]; rest: TxTypeDto[] } {
  const frequent = amount < 0 ? FREQUENT_TYPES_OUT : FREQUENT_TYPES_IN;
  const shown = current !== null && !frequent.includes(current) ? [...frequent, current] : [...frequent];
  return { shown, rest: TYPE_CHOICES.filter((t) => !shown.includes(t)) };
}

const ACCOUNTS = new Map([
  ["black", "Чёрная карта"],
  ["white", "Белая карта"],
  ["fop", "Счёт ФОП"],
  ["jar", "Банка"],
  ["cash", "Наличные"],
]);

/** The account an operation went through, by the server's kind; null for a kind with no name here. */
export const accountLabel = (kind: string): string | null => ACCOUNTS.get(kind) ?? null;

const CATEGORIES: Record<string, string> = {
  groceries: "Продукты",
  cafe: "Кафе и рестораны",
  transport: "Транспорт",
  subscriptions: "Подписки",
  leisure: "Досуг",
  health: "Здоровье",
  utilities: "Коммунальные",
  telecom: "Связь",
  shopping: "Покупки",
  uncategorized: "Без категории",
  tax: "Налоги",
  debt: "Долги",
  loan: "Займы",
  cash: "Наличные",
  transfer: "Переводы",
  own: "Свои счета",
  income: "Доходы",
  refund: "Возвраты",
};

/** What the owner can pick for a purchase. */
export const SPEND_CATEGORIES = [
  "groceries", "cafe", "transport", "subscriptions", "leisure", "health", "utilities", "telecom", "shopping", "refund", "uncategorized",
] as const;

export const categoryLabel = (category: string | null): string =>
  category === null ? CATEGORIES.uncategorized! : (CATEGORIES[category] ?? category);

export const LABEL_CHOICES: { label: RecipientLabelName; text: string; effect: string }[] = [
  { label: "close_regular", text: "Близкий человек, регулярно", effect: "Считается в дневном лимите. Платёж из плана лимит не тратит" },
  { label: "one_off", text: "Разовая помощь или подарок", effect: "Считается в дневном лимите" },
  { label: "service", text: "Оплата услуги или покупка", effect: "Считается в дневном лимите как трата" },
  { label: "debt_repayment", text: "Возвращаю долг", effect: "Дневной лимит не тратит, денег становится меньше" },
  { label: "lend", text: "Даю в долг", effect: "Дневной лимит не тратит, денег становится меньше" },
  { label: "own_account", text: "Это мой счёт", effect: "Не расход: деньги остаются у вас" },
  { label: "skip", text: "Не спрашивать", effect: "Считается в дневном лимите, вопроса больше не будет" },
];

type LabelChoice = (typeof LABEL_CHOICES)[number];

/** The answers offered at once; the others wait behind "Другое". */
export const FREQUENT_ANSWERS: readonly RecipientLabelName[] = ["close_regular", "service", "own_account"];

/**
 * The answers to "Что это за перевод?": the frequent ones, then the answer given before when that is a
 * rare one, so the chosen answer is always in sight; `rest` is what "Другое" opens, in the usual order.
 */
export function answerChoices(current: RecipientLabelName | null): { shown: LabelChoice[]; rest: LabelChoice[] } {
  const shown = LABEL_CHOICES.filter((c) => FREQUENT_ANSWERS.includes(c.label));
  const own = LABEL_CHOICES.find((c) => c.label === current);
  if (own && !shown.includes(own)) shown.push(own);
  return { shown, rest: LABEL_CHOICES.filter((c) => !shown.includes(c)) };
}

/**
 * Who the question is about and what went to them, in one line: "Олена К. · 3 перевода, ₴4,500".
 * The name alone while the totals are not known; nothing when there is neither.
 */
export function recipientLine(name: string | undefined, sent: { count: number; total: number } | undefined): string | undefined {
  if (!sent) return name;
  const totals = `${sent.count} ${["перевод", "перевода", "переводов"][pluralIndex(sent.count)]}, ${formatMoney(sent.total)}`;
  return name ? `${name} · ${totals}` : totals;
}

/** What an earlier answer now reads as; "obligation" is no longer offered but may have been given. */
const EARLIER_ANSWERS: Partial<Record<RecipientLabelName, string>> = {
  shared_budget: "Близкий человек, регулярно",
  help: "Разовая помощь или подарок",
  obligation: "Обязательный платёж",
};

export const answerText = (label: RecipientLabelName | null): string =>
  label === null ? "не указано" : (EARLIER_ANSWERS[label] ?? LABEL_CHOICES.find((c) => c.label === label)!.text);
