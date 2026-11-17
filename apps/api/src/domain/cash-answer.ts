/**
 * The answer to «Откуда наличные?» about a cash deposit at a terminal (task Б21): which one it is, and
 * whether the server kept what it did, so that changing it undoes exactly that.
 */
import { isCashDeposit } from "./classify";

export type CashAnswerName = "wallet" | "binance" | "other";

export interface CashAnswerFacts {
  type: string | null;
  /** Signed minor units; positive is money in. */
  amount: number;
  mcc: number | null;
  description: string;
  accountKind: string;
  /** YYYY-MM-DD. */
  localDate: string;
  /** The wallet's first day, null while there is no wallet. */
  cashStart: string | null;
  fromWallet: boolean;
  usdcChecked: boolean;
  /** An income event names this row as its money (income_events.matched_transaction_id). */
  incomeMatched: boolean;
  /** The answer kept in cash_answers; null for none, or for one given before answers were kept. */
  stored: { answer: CashAnswerName; typeBefore: string | null; binanceCents: number } | null;
}

export interface CashAnswer {
  answer: CashAnswerName;
  /** False for an answer given before answers were kept: what it took off Binance is not known. */
  stored: boolean;
  /** Cents a kept «Вывод с Binance» actually took off the Binance balance; 0 otherwise. */
  binanceCents: number;
}

/** A deposit the question is about: money in on a bank account (not a jar), since the wallet start. */
const sinceStart = (f: CashAnswerFacts): boolean =>
  f.cashStart !== null && f.localDate >= f.cashStart && f.amount > 0 && f.accountKind !== "jar" && f.accountKind !== "cash";

/**
 * The answer about this cash deposit, null when it is not an answered cash deposit since the wallet
 * start. One given before answers were kept is read from the row: from the wallet it is marked so;
 * from Binance it became an own transfer matched to an income, with a terminal's text; «Другое» left
 * a cash deposit that is no longer asked about.
 */
export function cashAnswerOf(f: CashAnswerFacts): CashAnswer | null {
  if (!sinceStart(f)) return null;
  if (f.stored) {
    return f.stored.typeBefore === "cash_in" ? { answer: f.stored.answer, stored: true, binanceCents: f.stored.binanceCents } : null;
  }
  const earlier = (answer: CashAnswerName): CashAnswer => ({ answer, stored: false, binanceCents: 0 });
  if (f.fromWallet) return earlier("wallet");
  if (f.type === "own_transfer" && f.usdcChecked && f.incomeMatched && isCashDeposit(f)) return earlier("binance");
  if (f.type === "cash_in" && f.usdcChecked) return earlier("other");
  return null;
}

/** The answer can be given or changed from the operation's card: a cash deposit since the start. */
export const isAnswerableDeposit = (f: CashAnswerFacts): boolean =>
  cashAnswerOf(f) !== null || (sinceStart(f) && f.type === "cash_in");

/**
 * What changing a «Вывод с Binance» answer does to the Binance balance: "returns" what the answer took,
 * or leaves it "untouched" for an answer given before answers were kept. null otherwise.
 */
export function binanceOnChange(a: CashAnswer | null): "returns" | "untouched" | null {
  if (a?.answer !== "binance") return null;
  if (!a.stored) return "untouched";
  return a.binanceCents !== 0 ? "returns" : null;
}

/**
 * Kopecks an answer «Из кошелька» takes off the shortfall («Не записано», a positive amount here) of the first
 * count of the pocket after the deposit (task Б40): that count already found the deposited cash missing, so the
 * wallet must not lose it a second time. Never more than the deposit or the shortfall; nothing without either.
 */
export const countAbsorbed = (deposit: number, shortfall: number): number => Math.max(0, Math.min(deposit, shortfall));
