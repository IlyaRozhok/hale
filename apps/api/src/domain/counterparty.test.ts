import { describe, expect, it } from "vitest";
import { isCounterpartyName, transfersWord } from "./counterparty";

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
