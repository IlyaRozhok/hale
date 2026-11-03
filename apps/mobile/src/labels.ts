// Russian names for server codes. No native imports: runs in node tests.
import type { RecipientLabelName, TxTypeDto } from "@hale/contracts";

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

/** What an earlier answer now reads as; "obligation" is no longer offered but may have been given. */
const EARLIER_ANSWERS: Partial<Record<RecipientLabelName, string>> = {
  shared_budget: "Близкий человек, регулярно",
  help: "Разовая помощь или подарок",
  obligation: "Обязательный платёж",
};

export const answerText = (label: RecipientLabelName | null): string =>
  label === null ? "не указано" : (EARLIER_ANSWERS[label] ?? LABEL_CHOICES.find((c) => c.label === label)!.text);
