// No native imports: runs in node tests. The icon names are drawn by components/Icon.tsx.
import { CATEGORY_ICONS, type CategoryIcon, type TransactionDto } from "@hale/contracts";
import type { IconName } from "./components/Icon";
import type { CategoryList } from "./labels";

// Every icon a category can have is drawn by Icon.tsx: this fails to compile otherwise.
const DRAWN: readonly IconName[] = CATEGORY_ICONS;

const BY_CATEGORY: Record<string, IconName> = {
  groceries: "cart",
  cafe: "coffee",
  transport: "car",
  health: "heart",
  utilities: "bolt",
  telecom: "phone",
  shopping: "bag",
  leisure: "ticket",
  subscriptions: "repeat",
  refund: "arrowIn",
};

const BY_TYPE: Partial<Record<NonNullable<TransactionDto["type"]>, IconName>> = {
  cash_out: "cash",
  cash_in: "cash",
  own_transfer: "transfer",
  goal_contribution: "transfer",
  person_transfer: "transfer",
  loan_out: "transfer",
  obligation: "receipt",
  tax: "receipt",
  debt_payment: "receipt",
  income: "arrowIn",
  person_in: "arrowIn",
  loan_in: "arrowIn",
};

/** An icon name from the server that this app draws; a newer server may send one it does not know yet. */
export const isCategoryIcon = (icon: string): icon is CategoryIcon => (DRAWN as readonly string[]).includes(icon);

/** A category's icon: the server's when it knows the key (В5), else the built-in one, else a plain circle. */
export function categoryIconOf(category: string | null, list?: CategoryList): IconName {
  if (category === null) return "circle";
  const icon = list?.find((c) => c.key === category)?.icon;
  if (icon !== undefined) return isCategoryIcon(icon) ? icon : "circle";
  return BY_CATEGORY[category] ?? "circle";
}

/** The round badge of an operation: a purchase by its category, anything else by the kind of money movement. */
export function categoryIcon(tx: Pick<TransactionDto, "type" | "category">, list?: CategoryList): IconName {
  if (tx.type === "spend") return categoryIconOf(tx.category, list);
  return (tx.type && BY_TYPE[tx.type]) || "circle";
}
