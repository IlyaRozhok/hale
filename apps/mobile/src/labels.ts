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

export const LABEL_CHOICES: { label: RecipientLabelName; text: string }[] = [
  { label: "shared_budget", text: "Общий бюджет" },
  { label: "help", text: "Помощь" },
  { label: "debt_repayment", text: "Возврат долга" },
  { label: "one_off", text: "Разово" },
  { label: "obligation", text: "Обязательное" },
];
