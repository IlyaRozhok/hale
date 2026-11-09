// No native imports: runs in node tests. The icon names are drawn by components/Icon.tsx.
import type { TransactionDto } from "@hale/contracts";
import type { IconName } from "./components/Icon";

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

/** The round badge of an operation: a purchase by its category, anything else by the kind of money movement. */
export function categoryIcon(tx: Pick<TransactionDto, "type" | "category">): IconName {
  if (tx.type === "spend") return (tx.category && BY_CATEGORY[tx.category]) || "circle";
  return (tx.type && BY_TYPE[tx.type]) || "circle";
}
