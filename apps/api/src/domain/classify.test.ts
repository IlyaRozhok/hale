import { describe, expect, it } from "vitest";
import { classify, findOwnPairs, isWeakRuleValue, type ClassifyContext, type ClassifyInput } from "./classify";

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
      rules: [{ matchKind: "merchant", matchValue: "Кредит до завтра", type: "spend", category: "other" }],
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
    const rules = [{ matchKind: "merchant" as const, matchValue: "банкомат", type: "cash_out" as const, category: "cash" }];
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

describe("people", () => {
  it("unknown transfer recipient is person_transfer and needs a label", () => {
    expect(classify(tx({ description: "Тест Тестовий", mcc: 4829 }), ctx())).toMatchObject({
      type: "person_transfer",
      needsLabel: true,
    });
  });

  it.each(["Переказ на картку", "545708****4563", "Поповнення «На свято»"])("an unnamed transfer stays person_transfer without a question: %s", (description) => {
    expect(classify(tx({ description, mcc: 4829 }), ctx())).toMatchObject({ type: "person_transfer", needsLabel: false });
    expect(classify(tx({ description, mcc: 4829, accountKind: "fop" }), ctx())).toMatchObject({ type: "person_transfer", needsLabel: false });
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
