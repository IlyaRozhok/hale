import { describe, expect, it } from "vitest";
import { recipientLabelName, txType } from "@hale/contracts";
import { answerText, categoryLabel, LABEL_CHOICES, SPEND_CATEGORIES, typeLabel } from "./labels";

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

  it("offers the transfer answers, each saying what it does to the limit", () => {
    expect(LABEL_CHOICES.map((c) => c.label)).toEqual(["close_regular", "one_off", "service", "debt_repayment", "lend", "own_account", "skip"]);
    for (const c of LABEL_CHOICES) expect(c.effect).toMatch(/лимит|не расход/i);
  });

  it("names any answer, the earlier ones too", () => {
    for (const label of recipientLabelName.options) expect(answerText(label)).toMatch(/^[А-Яа-яЁё ,]+$/);
    expect(answerText("shared_budget")).toBe(answerText("close_regular"));
    expect(answerText("help")).toBe(answerText("one_off"));
    expect(answerText(null)).toBe("не указано");
  });
});
