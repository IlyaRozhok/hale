import { describe, expect, it } from "vitest";
import { cardTail, isCounterpartyName, transfersWord, unnamedTransferQuestion } from "./counterparty";

describe("isCounterpartyName", () => {
  it.each(["Таечка", "Дар'я М.", "Габунія Галина Федорівна", "John Smith", "Ангеліна Ш."])("accepts a name: %s", (label) => {
    expect(isCounterpartyName(label)).toBe(true);
  });

  it.each(["Переказ Тая М.", "Перевод Анне", "Поповнення Іванов І."])("keeps a name that follows a generic word: %s", (label) => {
    expect(isCounterpartyName(label)).toBe(true);
  });

  it.each([
    "",
    "   ",
    null,
    "Переказ на картку",
    "переказ на картку monobank",
    "Переказ коштів",
    "Перевод на карту",
    "545708****4563",
    "5457 08** **** 4563",
    "**** 4563",
    "Поповнення «На дитяче свято»",
    "Поповнення рахунку",
    "Пополнение счёта",
  ])("rejects bank text: %s", (label) => {
    expect(isCounterpartyName(label)).toBe(false);
  });
});

describe("transfersWord", () => {
  it.each([
    [1, "перевод"], [2, "перевода"], [4, "перевода"], [5, "переводов"], [11, "переводов"], [14, "переводов"], [21, "перевод"], [22, "перевода"], [96, "переводов"], [101, "перевод"], [111, "переводов"],
  ])("%i %s", (n, word) => {
    expect(transfersWord(n)).toBe(word);
  });
});

describe("cardTail", () => {
  it.each([
    ["545708****4563", "*4563"],
    ["5457 08** **** 4563", "*4563"],
    ["**** 4563", "*4563"],
    ["*4563", "*4563"],
  ])("shortens a masked card: %s", (label, tail) => {
    expect(cardTail(label)).toBe(tail);
  });

  it.each(["Переказ на картку", "Таечка", "4563****", ""])("leaves anything else alone: %s", (label) => {
    expect(cardTail(label)).toBeNull();
  });
});

describe("unnamedTransferQuestion (Б10)", () => {
  it("names a masked card by its last digits", () => {
    expect(unnamedTransferQuestion(" 545708****4563 ", 1, "₴5,000", "12.11")).toEqual({
      subject: "Карта *4563",
      text: "Перевод ₴5,000 на карту *4563 (12.11)",
    });
    expect(unnamedTransferQuestion("545708****4563", 3, "₴12,000", "12.11")).toEqual({
      subject: "Карта *4563",
      text: "3 перевода на карту *4563, ₴12,000, последний 12.11",
    });
  });

  it("gives any other bank text as it is", () => {
    expect(unnamedTransferQuestion("Переказ на картку", 1, "₴50", "15.11")).toEqual({
      subject: "Переказ на картку",
      text: "Перевод ₴50 (15.11): Переказ на картку",
    });
    expect(unnamedTransferQuestion("Поповнення «На свято»", 5, "₴250", "15.11")).toEqual({
      subject: "Поповнення «На свято»",
      text: "5 переводов, ₴250, последний 15.11: Поповнення «На свято»",
    });
  });
});
