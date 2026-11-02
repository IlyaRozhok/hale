import { describe, expect, it } from "vitest";
import { classify, type ClassifyContext, type ClassifyInput } from "./classify";

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
    expect(classify(tx({ counterIban: "UA11X", mcc: 4829 }), c).type).toBe("obligation");
    expect(classify(tx({ counterName: "Mr Landlord", mcc: 4829 }), c).type).toBe("obligation");
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

describe("cash", () => {
  it("atm withdrawal is cash_out, cash deposit is cash_in", () => {
    expect(classify(tx({ description: "Банкомат 12345", mcc: 6011 }), ctx()).type).toBe("cash_out");
    expect(classify(tx({ description: "Видача готівки Сільпо", mcc: 5499 }), ctx()).type).toBe("cash_out");
    expect(classify(tx({ description: "Термінал EasyPay", amount: 100000, mcc: 4829 }), ctx()).type).toBe("cash_in");
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

  it("incoming from a person is person_in", () => {
    expect(classify(tx({ description: "Від: Тест Тестовий", amount: 10000, mcc: 4829 }), ctx())).toMatchObject({
      type: "person_in",
    });
  });
});
