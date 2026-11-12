import { describe, expect, it } from "vitest";
import { recipientLabelName, txType } from "@hale/contracts";
import { accountLabel, answerText, categoryLabel, LABEL_CHOICES, SPEND_CATEGORIES, TYPE_CHOICES, typeChips, typeLabel } from "./labels";

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

  it("names the accounts it knows and says nothing about the others", () => {
    expect(accountLabel("black")).toBe("Чёрная карта");
    expect(accountLabel("white")).toBe("Белая карта");
    expect(accountLabel("fop")).toBe("Счёт ФОП");
    expect(accountLabel("jar")).toBe("Банка");
    expect(accountLabel("cash")).toBe("Наличные");
    expect(accountLabel("something_new")).toBeNull();
    expect(accountLabel("toString")).toBeNull();
  });

  it("offers the frequent types by where the money goes, the rest behind", () => {
    const out = typeChips(-100, "spend");
    expect(out.shown).toEqual(["spend", "obligation", "own_transfer", "person_transfer"]);
    const into = typeChips(100, "income");
    expect(into.shown).toEqual(["income", "person_in", "own_transfer"]);
    expect(typeChips(0, null).shown).toEqual(into.shown);
    for (const { shown, rest } of [out, into]) {
      expect([...shown, ...rest].sort()).toEqual([...TYPE_CHOICES].sort());
      expect(rest).toEqual(TYPE_CHOICES.filter((t) => !shown.includes(t)));
    }
  });

  it("keeps the row's own type in sight when it is not a frequent one", () => {
    const rare = typeChips(-100, "debt_payment");
    expect(rare.shown).toEqual(["spend", "obligation", "own_transfer", "person_transfer", "debt_payment"]);
    expect(rare.rest).not.toContain("debt_payment");
    expect(rare.rest).toHaveLength(TYPE_CHOICES.length - 5);
    // An outgoing type on money coming in is rare there.
    expect(typeChips(100, "spend").shown).toEqual(["income", "person_in", "own_transfer", "spend"]);
    expect(typeChips(-100, null).shown).toHaveLength(4);
  });
});
