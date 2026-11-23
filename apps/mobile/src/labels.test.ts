import { describe, expect, it } from "vitest";
import { recipientLabelName, txType } from "@hale/contracts";
import {
  accountChoices, accountLabel, limitFact, alwaysCountText, balanceFieldLabel, NEW_ACCOUNT_CURRENCIES, answerChoices, answerText, categoryChoices, categoryLabel, categoryName, deleteCategoryText, FREQUENT_ANSWERS, LABEL_CHOICES, recipientLine, SPEND_CATEGORIES, TYPE_CHOICES, typeChips,
  typeLabel, usualWantText, wantLabel,
} from "./labels";

describe("labels", () => {
  it("names every transaction type in Russian", () => {
    for (const t of txType.options) expect(typeLabel(t)).toMatch(/^[А-Яа-яЁё ]+$/);
    expect(typeLabel(null)).toBe("Не определён");
    expect(typeLabel("person_transfer")).toBe("Перевод человеку");
  });

  it("reads a type this app does not know (from a newer server) as no type, never as an empty name", () => {
    expect(typeLabel("something_new" as never)).toBe(typeLabel(null));
  });

  it("names categories in Russian and falls back to the raw name", () => {
    expect(categoryLabel("groceries")).toBe("Продукты");
    expect(categoryLabel("cafe")).toBe("Кафе и рестораны");
    expect(categoryLabel(null)).toBe("Без категории");
    expect(categoryLabel("custom_thing")).toBe("custom_thing");
    for (const c of SPEND_CATEGORIES) expect(categoryLabel(c)).toMatch(/^[А-Яа-яЁё ]+$/);
  });

  it("takes the server's category names and order, and the built-in ones from an older server (В5)", () => {
    const list = [
      { key: "cafe", name: "Кафе", icon: "coffee" as const, system: false },
      { key: "c_1", name: "Кот", icon: "paw" as const, system: false },
      { key: "uncategorized", name: "Без категории", icon: "circle" as const, system: true },
    ];
    expect(categoryChoices(list)).toEqual([
      { key: "cafe", name: "Кафе" },
      { key: "c_1", name: "Кот" },
      { key: "uncategorized", name: "Без категории" },
    ]);
    expect(categoryChoices(undefined).map((c) => c.key)).toEqual([...SPEND_CATEGORIES]);
    expect(categoryChoices(null)[0]).toEqual({ key: "groceries", name: "Продукты" });
    expect(categoryName("c_1", list)).toBe("Кот");
    expect(categoryName("cafe", list)).toBe("Кафе");
    // A key the list does not know (a type-level one, or a deleted category) keeps today's name.
    expect(categoryName("tax", list)).toBe("Налоги");
    expect(categoryName("cash", list)).toBe("Наличные");
    expect(categoryName(null, list)).toBe("Без категории");
    expect(categoryName("groceries", undefined)).toBe("Продукты");
  });

  it("says how many more operations «Да, всегда» would change, in whole phrases", () => {
    expect(alwaysCountText(24, "Продукты")).toBe("Ещё 23 операции станут «Продукты»");
    expect(alwaysCountText(2, "Кафе")).toBe("Ещё 1 операция станет «Кафе»");
    expect(alwaysCountText(6, "Кафе")).toBe("Ещё 5 операций станут «Кафе»");
    expect(alwaysCountText(22, "Кафе")).toBe("Ещё 21 операция станет «Кафе»");
    expect(alwaysCountText(1, "Кафе")).toBeNull();
    expect(alwaysCountText(0, "Кафе")).toBeNull();
  });

  it("says what deleting a category does to its operations", () => {
    expect(deleteCategoryText(14, "Без категории")).toBe("Операции этой категории (14) станут «Без категории».");
    expect(deleteCategoryText(null, "Без категории")).toBe("Операции этой категории станут «Без категории».");
    expect(deleteCategoryText(0, "Без категории")).toBe("В этой категории нет операций.");
  });

  it("offers the transfer answers, each saying what it does to the limit", () => {
    expect(LABEL_CHOICES.map((c) => c.label)).toEqual(["close_regular", "one_off", "service", "debt_repayment", "lend", "own_account", "skip"]);
    for (const c of LABEL_CHOICES) expect(c.effect).toMatch(/лимит|не расход/i);
  });

  it("offers three transfer answers at once, the other four behind", () => {
    expect(FREQUENT_ANSWERS).toEqual(["close_regular", "service", "own_account"]);
    const fresh = answerChoices(null);
    expect(fresh.shown.map((c) => c.label)).toEqual(["close_regular", "service", "own_account"]);
    expect(fresh.rest.map((c) => c.label)).toEqual(["one_off", "debt_repayment", "lend", "skip"]);
    expect(answerChoices("service")).toEqual(fresh);
    // The texts are the ones the full list has.
    for (const c of [...fresh.shown, ...fresh.rest]) expect(LABEL_CHOICES).toContain(c);
  });

  it("keeps a rare answer given before in sight", () => {
    const rare = answerChoices("lend");
    expect(rare.shown.map((c) => c.label)).toEqual(["close_regular", "service", "own_account", "lend"]);
    expect(rare.rest.map((c) => c.label)).toEqual(["one_off", "debt_repayment", "skip"]);
    // An earlier answer that is no longer offered adds nothing.
    for (const old of ["shared_budget", "help", "obligation"] as const) expect(answerChoices(old)).toEqual(answerChoices(null));
  });

  it("says who the transfers went to and how much, in one line", () => {
    expect(recipientLine("Олена К.", { count: 3, total: 450_000 })).toBe("Олена К. · 3 перевода, ₴4,500");
    expect(recipientLine("Иван", { count: 1, total: 50_000 })).toBe("Иван · 1 перевод, ₴500");
    expect(recipientLine("Иван", { count: 5, total: 100_000 })).toBe("Иван · 5 переводов, ₴1,000");
    expect(recipientLine("Иван", { count: 11, total: 100_000 })).toBe("Иван · 11 переводов, ₴1,000");
    expect(recipientLine("Иван", { count: 22, total: 100_000 })).toBe("Иван · 22 перевода, ₴1,000");
    expect(recipientLine("Иван", undefined)).toBe("Иван");
    expect(recipientLine(undefined, { count: 3, total: 450_000 })).toBe("3 перевода, ₴4,500");
    expect(recipientLine(undefined, undefined)).toBeUndefined();
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

  it("offers the person's accounts to filter by, by name, leaving out a kind it cannot name (Д1)", () => {
    expect(accountChoices(["black", "white", "fop", "cash"])).toEqual([
      { kind: "black", name: "Чёрная карта" },
      { kind: "white", name: "Белая карта" },
      { kind: "fop", name: "Счёт ФОП" },
      { kind: "cash", name: "Наличные" },
    ]);
    expect(accountChoices(["white", "jar", "something_new"])).toEqual([{ kind: "white", name: "Белая карта" }]);
    expect(accountChoices([])).toEqual([]);
    expect(accountChoices(undefined)).toEqual([]);
  });

  it("names the balance field of an account kept by hand by its currency, as one phrase (Д2б)", () => {
    expect(balanceFieldLabel("UAH")).toBe("Остаток, ₴");
    expect(balanceFieldLabel("USD")).toBe("Остаток, $");
    expect(balanceFieldLabel("EUR")).toBe("Остаток, €");
    expect(balanceFieldLabel("PLN")).toBe("Остаток, PLN");
  });

  it("offers hryvnias, dollars and euros for a new account (Д2б)", () => {
    expect(NEW_ACCOUNT_CURRENCIES).toEqual([
      { code: "UAH", label: "₴" },
      { code: "USD", label: "$" },
      { code: "EUR", label: "€" },
    ]);
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

  it("does not offer a type this app has no name for", () => {
    // A newer server may send a type the app does not know: it is treated like no type at all.
    const unknown = typeChips(-100, "something_new" as never);
    expect(unknown).toEqual(typeChips(-100, null));
  });
});

describe("«нужное» и «желаемое» (В6)", () => {
  it("names the two sides", () => {
    expect(wantLabel(false)).toBe("Нужное");
    expect(wantLabel(true)).toBe("Для себя");
  });

  it("says a category's usual side as a whole phrase", () => {
    expect(usualWantText("Покупки", true)).toBe("Для «Покупки» обычно — для себя");
    expect(usualWantText("Продукты", false)).toBe("Для «Продукты» обычно — нужное");
  });

  describe("limitFact: whether the operation counts in the day's limit (ЯМ3)", () => {
    const row = (over: Partial<Parameters<typeof limitFact>[0]>) =>
      limitFact({ type: "spend", amountUah: -15_000, accountKind: "black", inLimit: true, ...over });

    it("a row the limit counts says so", () => {
      expect(row({})).toEqual({ text: "Считается в лимите дня", icon: "check" });
      expect(row({ type: "person_transfer" })).toEqual({ text: "Считается в лимите дня", icon: "check" });
    });

    it("an own transfer is outside the limit, between own money", () => {
      expect(row({ type: "own_transfer", inLimit: false })).toEqual({ text: "Не в лимите — между своими", icon: "transfer" });
      expect(row({ type: "own_transfer", inLimit: false, amountUah: 15_000 })?.text).toBe("Не в лимите — между своими");
    });

    it("money going out of the limit by its kind, each a whole phrase", () => {
      const cases: [Parameters<typeof limitFact>[0]["type"], string][] = [
        ["obligation", "Не в лимите — обязательный платёж"],
        ["tax", "Не в лимите — налог"],
        ["debt_payment", "Не в лимите — платёж по долгу"],
        ["cash_out", "Не в лимите — деньги перешли в наличные"],
        ["goal_contribution", "Не в лимите — взнос в цель"],
        ["loan_out", "Не в лимите — вы дали в долг"],
      ];
      for (const [type, text] of cases) expect(row({ type, inLimit: false })).toEqual({ text, icon: "circle" });
    });

    it("says nothing where it has no plain reason: money in, a jar, no rate, an uncounted purchase, no type", () => {
      for (const type of ["income", "person_in", "loan_in", "cash_in"] as const) expect(row({ type, inLimit: false, amountUah: 50_000 })).toBeNull();
      expect(row({ type: "obligation", inLimit: false, accountKind: "jar" })).toBeNull();
      expect(row({ type: "tax", inLimit: false, amountUah: null })).toBeNull();
      expect(row({ type: "spend", inLimit: false })).toBeNull();
      expect(row({ type: "person_transfer", inLimit: false })).toBeNull();
      expect(row({ type: null, inLimit: false })).toBeNull();
      expect(row({ type: "something_new" as never, inLimit: false })).toBeNull();
    });

    it("an older server without the field: nothing", () => {
      expect(row({ inLimit: undefined })).toBeNull();
      expect(row({ type: "own_transfer", inLimit: undefined })).toBeNull();
    });
  });
});
