import { describe, expect, it } from "vitest";
import { type CashAnswerFacts, binanceOnChange, cashAnswerOf, isAnswerableDeposit } from "./cash-answer";
import { isCashDeposit } from "./classify";

const facts = (over: Partial<CashAnswerFacts> = {}): CashAnswerFacts => ({
  type: "cash_in",
  amount: 2_950_000,
  mcc: 4829,
  description: "Термінал City24",
  accountKind: "white",
  localDate: "2026-11-15",
  cashStart: "2026-11-10",
  fromWallet: false,
  usdcChecked: false,
  incomeMatched: false,
  stored: null,
  ...over,
});
const stored = (answer: "wallet" | "binance" | "other", binanceCents = 0, typeBefore: string | null = "cash_in") => ({
  answer,
  typeBefore,
  binanceCents,
});

describe("isCashDeposit", () => {
  it("is money paid in at a terminal, as the classifier sees it", () => {
    expect(isCashDeposit({ amount: 100, mcc: 4829, description: "Термінал EasyPay" })).toBe(true);
    expect(isCashDeposit({ amount: 100, mcc: 4829, description: "Від: Олена" })).toBe(false);
    expect(isCashDeposit({ amount: 100, mcc: 4829, description: "City24" })).toBe(true);
    expect(isCashDeposit({ amount: 100, mcc: 4829, description: "  термінал" })).toBe(true);
    expect(isCashDeposit({ amount: -100, mcc: 4829, description: "Термінал EasyPay" })).toBe(false);
    expect(isCashDeposit({ amount: 100, mcc: 6011, description: "Термінал EasyPay" })).toBe(false);
    expect(isCashDeposit({ amount: 100, mcc: null, description: "Термінал EasyPay" })).toBe(false);
  });
});

describe("cashAnswerOf: a stored answer", () => {
  it("is the answer about a cash deposit since the wallet start", () => {
    expect(cashAnswerOf(facts({ type: "own_transfer", fromWallet: true, stored: stored("wallet") }))).toEqual({
      answer: "wallet", stored: true, binanceCents: 0,
    });
    expect(cashAnswerOf(facts({ type: "own_transfer", stored: stored("binance", 73_750) }))).toEqual({
      answer: "binance", stored: true, binanceCents: 73_750,
    });
    expect(cashAnswerOf(facts({ usdcChecked: true, stored: stored("other") }))).toEqual({ answer: "other", stored: true, binanceCents: 0 });
  });

  it("about a card credit is not a cash deposit's answer", () => {
    expect(cashAnswerOf(facts({ type: "own_transfer", stored: stored("binance", 100, "person_in") }))).toBeNull();
  });
});

describe("cashAnswerOf: a row answered before answers were kept", () => {
  it("from the wallet: the row says so itself", () => {
    expect(cashAnswerOf(facts({ type: "own_transfer", fromWallet: true, usdcChecked: true }))).toEqual({
      answer: "wallet", stored: false, binanceCents: 0,
    });
  });

  it("from Binance: an own transfer matched to an income, with a terminal's text", () => {
    const binance = facts({ type: "own_transfer", usdcChecked: true, incomeMatched: true });
    expect(cashAnswerOf(binance)).toEqual({ answer: "binance", stored: false, binanceCents: 0 });
    expect(cashAnswerOf({ ...binance, incomeMatched: false })).toBeNull();
    expect(cashAnswerOf({ ...binance, usdcChecked: false })).toBeNull();
    // A card credit withdrawn from Binance is not a cash deposit.
    expect(cashAnswerOf({ ...binance, mcc: null, description: "Від: Binance" })).toBeNull();
  });

  it("«Другое»: still a cash deposit, but no longer asked about", () => {
    expect(cashAnswerOf(facts({ usdcChecked: true }))).toEqual({ answer: "other", stored: false, binanceCents: 0 });
    expect(cashAnswerOf(facts())).toBeNull();
  });
});

describe("cashAnswerOf: only deposits the question is about", () => {
  it("not before the wallet start, not without a wallet, not on a jar or the wallet itself, not money out", () => {
    const answered = { type: "own_transfer", fromWallet: true };
    expect(cashAnswerOf(facts({ ...answered, localDate: "2026-11-09" }))).toBeNull();
    expect(cashAnswerOf(facts({ ...answered, localDate: "2026-11-10" }))).not.toBeNull();
    expect(cashAnswerOf(facts({ ...answered, cashStart: null }))).toBeNull();
    expect(cashAnswerOf(facts({ ...answered, accountKind: "jar" }))).toBeNull();
    expect(cashAnswerOf(facts({ ...answered, accountKind: "cash" }))).toBeNull();
    expect(cashAnswerOf(facts({ ...answered, amount: -100 }))).toBeNull();
  });
});

describe("isAnswerableDeposit", () => {
  it("an unanswered cash deposit since the start, or one with an answer", () => {
    expect(isAnswerableDeposit(facts())).toBe(true);
    expect(isAnswerableDeposit(facts({ type: "own_transfer", fromWallet: true }))).toBe(true);
    expect(isAnswerableDeposit(facts({ type: "spend" }))).toBe(false);
    expect(isAnswerableDeposit(facts({ localDate: "2026-11-01" }))).toBe(false);
  });
});

describe("binanceOnChange", () => {
  it("a kept Binance answer gives back what it took; an earlier one leaves Binance alone", () => {
    expect(binanceOnChange({ answer: "binance", stored: true, binanceCents: 73_750 })).toBe("returns");
    expect(binanceOnChange({ answer: "binance", stored: true, binanceCents: 0 })).toBeNull();
    expect(binanceOnChange({ answer: "binance", stored: false, binanceCents: 0 })).toBe("untouched");
    expect(binanceOnChange({ answer: "wallet", stored: false, binanceCents: 0 })).toBeNull();
    expect(binanceOnChange({ answer: "other", stored: true, binanceCents: 0 })).toBeNull();
    expect(binanceOnChange(null)).toBeNull();
  });
});
