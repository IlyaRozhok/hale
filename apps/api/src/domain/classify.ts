import { cardTail, isCounterpartyName } from "./counterparty";
import {
  CASH_MCCS,
  type Category,
  TRANSFER_MCCS,
  categoryByMcc,
  categoryByMerchant,
  isPurchaseMcc,
} from "./merchants";

export type { Category } from "./merchants";

export type TxType =
  | "income"
  | "spend"
  | "obligation"
  | "tax"
  | "debt_payment"
  | "loan_in"
  | "own_transfer"
  | "person_transfer"
  | "person_in"
  | "cash_in"
  | "cash_out"
  | "goal_contribution"
  | "loan_out";

export interface ClassifyInput {
  /** Signed minor units; positive is money in. */
  amount: number;
  mcc: number | null;
  description: string;
  comment?: string | null;
  counterIban?: string | null;
  counterName?: string | null;
  accountKind: "black" | "white" | "fop" | "jar" | "other";
  /** Caller found the other leg of a move between own accounts (see isOwnPair in own-pair.ts). */
  pairedOwnTransfer?: boolean;
}

export interface ClassifyRule {
  matchKind: "merchant" | "iban" | "recipient";
  matchValue: string;
  type: TxType;
  category?: string | null;
  /** Only outgoing ('out') or incoming ('in') money; null or absent means both. */
  direction?: "in" | "out" | null;
}

export interface ClassifyContext {
  ownIbans: ReadonlySet<string>;
  /** Owner's names as the bank prints them, any script or word order. */
  ownNames: readonly string[];
  /** Titles of the owner's own jars. */
  ownJars: readonly string[];
  /** Owner rules, first match wins. */
  rules: readonly ClassifyRule[];
}

export interface ClassifyResult {
  type: TxType;
  category: string;
  source: "rule" | "owner" | "auto";
  needsLabel: boolean;
}

const lc = (s: string) => s.toLowerCase();
const words = (s: string) => lc(s).match(/[\p{L}\p{N}]+/gu) ?? [];

/** Bank text for money coming from the owner's fop account. */
export const FOP_WITHDRAWAL = /рахунку\s+фоп/i;
/** Bank text for dollars leaving the fop's dollar account for its hryvnia account. */
const FOP_TO_HRYVNIA = /^на\s+гривневий\s+рахунок\s+фоп/i;
const OWN_CARD = /^з\s+(білої|чорної)\s+картки/i;
const JAR_PAYOUT = /^(часткове зняття банки|виплата банки)/i;
const JAR_TOPUP = /^поповнення\s+[«"]([^»"]+)[»"]/i;
// JS \b is ASCII-only, so Cyrillic word edges use lookarounds.
const TAX = /(гу\s*дпс|(?<!\p{L})гук(?!\p{L})|єдиний податок|(?<!\p{L})єсв(?!\p{L})|військов\p{L}*\s+збір|(?<!\p{L})дпс(?!\p{L}))/iu;
const LOAN_TEXT =
  /(кредит\s+до\s+завтра|кредит\s+готівкою|розстрочка\s+на\s+картку|рассрочка\s+на\s+карту|moneyveo|miloan|creditkasa|швидко\s?гроші|sgroshi|easycash|gocrd|gopcr|pgid_commission|pt_slc)/i;
const INSTALLMENT_PAYMENT =
  /^(щомісячний платіж|платіж розстрочки|повне погашення|погашення наступного платежу)/i;
const STORE_INSTALLMENT = /^платіж\s+\S/i;
const INTEREST = /^списання відсотків/i;
const PENALTY = /^штраф за порушення погашення/i;
const MIGRATION = /в рамках міграції рахунку/i;
const ATM = /^(банкомат|видача готівки|видача готівкою)|\batm\b/i;
const CASH_DEPOSIT = /^(термінал|city\s*\d)/i;
const CASHBACK = /^виведення кешбеку/i;
const REFUND = /^(скасування|повернення платежу)/i;
const REFUND_OF_TRANSFER = /переказ/i;
/** «Від: <name>»: money in from a card at another bank. The ledger check (ledger-check.ts) reads it too. */
export const FROM_PREFIX = /^від:/i;
/** A business's refund of an order, as the sender writes it in the transfer comment (Б13). */
const ORDER_REFUND_COMMENT = /^повернення\s+коштів/iu;
/** Only a sole trader or a company: a friend returning a debt must not become a purchase refund. */
const BUSINESS_SENDER = /^(фоп|тов)\s/iu;

/** Money taken out as cash, by the bank text or the MCC. */
export const isWithdrawal = (tx: Pick<ClassifyInput, "amount" | "description" | "mcc">): boolean =>
  tx.amount < 0 && (ATM.test(tx.description.trim()) || (tx.mcc !== null && CASH_MCCS.has(tx.mcc)));

/** Cash paid in at a terminal, by the bank text and the transfer MCC. */
export const isCashDeposit = (tx: Pick<ClassifyInput, "amount" | "description" | "mcc">): boolean =>
  tx.amount > 0 && tx.mcc === 4829 && CASH_DEPOSIT.test(tx.description.trim());

/** Trimmed, lower-cased, whitespace collapsed: the form recipient rules compare in. */
export const normaliseText = (s: string): string => lc(s).trim().replace(/\s+/g, " ");

const GENERIC_BANK_TEXT = new Set([
  "переказ", "перекази", "переказ коштів", "переказ на картку", "переказ з картки", "поповнення",
  "поповнення картки", "списання", "оплата", "платіж", "транзакція", "p2p", "p2p переказ", "transfer",
  "payment", "перевод",
]);

/** Too short or too generic to identify one counterparty: no rule is made from it. */
export function isWeakRuleValue(value: string): boolean {
  const v = normaliseText(value);
  return v.length < 4 || GENERIC_BANK_TEXT.has(v);
}

export function ruleMatches(rule: Pick<ClassifyRule, "matchKind" | "matchValue" | "direction">, tx: Pick<ClassifyInput, "amount" | "description" | "counterIban" | "counterName">): boolean {
  if (rule.direction === "out" && tx.amount >= 0) return false;
  if (rule.direction === "in" && tx.amount <= 0) return false;
  const v = lc(rule.matchValue);
  if (!v) return false;
  switch (rule.matchKind) {
    case "iban":
      return tx.counterIban === rule.matchValue;
    case "merchant":
      return lc(tx.description).includes(v);
    case "recipient": {
      // The whole name or the whole description, never a fragment of either.
      const n = normaliseText(rule.matchValue);
      return normaliseText(tx.counterName ?? "") === n || normaliseText(tx.description) === n;
    }
  }
}

function mentionsOwnName(text: string, ownNames: readonly string[]): boolean {
  const tokens = new Set(words(text));
  return ownNames.some((n) => {
    const t = words(n);
    return t.length > 0 && t.every((w) => tokens.has(w));
  });
}

/**
 * Someone other than the owner is on the other side of the row (Б10), so it cannot be one leg of an
 * exchange between own accounts: money from a named sender who is not the owner; money sent to a
 * masked card, a foreign IBAN or a named counterparty who is not the owner. Only the bank's
 * counterparty field and «Від: …» name a sender: a bare description may be a bank text.
 */
export function hasThirdParty(
  tx: Pick<ClassifyInput, "amount" | "description" | "counterIban" | "counterName">,
  ctx: Pick<ClassifyContext, "ownNames" | "ownIbans">,
): boolean {
  const d = tx.description.trim();
  const named = tx.counterName?.trim() || "";
  const someone = (name: string) => name !== "" && isCounterpartyName(name) && !mentionsOwnName(name, ctx.ownNames);
  if (tx.amount > 0) return someone(named || (FROM_PREFIX.test(d) ? d.replace(FROM_PREFIX, "").trim() : ""));
  const iban = tx.counterIban?.trim();
  return cardTail(named || d) !== null || (!!iban && !ctx.ownIbans.has(iban)) || someone(named);
}

export const typeCategory = (type: TxType): Category => {
  switch (type) {
    case "tax": return "tax";
    case "debt_payment": return "debt";
    case "loan_in": return "loan";
    case "own_transfer":
    case "goal_contribution": return "own";
    case "cash_in":
    case "cash_out": return "cash";
    case "income": return "income";
    case "person_transfer":
    case "person_in":
    case "loan_out":
    case "obligation": return "transfer";
    case "spend": return "uncategorized";
  }
};

/**
 * Type first, then category (design §5.5): owner rules, exact bank texts and own accounts,
 * MCC and known chains, otherwise a labelled fallback. Pure; the same input gives the same answer.
 */
export function classify(tx: ClassifyInput, ctx: ClassifyContext): ClassifyResult {
  const d = tx.description.trim();
  const incoming = tx.amount > 0;
  const mcc = tx.mcc;

  const done = (
    type: TxType,
    source: ClassifyResult["source"] = "rule",
    category: string = typeCategory(type),
    needsLabel = false,
  ): ClassifyResult => ({ type, category, source, needsLabel });
  // A question needs someone to ask about: a bank template stays a plain transfer.
  const hasName = isCounterpartyName(tx.counterName?.trim() || d);
  // Б10: an outgoing transfer with no other leg here and no name, to one known destination (a masked
  // card, an account number), may be the owner's own card at another bank: it is asked about rather
  // than spent in silence. A bank template alone names no destination, and one answer about it would
  // relabel every such transfer, so it stays unasked.
  const knownDestination = !!tx.counterIban?.trim() || cardTail(tx.counterName?.trim() || d) !== null;
  const asks = hasName || (!incoming && mcc !== null && TRANSFER_MCCS.has(mcc) && knownDestination);

  // 1. Owner rules. A withdrawal stays a withdrawal unless the rule itself says cash_out: a rule
  // made from a purchase in a shop must not swallow the cash taken at its till.
  const withdrawal = isWithdrawal(tx);
  for (const rule of ctx.rules) {
    if (withdrawal && rule.type !== "cash_out") continue;
    if (ruleMatches(rule, tx)) return done(rule.type, "owner", rule.category ?? typeCategory(rule.type));
  }

  // 2. Own accounts, jars and fop
  const ownIban = !!tx.counterIban && ctx.ownIbans.has(tx.counterIban);
  // Money in from the owner himself: «Від: <own name>» in the description, or (Б38) his name in the bank's
  // counterparty field alone. Every word of an own name must be there, so a namesake client is not caught.
  const fromOwnName =
    (FROM_PREFIX.test(d) && mentionsOwnName(d, ctx.ownNames)) ||
    (incoming && mentionsOwnName(tx.counterName ?? "", ctx.ownNames));
  const jarTopup = JAR_TOPUP.exec(d);
  const ownJarTopup = !!jarTopup && ctx.ownJars.some((j) => lc(j) === lc(jarTopup[1] ?? ""));
  if (
    ownIban ||
    OWN_CARD.test(d) ||
    fromOwnName ||
    JAR_PAYOUT.test(d) ||
    ownJarTopup ||
    MIGRATION.test(d) ||
    (incoming && FOP_WITHDRAWAL.test(d)) ||
    (!incoming && FOP_TO_HRYVNIA.test(d)) ||
    (tx.pairedOwnTransfer === true && mcc !== null && TRANSFER_MCCS.has(mcc))
  ) {
    return done("own_transfer");
  }

  if (!incoming && TAX.test(d)) return done("tax");

  // 2b. Loans, debts, cash, cashback
  if (LOAN_TEXT.test(d) && !INSTALLMENT_PAYMENT.test(d)) return done(incoming ? "loan_in" : "debt_payment");
  if (!incoming && (INSTALLMENT_PAYMENT.test(d) || INTEREST.test(d) || PENALTY.test(d))) return done("debt_payment");
  if (!incoming && mcc === 4829 && STORE_INSTALLMENT.test(d)) return done("spend", "rule", "shopping");
  if (withdrawal) return done("cash_out");
  if (isCashDeposit(tx)) return done("cash_in");
  if (incoming && CASHBACK.test(d)) return done("income", "rule", "refund");

  // A bank refund text is a refund whatever its MCC (transfer MCC 4829 included) and whatever the
  // account: on the fop account it is checked before "incoming is income", so a refund does not
  // enter the tax base. A refund of a transfer is not a refund, and stays with the fop and people
  // rules below.
  if (incoming && REFUND.test(d) && !REFUND_OF_TRANSFER.test(d)) {
    // A shop we do not know is still a refund: it lowers that day's spending and asks nothing.
    const known = categoryByMerchant(d) ?? categoryByMcc(mcc);
    return done("spend", "auto", known === "uncategorized" ? "refund" : known);
  }

  // A business (ФОП, ТОВ) sending money with the comment «Повернення коштів …» is cancelling an
  // order: a refund, exactly as the bank's own refund text above, on every account kind. The rule
  // is deliberately narrow: the same comment from a person stays money from a person.
  const sender = (tx.counterName?.trim() || d.replace(FROM_PREFIX, "")).trim();
  if (incoming && ORDER_REFUND_COMMENT.test((tx.comment ?? "").trim()) && BUSINESS_SENDER.test(sender)) {
    const known = categoryByMerchant(sender) ?? categoryByMcc(mcc);
    return done("spend", "auto", known === "uncategorized" ? "refund" : known);
  }

  if (tx.accountKind === "fop") {
    if (incoming) return done("income");
    if (mcc === null || TRANSFER_MCCS.has(mcc)) return done("person_transfer", "auto", "transfer", asks);
  }

  // 3. MCC and chains
  if (isPurchaseMcc(mcc) || (mcc === null && !FROM_PREFIX.test(d) && (!incoming || REFUND.test(d)))) {
    const category = categoryByMerchant(d) ?? categoryByMcc(mcc);
    return done("spend", "auto", category === "uncategorized" ? "uncategorized" : category);
  }

  // Money movement left over: people
  if (incoming) return done("person_in", "auto", "transfer", mcc === null);
  return done("person_transfer", "auto", "transfer", asks);
}

export interface PairCandidate {
  id: number | string;
  accountId: number;
  /** Epoch milliseconds. */
  at: number;
  amount: number;
}

/**
 * Ids of rows that have an opposite-sign row of the same amount on a different account within
 * `windowMs`: the two legs of a transfer between the owner's own accounts.
 */
export function findOwnPairs(rows: readonly PairCandidate[], windowMs = 10 * 60_000): Set<number | string> {
  const byAmount = new Map<number, PairCandidate[]>();
  for (const r of rows) {
    const key = Math.abs(r.amount);
    const list = byAmount.get(key);
    if (list) list.push(r);
    else byAmount.set(key, [r]);
  }
  const paired = new Set<number | string>();
  for (const list of byAmount.values()) {
    for (const a of list) {
      if (a.amount > 0) continue;
      const b = list.find(
        (o) => o.amount === -a.amount && o.accountId !== a.accountId && Math.abs(o.at - a.at) <= windowMs,
      );
      if (b) {
        paired.add(a.id);
        paired.add(b.id);
      }
    }
  }
  return paired;
}
