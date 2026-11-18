import { describe, expect, it } from "vitest";
import { classify, findOwnPairs, hasThirdParty, isWeakRuleValue, ruleMatches, type ClassifyContext, type ClassifyInput } from "./classify";

const ctx = (over: Partial<ClassifyContext> = {}): ClassifyContext => ({
  ownIbans: new Set(["UA00OWN0001"]),
  ownNames: ["Test Owner"],
  ownJars: ["Trip"],
  rules: [],
  ...over,
});

const tx = (over: Partial<ClassifyInput> = {}): ClassifyInput => ({
  amount: -10000,
  mcc: null,
  description: "",
  accountKind: "black",
  ...over,
});

describe("classify order", () => {
  it("owner rule beats every built-in rule", () => {
    const c = ctx({
      rules: [{ matchKind: "merchant", matchValue: "кредит до завтра на 7 днів", type: "spend", category: "other" }],
    });
    const r = classify(tx({ description: "Кредит До завтра на 7 днів", amount: 50000, mcc: 4829 }), c);
    expect(r).toMatchObject({ type: "spend", category: "other", source: "owner", needsLabel: false });
  });

  it("owner rule matches by iban and by recipient", () => {
    const c = ctx({
      rules: [
        { matchKind: "iban", matchValue: "UA11X", type: "obligation", category: "rent" },
        { matchKind: "recipient", matchValue: "landlord", type: "obligation", category: "rent" },
      ],
    });
    expect(classify(tx({ counterName: "Mr Landlord", mcc: 4829, description: "Тест Тестовий" }), c).type).toBe("person_transfer");
    expect(classify(tx({ counterIban: "UA11X", mcc: 4829 }), c).type).toBe("obligation");
    expect(classify(tx({ counterName: "  LANDLORD ", mcc: 4829 }), c).type).toBe("obligation");
    expect(classify(tx({ counterName: "Other", mcc: 4829, description: "Тест Тестовий" }), c).type).toBe(
      "person_transfer",
    );
  });
});

describe("own money", () => {
  it("transfers between own cards and banks are own_transfer", () => {
    expect(classify(tx({ description: "З Білої картки", amount: 10000, mcc: 4829 }), ctx()).type).toBe("own_transfer");
    expect(classify(tx({ description: "Від: Owner Test", amount: 10000, mcc: 4829 }), ctx()).type).toBe("own_transfer");
    expect(classify(tx({ counterIban: "UA00OWN0001", mcc: 4829 }), ctx()).type).toBe("own_transfer");
    expect(classify(tx({ description: "Часткове зняття банки «Trip»", amount: 10000, mcc: 4829 }), ctx()).type).toBe(
      "own_transfer",
    );
    expect(classify(tx({ description: "Поповнення «Trip»", mcc: 4829 }), ctx()).type).toBe("own_transfer");
  });

  describe("own name only in the bank's counterparty field (Б38)", () => {
    it("money in on the fop account from the owner is own_transfer, not income", () => {
      const r = classify(
        tx({ accountKind: "fop", amount: 500_000, mcc: 4829, description: "Переказ коштів", counterName: "OWNER TEST" }),
        ctx(),
      );
      expect(r).toMatchObject({ type: "own_transfer", category: "own", needsLabel: false });
    });

    it("the same on a black card is own_transfer", () => {
      const r = classify(tx({ amount: 500_000, mcc: 4829, description: "Переказ коштів", counterName: "Test Owner" }), ctx());
      expect(r.type).toBe("own_transfer");
    });

    it("a client who shares only the first name is still income on the fop account", () => {
      const r = classify(
        tx({ accountKind: "fop", amount: 500_000, mcc: 4829, description: "Оплата послуг", counterName: "Test Client" }),
        ctx(),
      );
      expect(r.type).toBe("income");
    });

    it("an owner rule still wins over the own name", () => {
      const c = ctx({ rules: [{ matchKind: "recipient", matchValue: "Test Owner", type: "income", category: "income" }] });
      const r = classify(tx({ accountKind: "fop", amount: 500_000, mcc: 4829, description: "Переказ", counterName: "Test Owner" }), c);
      expect(r).toMatchObject({ type: "income", source: "owner" });
    });

    it("outgoing money to the owner's name is not changed by this rule", () => {
      const r = classify(tx({ amount: -500_000, mcc: 4829, description: "Переказ", counterName: "Test Owner" }), ctx());
      expect(r.type).toBe("person_transfer");
    });
  });

  it("an outgoing card transfer paired with an opposite row on another own account is own_transfer", () => {
    const base = tx({ description: "Переказ на картку", mcc: 4829 });
    expect(classify(base, ctx()).type).toBe("person_transfer");
    expect(classify({ ...base, pairedOwnTransfer: true }, ctx()).type).toBe("own_transfer");
  });

  it("income on the fop account is income, fop to card is own_transfer", () => {
    expect(classify(tx({ accountKind: "fop", amount: 500000, mcc: 4829, description: "Оплата послуг" }), ctx()).type).toBe(
      "income",
    );
    expect(classify(tx({ amount: 500000, mcc: 4829, description: "З гривневого рахунку ФОП" }), ctx()).type).toBe(
      "own_transfer",
    );
    expect(
      classify(tx({ accountKind: "fop", amount: -500000, mcc: 4829, counterIban: "UA00OWN0001" }), ctx()).type,
    ).toBe("own_transfer");
  });

  it("selling dollars to the fop's hryvnia account is own_transfer, not a person", () => {
    const r = classify(
      tx({ accountKind: "fop", amount: -10000, mcc: 4829, description: "На гривневий рахунок ФОП для переказу на картку" }),
      ctx(),
    );
    expect(r.type).toBe("own_transfer");
    expect(r.needsLabel).toBe(false);
  });

  it("payment from fop to the tax office is tax", () => {
    const r = classify(tx({ accountKind: "fop", amount: -100000, mcc: 4829, description: "ГУ ДПС у Київській Області" }), ctx());
    expect(r).toMatchObject({ type: "tax", needsLabel: false });
    expect(classify(tx({ description: "ГУК Київ.обл/Київ/11010100" }), ctx()).type).toBe("tax");
  });
});

describe("debts and loans", () => {
  it.each([
    ["Кредит До завтра на 7 днів"],
    ["Від: Llc Moneyveo Shvydka Finansova"],
    ["Розстрочка на картку"],
    ["Кредит готівкою на 4 дні"],
    ["Кредит готівкою на 2 дні"],
  ])("incoming %s is loan_in", (description) => {
    expect(classify(tx({ description, amount: 500000, mcc: 4829 }), ctx())).toMatchObject({ type: "loan_in" });
  });

  it.each([
    ["Погашення Кредит До завтра на 7 днів"],
    ["Списання відсотків Кредит До завтра на 7 днів"],
    ["Щомісячний платіж"],
    ["Погашення наступного платежу КТС - monomarket"],
    ["Списання відсотків за січень"],
    ["CreditKasa"],
    ["Погашення Кредит готівкою на 4 дні"],
    ["Погашення Кредит готівкою на 2 дні"],
  ])("outgoing %s is debt_payment", (description) => {
    expect(classify(tx({ description, mcc: 4829 }), ctx()).type).toBe("debt_payment");
  });
});

describe("refunds", () => {
  it("a refund from an unknown shop is a refund, and asks nothing", () => {
    for (const description of ["Повернення платежу skay.ua", "Скасування покупки Some Shop"]) {
      expect(classify(tx({ description, amount: 52_950, mcc: null }), ctx())).toMatchObject({
        type: "spend",
        category: "refund",
        needsLabel: false,
      });
    }
  });
});

describe("refunds on the fop account", () => {
  it("a bank refund on the fop account is a refund, not income (it must not enter the tax base)", () => {
    for (const description of ["Повернення платежу skay.ua", "Скасування. Some Shop"]) {
      expect(classify(tx({ accountKind: "fop", description, amount: 52_950, mcc: 4829 }), ctx())).toMatchObject({
        type: "spend",
        category: "refund",
        source: "auto",
        needsLabel: false,
      });
    }
    // A known shop keeps its category, exactly as on other accounts.
    expect(classify(tx({ accountKind: "fop", description: "Скасування. Uklon", amount: 9_000, mcc: 4829 }), ctx())).toMatchObject({
      type: "spend",
      category: "transport",
    });
  });

  it("ordinary incoming money on the fop account is still income", () => {
    expect(classify(tx({ accountKind: "fop", description: "Payment from client", amount: 1_000_000, mcc: 4829 }), ctx()).type).toBe(
      "income",
    );
    expect(classify(tx({ accountKind: "fop", description: "Оплата послуг", amount: 500_000, mcc: null }), ctx()).type).toBe("income");
  });

  it("a refund of a transfer on the fop account stays income, as before", () => {
    const r = classify(tx({ accountKind: "fop", description: "Скасування. Переказ на карту", amount: 9_000, mcc: 4829 }), ctx());
    expect(r).toMatchObject({ type: "income", category: "income" });
  });

  it("cashback on the fop account is still income with the refund category", () => {
    const r = classify(tx({ accountKind: "fop", description: "Виведення кешбеку", amount: 3_000, mcc: 4829 }), ctx());
    expect(r).toMatchObject({ type: "income", category: "refund" });
  });
});

describe("refund of an order from a business (Б13)", () => {
  const comment = "Повернення коштів за замовлення №12345";

  it("money from a ФОП or ТОВ with a refund comment is a refund, not money from a person", () => {
    for (const description of ["Від: ФОП Іванов Іван Іванович", "Від: ТОВ Магазин"]) {
      expect(classify(tx({ description, comment, amount: 52_950, mcc: 4829 }), ctx())).toMatchObject({
        type: "spend",
        category: "refund",
        source: "auto",
        needsLabel: false,
      });
    }
  });

  it("the sender's name from the bank counts the same as the description", () => {
    const r = classify(
      tx({ description: "Переказ на картку", counterName: "ФОП Іванов Іван Іванович", comment, amount: 52_950, mcc: 4829 }),
      ctx(),
    );
    expect(r).toMatchObject({ type: "spend", category: "refund" });
  });

  it("the comment is matched by its start, in any case", () => {
    const r = classify(tx({ description: "Від: ФОП Іванов", comment: "  повернення КОШТІВ за товар", amount: 10_000, mcc: 4829 }), ctx());
    expect(r).toMatchObject({ type: "spend", category: "refund" });
  });

  it("a known shop keeps its category", () => {
    const r = classify(tx({ description: "Від: ТОВ Uklon", comment, amount: 9_000, mcc: 4829 }), ctx());
    expect(r).toMatchObject({ type: "spend", category: "transport" });
  });

  it("the same comment from a person without ФОП or ТОВ stays money from a person", () => {
    const r = classify(tx({ description: "Від: Тест Тестовий", comment, amount: 52_950, mcc: 4829 }), ctx());
    expect(r).toMatchObject({ type: "person_in", category: "transfer" });
  });

  it("money from a ФОП without the comment, or with another comment, does not change", () => {
    expect(classify(tx({ description: "Від: ФОП Іванов", amount: 52_950, mcc: 4829 }), ctx())).toMatchObject({ type: "person_in" });
    expect(classify(tx({ description: "Від: ФОП Іванов", comment: "за послуги", amount: 52_950, mcc: 4829 }), ctx())).toMatchObject({
      type: "person_in",
    });
    // "ФОП" inside the name, not at its start, is not a business prefix.
    expect(classify(tx({ description: "Від: Іванов ФОП", comment, amount: 52_950, mcc: 4829 }), ctx())).toMatchObject({
      type: "person_in",
    });
  });

  it("the same refund on the fop account is a refund, not income", () => {
    const r = classify(tx({ accountKind: "fop", description: "Від: ФОП Іванов", comment, amount: 52_950, mcc: 4829 }), ctx());
    expect(r).toMatchObject({ type: "spend", category: "refund", source: "auto", needsLabel: false });
  });

  it("an owner rule still wins", () => {
    const c = ctx({ rules: [{ matchKind: "recipient", matchValue: "ФОП Іванов", type: "income", category: "income" }] });
    const r = classify(tx({ description: "Від: ФОП Іванов", counterName: "ФОП Іванов", comment, amount: 52_950, mcc: 4829 }), c);
    expect(r).toMatchObject({ type: "income", source: "owner" });
  });
});

describe("cash", () => {
  it("atm withdrawal is cash_out, cash deposit is cash_in", () => {
    expect(classify(tx({ description: "Банкомат 12345", mcc: 6011 }), ctx()).type).toBe("cash_out");
    expect(classify(tx({ description: "Видача готівки Сільпо", mcc: 5499 }), ctx()).type).toBe("cash_out");
    expect(classify(tx({ description: "Термінал EasyPay", amount: 100000, mcc: 4829 }), ctx()).type).toBe("cash_in");
  });

  it("a rule of another type does not turn a withdrawal into something else", () => {
    const rules = [{ matchKind: "merchant" as const, matchValue: "видача готівки сільпо", type: "spend" as const, direction: "out" as const }];
    const out = classify(tx({ description: "Видача готівки Сільпо", mcc: 5411 }), ctx({ rules }));
    expect(out).toMatchObject({ type: "cash_out", source: "rule" });
    // The same rule still applies to a purchase in that shop.
    const buy = classify(tx({ description: "Сільпо", mcc: 5411 }), ctx({ rules: [{ ...rules[0]!, matchValue: "сільпо" }] }));
    expect(buy).toMatchObject({ type: "spend", source: "owner" });
  });

  it("a cash_out rule still applies to a withdrawal", () => {
    const rules = [{ matchKind: "merchant" as const, matchValue: "банкомат 1", type: "cash_out" as const, category: "cash" }];
    expect(classify(tx({ description: "Банкомат 1", mcc: 6011 }), ctx({ rules }))).toMatchObject({ type: "cash_out", source: "owner" });
  });
});

describe("purchases and refunds", () => {
  it("positive amount with a purchase mcc is a spend refund", () => {
    const r = classify(tx({ description: "Скасування. Coffee", amount: 5000, mcc: 5814 }), ctx());
    expect(r).toMatchObject({ type: "spend", category: "cafe" });
  });

  it("a plain purchase is spend with mcc category", () => {
    expect(classify(tx({ description: "Some Cafe", mcc: 5812 }), ctx())).toMatchObject({
      type: "spend",
      category: "cafe",
      source: "auto",
    });
  });

  it("a bank refund text is a refund whatever the mcc; an unknown shop's is a plain refund", () => {
    const r = classify(tx({ description: "Повернення платежу skay.ua", amount: 90000, mcc: 4829 }), ctx());
    expect(r).toMatchObject({ type: "spend", category: "refund", needsLabel: false });
    expect(classify(tx({ description: "Скасування. Uklon", amount: 9000, mcc: 4829 }), ctx())).toMatchObject({
      type: "spend",
      category: "transport",
    });
    expect(classify(tx({ description: "Скасування. Переказ на карту", amount: 9000, mcc: 4829 }), ctx()).type).toBe(
      "person_in",
    );
  });

  it("a store payment through the bank's installment service is a purchase", () => {
    expect(classify(tx({ description: "Платіж Shop - monomarket", mcc: 4829 }), ctx())).toMatchObject({
      type: "spend",
      category: "shopping",
    });
  });

  it("known chains get a category from merchants", () => {
    expect(classify(tx({ description: "Uklon", mcc: 4121 }), ctx()).category).toBe("transport");
  });

  it("unknown merchant without mcc is uncategorized", () => {
    expect(classify(tx({ description: "Mystery Shop" }), ctx())).toMatchObject({
      type: "spend",
      category: "uncategorized",
    });
  });
});

describe("a cafe by its name (Б14)", () => {
  const cat = (description: string, mcc: number | null = 5499, c = ctx()) => classify(tx({ description, mcc }), c).category;

  it("a cafe, restaurant, sushi or bar word in the name is a cafe whatever the mcc", () => {
    expect(cat('Кафе "Mango"')).toBe("cafe");
    expect(cat("Суши-тай бар Манго")).toBe("cafe");
    expect(cat("Ресторан Пузата хата", 5411)).toBe("cafe");
    expect(cat("СУШІ Майстер", 5999)).toBe("cafe");
    expect(cat("Mango Cafe")).toBe("cafe");
    expect(cat("RESTAURANT Kyiv")).toBe("cafe");
    expect(cat("Sushi Wok")).toBe("cafe");
    expect(cat("Lviv Bar")).toBe("cafe");
    expect(cat("Кафе Mango", null)).toBe("cafe");
  });

  it("a known grocery chain stays groceries even with such a word in its name", () => {
    expect(cat("Сільпо")).toBe("groceries");
    expect(cat("Сільпо кафе")).toBe("groceries");
    expect(cat("Silpo bar")).toBe("groceries");
    expect(cat("АТБ Суші")).toBe("groceries");
  });

  it("the word inside another word does not count", () => {
    expect(cat("Барвінок")).toBe("groceries");
    expect(cat("Бармаглот")).toBe("groceries");
    expect(cat("Барбершоп Борода", 7230)).toBe("uncategorized");
    expect(cat("Кафетерій", 5499)).toBe("groceries");
    expect(cat("Barbershop", 5499)).toBe("groceries");
    expect(cat("Sushiman", 5499)).toBe("groceries");
    expect(cat("Ресторанчик", 5499)).toBe("groceries");
  });

  it("an owner rule still wins over the name", () => {
    const c = ctx({ rules: [{ matchKind: "merchant", matchValue: 'кафе "mango"', type: "spend", category: "groceries" }] });
    expect(classify(tx({ description: 'Кафе "Mango"', mcc: 5499 }), c)).toMatchObject({
      category: "groceries",
      source: "owner",
    });
  });
});

describe("games are leisure (Б15)", () => {
  it("mcc 5816 is leisure; 5815, 5817 and 5818 stay subscriptions", () => {
    const cat = (description: string, mcc: number) => classify(tx({ description, mcc }), ctx()).category;
    expect(cat("Steam", 5816)).toBe("leisure");
    expect(cat("PlayStation Network", 5816)).toBe("leisure");
    expect(cat("Digital goods", 5815)).toBe("subscriptions");
    expect(cat("Digital media", 5817)).toBe("subscriptions");
    expect(cat("Digital store", 5818)).toBe("subscriptions");
  });
});

describe("people", () => {
  it("unknown transfer recipient is person_transfer and needs a label", () => {
    expect(classify(tx({ description: "Тест Тестовий", mcc: 4829 }), ctx())).toMatchObject({
      type: "person_transfer",
      needsLabel: true,
    });
  });

  // Б10: a transfer with no name to one known destination (a card number, an account) may be the
  // owner's own card at another bank, so it is asked about rather than spent in silence.
  it.each([
    ["a masked card", { description: "545708****4563" }],
    ["a masked card as the counterparty", { description: "Переказ на картку", counterName: "5457 08** **** 4563" }],
    ["a foreign IBAN", { description: "Переказ на картку", counterIban: "UA213223130000026007233566001" }],
  ])("an unnamed outgoing transfer to %s is person_transfer and asks", (_n, over) => {
    expect(classify(tx({ ...over, mcc: 4829 }), ctx())).toMatchObject({ type: "person_transfer", needsLabel: true });
    expect(classify(tx({ ...over, mcc: 6012 }), ctx())).toMatchObject({ type: "person_transfer", needsLabel: true });
    expect(classify(tx({ ...over, mcc: 4829, accountKind: "fop" }), ctx())).toMatchObject({ type: "person_transfer", needsLabel: true });
  });

  // Only a bank template: it names no one destination, and one answer would relabel every such transfer.
  it.each(["Переказ на картку", "Поповнення «На свято»"])("a transfer with only a bank text stays person_transfer without a question: %s", (description) => {
    expect(classify(tx({ description, mcc: 4829 }), ctx())).toMatchObject({ type: "person_transfer", needsLabel: false });
    expect(classify(tx({ description, mcc: 4829, accountKind: "fop" }), ctx())).toMatchObject({ type: "person_transfer", needsLabel: false });
  });

  it("an unnamed fop payment with no MCC is not a transfer and does not ask", () => {
    expect(classify(tx({ description: "545708****4563", mcc: null, accountKind: "fop" }), ctx())).toMatchObject({
      type: "person_transfer",
      needsLabel: false,
    });
  });

  it("the bank's counterparty name decides over a generic description", () => {
    expect(classify(tx({ description: "Переказ на картку", counterName: "Таечка", mcc: 4829 }), ctx()).needsLabel).toBe(true);
  });

  it("incoming from a person is person_in", () => {
    expect(classify(tx({ description: "Від: Тест Тестовий", amount: 10000, mcc: 4829 }), ctx())).toMatchObject({
      type: "person_in",
    });
  });
});

describe("hasThirdParty (Б10)", () => {
  it.each([
    ["money from a named person", { amount: 200_000, description: "Від: Анна Петренко" }],
    ["money from a named counterparty", { amount: 200_000, description: "Переказ", counterName: "Анна Петренко" }],
    ["a transfer to a masked card", { description: "545708****1111" }],
    ["a transfer to a masked card in the counter name", { description: "Переказ на картку", counterName: "5457 08** **** 1111" }],
    ["a transfer to a foreign IBAN", { description: "Переказ", counterIban: "UA213223130000026007233566001" }],
    ["a transfer to a named counterparty", { description: "Переказ", counterName: "Анна Петренко" }],
  ])("someone else is on the other side: %s", (_n, over) => {
    expect(hasThirdParty(tx(over), ctx())).toBe(true);
  });

  it.each([
    ["money from the owner", { amount: 200_000, description: "Від: Test Owner" }],
    ["money with only a bank text", { amount: 200_000, description: "Переказ з картки" }],
    ["money with a description that is not a sender", { amount: 200_000, description: "Payment from client" }],
    ["a transfer to an own IBAN", { description: "Переказ", counterIban: "UA00OWN0001" }],
    ["a transfer with only a bank text", { description: "Переказ на картку" }],
    ["an exchange text", { description: "Обмін валюти" }],
  ])("no one else: %s", (_n, over) => {
    expect(hasThirdParty(tx(over), ctx())).toBe(false);
  });
});

describe("findOwnPairs", () => {
  it("pairs opposite rows of equal amount on different accounts within the window", () => {
    const rows = [
      { id: 1, accountId: 1, at: 0, amount: -5000 },
      { id: 2, accountId: 2, at: 60_000, amount: 5000 },
      { id: 3, accountId: 1, at: 0, amount: -7000 },
      { id: 4, accountId: 1, at: 0, amount: 7000 },
      { id: 5, accountId: 3, at: 0, amount: -9000 },
      { id: 6, accountId: 4, at: 20 * 60_000, amount: 9000 },
    ];
    expect([...findOwnPairs(rows)].sort()).toEqual([1, 2]);
  });
});

describe("default categories and fop income", () => {
  it("owner rules without a category fall back to the type default", () => {
    const c = ctx({
      rules: [
        { matchKind: "merchant", matchValue: "rentco", type: "obligation" },
        { matchKind: "merchant", matchValue: "shopx", type: "spend" },
        { matchKind: "merchant", matchValue: "gift", type: "person_in" },
        { matchKind: "merchant", matchValue: "pay", type: "income" },
        { matchKind: "merchant", matchValue: "atm1", type: "cash_in" },
        { matchKind: "merchant", matchValue: "jar1", type: "goal_contribution" },
        { matchKind: "merchant", matchValue: "debt1", type: "debt_payment" },
        { matchKind: "merchant", matchValue: "loan1", type: "loan_in" },
        { matchKind: "merchant", matchValue: "dps1", type: "tax" },
      ],
    });
    const cat = (d: string) => classify(tx({ description: d }), c).category;
    expect(cat("rentco")).toBe("transfer");
    expect(cat("shopx")).toBe("uncategorized");
    expect(cat("gift")).toBe("transfer");
    expect(cat("pay")).toBe("income");
    expect(cat("atm1")).toBe("cash");
    expect(cat("jar1")).toBe("own");
    expect(cat("debt1")).toBe("debt");
    expect(cat("loan1")).toBe("loan");
    expect(cat("dps1")).toBe("tax");
  });

  it("any incoming money on the fop account is income", () => {
    const r = classify(tx({ accountKind: "fop", amount: 1_000_000, mcc: 4829, description: "Payment from client" }), ctx());
    expect(r.type).toBe("income");
  });
});

describe("a merchant rule matches the whole bank text (Б37)", () => {
  const rule = (matchValue: string) => ({ matchKind: "merchant" as const, matchValue, direction: null });
  const buy = (description: string) => ({ amount: -100, description, counterIban: null, counterName: null });

  it("a rule for one shop does not catch a longer name that starts with it", () => {
    expect(ruleMatches(rule("uber"), buy("Uber Eats"))).toBe(false);
    expect(ruleMatches(rule("uber eats"), buy("Uber"))).toBe(false);
    const c = ctx({ rules: [{ matchKind: "merchant", matchValue: "uber", type: "obligation" }] });
    expect(classify(tx({ description: "Uber Eats", mcc: 5812 }), c).source).not.toBe("owner");
    expect(classify(tx({ description: "Uber", mcc: 4121 }), c)).toMatchObject({ type: "obligation", source: "owner" });
  });

  it("ignores case and extra spaces on both sides", () => {
    expect(ruleMatches(rule("UBER"), buy("uber"))).toBe(true);
    expect(ruleMatches(rule("uber eats"), buy("  Uber   Eats "))).toBe(true);
    expect(ruleMatches(rule(" Uber  Eats"), buy("uber eats"))).toBe(true);
  });
});

describe("rule direction", () => {
  it("an out rule ignores incoming money and an in rule ignores outgoing", () => {
    const rule = (direction: "in" | "out" | null) =>
      ctx({ rules: [{ matchKind: "iban", matchValue: "UA1", type: "obligation", direction }] });
    expect(classify(tx({ counterIban: "UA1", mcc: 4829, amount: -100 }), rule("out")).type).toBe("obligation");
    expect(classify(tx({ counterIban: "UA1", mcc: 4829, amount: 100 }), rule("out")).type).not.toBe("obligation");
    expect(classify(tx({ counterIban: "UA1", mcc: 4829, amount: -100 }), rule("in")).type).not.toBe("obligation");
    expect(classify(tx({ counterIban: "UA1", mcc: 4829, amount: 100 }), rule(null)).type).toBe("obligation");
  });

  it("flags short and generic rule values", () => {
    expect(isWeakRuleValue("Ivan")).toBe(false);
    expect(isWeakRuleValue(" Al ")).toBe(true);
    expect(isWeakRuleValue("Переказ")).toBe(true);
    expect(isWeakRuleValue("  ПЕРЕКАЗ   коштів")).toBe(true);
  });
});
