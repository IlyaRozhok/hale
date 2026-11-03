import { describe, expect, it } from "vitest";
import { txType } from "@hale/contracts";
import { categoryLabel, LABEL_CHOICES, SPEND_CATEGORIES, typeLabel } from "./labels";

describe("labels", () => {
  it("names every transaction type in Russian", () => {
    for (const t of txType.options) expect(typeLabel(t)).toMatch(/^[А-Яа-яЁё ]+$/);
    expect(typeLabel(null)).toBe("Не определён");
    expect(typeLabel("person_transfer")).toBe("Перевод человеку");
  });

  it("names categories in Russian and falls back to the raw name", () => {
    expect(categoryLabel("groceries")).toBe("Продукты");
    expect(categoryLabel("cafe")).toBe("Кафе и рестораны");
    expect(categoryLabel(null)).toBe("Без категории");
    expect(categoryLabel("custom_thing")).toBe("custom_thing");
    for (const c of SPEND_CATEGORIES) expect(categoryLabel(c)).toMatch(/^[А-Яа-яЁё ]+$/);
  });

  it("offers the five recipient answers in the spec's order", () => {
    expect(LABEL_CHOICES.map((c) => c.label)).toEqual(["shared_budget", "help", "debt_repayment", "one_off", "obligation"]);
    expect(LABEL_CHOICES.map((c) => c.text)).toEqual(["Общий бюджет", "Помощь", "Возврат долга", "Разово", "Обязательное"]);
  });
});
