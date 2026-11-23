import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet, TextInput } from "react-native";
import { tokens } from "@hale/tokens";
import { TxEditSheet } from "./TxEditSheet";
import type { CategoryDto, TransactionDto } from "@hale/contracts";
import { fakeApi, holdSheetOpenings, renderWith, txFixture } from "../testing";
import type { TransactionEdit } from "../api/client";

const noop = () => undefined;
/** 10 November, 14:32 on the device's own clock, whatever zone the tests run in. */
const at = new Date(2026, 10, 10, 14, 32).toISOString();
const chip = (name: string) => screen.queryByRole("button", { name });
const selected = (name: string) => screen.getByRole("button", { name }).props.accessibilityState.selected;
/** The type waits behind one row (ЯМ3); the category list behind «Изменить». */
const TYPE_ROW = "Ещё: тип операции";
const openTypes = async () => fireEvent.press(await screen.findByRole("button", { name: TYPE_ROW }));
const openCategories = async () => fireEvent.press(await screen.findByRole("button", { name: "Изменить" }));

const OUT_FREQUENT = ["Трата", "Обязательный платёж", "Между своими", "Перевод человеку"];
const IN_FREQUENT = ["Доход", "От человека", "Между своими"];
const ALL = [
  "Доход", "Трата", "Обязательный платёж", "Налог", "Платёж по долгу", "Займ", "Между своими", "Перевод человеку", "От человека",
  "Внесение наличных", "Снятие наличных", "Взнос в цель", "Дал в долг",
];

describe("TxEditSheet header: the operation itself", () => {
  it("says the amount, the date with the time and the account under the name", async () => {
    const tx = txFixture({ description: "SILPO KYIV UA", counterName: "Сільпо", amount: -42000, amountUah: -42000, occurredAt: at, accountKind: "black" });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    expect(await screen.findByText("Сільпо")).toBeTruthy();
    expect(screen.getByText("−₴420 · 10 ноя, 14:32 · Чёрная карта")).toBeTruthy();
    expect(screen.queryByText("Изменить тип или категорию")).toBeNull();
  });

  it("an operation the bank still processes says so in one fact line, the old note gone (ЯМ2, ЯМ3)", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ hold: true })} onClose={noop} />, fakeApi());
    expect(await screen.findByText("В обработке у банка — сумма может немного измениться")).toBeTruthy();
    expect(screen.queryByText(/Банк ещё проводит/)).toBeNull();
  });

  it("a settled operation, or one from an older server without the field, has no such line", async () => {
    const tx = txFixture();
    delete (tx as Partial<typeof tx>).hold;
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    await screen.findByText(TYPE_ROW);
    expect(screen.queryByText(/В обработке у банка/)).toBeNull();
  });

  it("shows the bank's text when the name on top is the counterparty's", async () => {
    const tx = txFixture({ description: "SILPO KYIV UA", counterName: "Сільпо" });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    expect(await screen.findByText("SILPO KYIV UA")).toBeTruthy();
  });

  it("does not repeat the bank's text when it is the name already", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ description: "Кофейня", counterName: null })} onClose={noop} />, fakeApi());
    await screen.findByText(TYPE_ROW);
    expect(screen.getAllByText("Кофейня")).toHaveLength(1);
  });

  it("a transfer to a masked card number is headed in words, the number not repeated under it (Я3)", async () => {
    const tx = txFixture({ description: "545708****4563", type: "own_transfer", category: "own", amount: -1_560_000, amountUah: -1_560_000 });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    expect(await screen.findByText("Перевод на карту ··4563")).toBeTruthy();
    expect(screen.queryByText("545708****4563")).toBeNull();
  });

  it("an empty bank text under a name leaves no blank line", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ description: "", counterName: "Сільпо" })} onClose={noop} />, fakeApi());
    await screen.findByText(TYPE_ROW);
    expect(screen.queryAllByText("")).toHaveLength(0);
  });

  it("an account it has no name for leaves no loose separator", async () => {
    const tx = txFixture({ amount: -42000, amountUah: -42000, occurredAt: at, accountKind: "something_new" });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    expect(await screen.findByText("−₴420 · 10 ноя, 14:32")).toBeTruthy();
  });

  it("money coming in carries a plus, as in the list", async () => {
    const tx = txFixture({ type: "income", category: "income", amount: 5_000_000, amountUah: 5_000_000, occurredAt: at, accountKind: "fop" });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    expect(await screen.findByText("+₴50,000 · 10 ноя, 14:32 · Счёт ФОП")).toBeTruthy();
  });

  it("a foreign amount with no rate is shown in its own currency, as in the list", async () => {
    const tx = txFixture({ amount: -1000, amountUah: null, currency: "USD", occurredAt: at, accountKind: "white" });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    expect(await screen.findByText("−$10 · 10 ноя, 14:32 · Белая карта")).toBeTruthy();
  });
});

describe("TxEditSheet: facts first (ЯМ3)", () => {
  const HELD = "В обработке у банка — сумма может немного измениться";

  it("an operation the limit counts says so in one line with an icon", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ inLimit: true })} onClose={noop} />, fakeApi());
    expect(await screen.findByText("Считается в лимите дня")).toBeTruthy();
    expect(screen.getByTestId("fact-icon-check")).toBeTruthy();
  });

  it("an own transfer: outside the limit, between own money", async () => {
    const tx = txFixture({ type: "own_transfer", category: "own", inLimit: false, amount: -200_000, amountUah: -200_000 });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    expect(await screen.findByText("Не в лимите — между своими")).toBeTruthy();
    expect(screen.getByTestId("fact-icon-transfer")).toBeTruthy();
    expect(screen.queryByText("Считается в лимите дня")).toBeNull();
  });

  it("the limit line follows the saved row after a new type, both ways", async () => {
    // The server answers an edit with the row as it is now, its `inLimit` counted again.
    const cases: [TransactionDto, string, NonNullable<TransactionDto["type"]>, string, boolean, string][] = [
      [txFixture({ id: 3, type: "spend", inLimit: true }), "Считается в лимите дня", "own_transfer", "Между своими", false, "Не в лимите — между своими"],
      [
        txFixture({ id: 4, type: "obligation", category: "utilities", inLimit: false }),
        "Не в лимите — обязательный платёж", "spend", "Трата", true, "Считается в лимите дня",
      ],
    ];
    for (const [tx, before, type, chipName, inLimit, after] of cases) {
      const editTransaction = jest.fn(async () => ({ transaction: { ...tx, type, inLimit }, updated: 1 }));
      const { unmount } = await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi({ editTransaction }));
      expect(await screen.findByText(before)).toBeTruthy();
      await openTypes();
      await fireEvent.press(screen.getByRole("button", { name: chipName }));
      expect(await screen.findByText(after)).toBeTruthy();
      expect(screen.queryByText(before)).toBeNull();
      await unmount();
    }
  });

  it("a held operation: the bank's line above the limit's, both above the category", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ hold: true, inLimit: true })} onClose={noop} />, fakeApi());
    await screen.findByText(HELD);
    const texts = screen.getAllByText(/^(В обработке у банка — сумма может немного измениться|Считается в лимите дня|Категория)$/);
    expect(texts.map((t) => String(t.props.children))).toEqual([HELD, "Считается в лимите дня", "Категория"]);
  });

  it("a kind with no plain reason, or an older server without the fields, has no fact lines and no error", async () => {
    const income = txFixture({ type: "income", category: "income", amount: 5_000_000, amountUah: 5_000_000, inLimit: false });
    await renderWith(<TxEditSheet tx={income} onClose={noop} />, fakeApi());
    await screen.findByText(TYPE_ROW);
    expect(screen.queryByText(/лимит/)).toBeNull();
    const old = txFixture();
    delete (old as Partial<typeof old>).hold;
    delete old.inLimit;
    await renderWith(<TxEditSheet tx={old} onClose={noop} />, fakeApi());
    await screen.findByText(TYPE_ROW);
    expect(screen.queryByText(/лимит|В обработке/)).toBeNull();
    expect(screen.queryByTestId(/^fact-icon-/)).toBeNull();
  });
});

describe("TxEditSheet: the category as one chip, the list behind «Изменить» (ЯМ3)", () => {
  const LIST: CategoryDto[] = [
    { key: "cafe", name: "Кафе", icon: "coffee", system: false },
    { key: "groceries", name: "Продукты", icon: "cart", system: false },
  ];
  const cafe = txFixture({ id: 7, counterName: "Сільпо", type: "spend", category: "cafe" });

  it("shows only the chosen category and «Изменить»", async () => {
    await renderWith(<TxEditSheet tx={cafe} onClose={noop} />, fakeApi({ categories: jest.fn(async () => LIST) }));
    expect(await screen.findByRole("button", { name: "Изменить" })).toBeTruthy();
    await waitFor(() => expect(selected("Кафе")).toBe(true));
    expect(chip("Продукты")).toBeNull();
    expect(chip("Новая")).toBeNull();
    expect(chip("Свернуть")).toBeNull();
  });

  it("«Изменить» opens the whole list in place with «Свернуть»; «Свернуть» folds it back and saves nothing", async () => {
    const api = fakeApi({ categories: jest.fn(async () => LIST) });
    await renderWith(<TxEditSheet tx={cafe} onClose={noop} />, api);
    await openCategories();
    expect(chip("Продукты")).toBeTruthy();
    expect(chip("Новая")).toBeTruthy();
    expect(chip("Изменить")).toBeNull();
    expect(selected("Кафе")).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Свернуть" }));
    expect(chip("Продукты")).toBeNull();
    expect(chip("Изменить")).toBeTruthy();
    expect(api.editTransaction).not.toHaveBeenCalled();
  });

  it("the chosen chip itself opens the list too", async () => {
    await renderWith(<TxEditSheet tx={cafe} onClose={noop} />, fakeApi({ categories: jest.fn(async () => LIST) }));
    await fireEvent.press(await screen.findByRole("button", { name: "Кафе" }));
    expect(await screen.findByRole("button", { name: "Продукты" })).toBeTruthy();
    expect(chip("Свернуть")).toBeTruthy();
  });

  it("no category yet: the list is open, with nothing to fold back to", async () => {
    await renderWith(<TxEditSheet tx={{ ...cafe, category: null }} onClose={noop} />, fakeApi({ categories: jest.fn(async () => LIST) }));
    // «Кафе» is the server's name: the built-in list shown while it loads has «Кафе и рестораны».
    expect(await screen.findByRole("button", { name: "Кафе" })).toBeTruthy();
    expect(chip("Продукты")).toBeTruthy();
    expect(selected("Кафе")).toBe(false);
    expect(chip("Изменить")).toBeNull();
    expect(chip("Свернуть")).toBeNull();
  });
});

describe("TxEditSheet: the type behind one row (ЯМ3)", () => {
  it("one row names the current type; the chips wait until it is tapped", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ type: "obligation", category: "utilities" })} onClose={noop} />, fakeApi());
    const row = await screen.findByRole("button", { name: TYPE_ROW });
    expect(screen.getByText("Обязательный платёж")).toBeTruthy();
    expect(row.props.accessibilityState.expanded).toBe(false);
    expect(chip("Трата")).toBeNull();
    expect(chip("Ещё")).toBeNull();
    await fireEvent.press(row);
    expect(selected("Обязательный платёж")).toBe(true);
    expect(chip("Трата")).toBeTruthy();
    expect(chip("Ещё")).toBeTruthy();
    expect(screen.getByRole("button", { name: TYPE_ROW }).props.accessibilityState.expanded).toBe(true);
  });

  it("a row with no type says so on the right", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ type: null })} onClose={noop} />, fakeApi());
    await screen.findByText(TYPE_ROW);
    expect(screen.getByText("Не определён")).toBeTruthy();
  });
});

describe("TxEditSheet: a spend from the credit limit (A16)", () => {
  it("paid wholly from the limit: one quiet line says so", async () => {
    const tx = txFixture({ amount: -16_000, amountUah: -16_000, creditPart: 16_000 });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    expect(await screen.findByText("Оплачено из кредитного лимита")).toBeTruthy();
  });

  it("paid partly from the limit: the line names that part", async () => {
    const tx = txFixture({ amount: -180_000, amountUah: -180_000, creditPart: 110_000 });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    expect(await screen.findByText("₴1,100 — из кредитного лимита")).toBeTruthy();
    expect(screen.queryByText("Оплачено из кредитного лимита")).toBeNull();
  });

  it("a credit part that rounds to ₴0 draws no line", async () => {
    const tx = txFixture({ amount: -10_030, amountUah: -10_030, creditPart: 30 });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    await screen.findByText(TYPE_ROW);
    expect(screen.queryByText(/кредитного лимита/)).toBeNull();
  });

  it("a credit part that rounds to the whole shown amount reads as wholly from the limit", async () => {
    const tx = txFixture({ amount: -16_100, amountUah: -16_100, creditPart: 16_050 });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    expect(await screen.findByText("Оплачено из кредитного лимита")).toBeTruthy();
    expect(screen.queryByText("₴161 — из кредитного лимита")).toBeNull();
  });

  it("own money or an old row: no line", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ creditPart: null })} onClose={noop} />, fakeApi());
    await screen.findByText(TYPE_ROW);
    expect(screen.queryByText(/кредитного лимита/)).toBeNull();
  });

  it("an older server without the field: no line", async () => {
    const tx = txFixture();
    delete tx.creditPart;
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    await screen.findByText(TYPE_ROW);
    expect(screen.queryByText(/кредитного лимита/)).toBeNull();
  });
});

describe("TxEditSheet types: the frequent ones and «Ещё»", () => {
  it("money going out: four frequent types, the rest are hidden", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ type: "spend" })} onClose={noop} />, fakeApi());
    await openTypes();
    for (const name of OUT_FREQUENT) expect(chip(name)).toBeTruthy();
    for (const name of ALL.filter((t) => !OUT_FREQUENT.includes(t))) expect(chip(name)).toBeNull();
    expect(selected("Трата")).toBe(true);
    expect(chip("Ещё")).toBeTruthy();
  });

  it("money coming in: three frequent types, the rest are hidden", async () => {
    const tx = txFixture({ type: "income", category: "income", amount: 5_000_000, amountUah: 5_000_000 });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    await openTypes();
    for (const name of IN_FREQUENT) expect(chip(name)).toBeTruthy();
    for (const name of ALL.filter((t) => !IN_FREQUENT.includes(t))) expect(chip(name)).toBeNull();
    expect(selected("Доход")).toBe(true);
    expect(chip("Ещё")).toBeTruthy();
  });

  it("«Ещё» opens the other types in place and saves nothing", async () => {
    const api = fakeApi();
    await renderWith(<TxEditSheet tx={txFixture({ type: "spend" })} onClose={noop} />, api);
    await openTypes();
    await fireEvent.press(await screen.findByRole("button", { name: "Ещё" }));
    for (const name of ALL) expect(chip(name)).toBeTruthy();
    expect(chip("Ещё")).toBeNull();
    expect(api.editTransaction).not.toHaveBeenCalled();
    // The frequent ones stay in front, the others follow in their usual order.
    const order = screen.getAllByRole("button").map((b) => String(b.props.accessibilityLabel)).filter((l) => ALL.includes(l));
    expect(order).toEqual([...OUT_FREQUENT, ...ALL.filter((t) => !OUT_FREQUENT.includes(t))]);
  });

  it("a type from under «Ещё» is saved in one tap once it is shown", async () => {
    const api = fakeApi();
    const onClose = jest.fn();
    await renderWith(<TxEditSheet tx={txFixture({ id: 9, type: "spend" })} onClose={onClose} />, api);
    await openTypes();
    await fireEvent.press(await screen.findByRole("button", { name: "Ещё" }));
    await fireEvent.press(screen.getByRole("button", { name: "Налог" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(9, { type: "tax", applyToSimilar: false }));
    // Saved for this operation; the sheet stays to ask about the similar ones.
    expect(await screen.findByText("Всегда так для «Кофейня»?")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a rare type the row already has is in sight and selected without «Ещё»", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ type: "debt_payment", category: "debt" })} onClose={noop} />, fakeApi());
    await openTypes();
    expect(selected("Платёж по долгу")).toBe(true);
    for (const name of OUT_FREQUENT) expect(selected(name)).toBe(false);
    expect(chip("Налог")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Ещё" }));
    expect(screen.getAllByRole("button", { name: "Платёж по долгу" })).toHaveLength(1);
    expect(chip("Налог")).toBeTruthy();
  });

  it("a row with no type yet has nothing selected", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ type: null })} onClose={noop} />, fakeApi());
    await openTypes();
    for (const name of OUT_FREQUENT) expect(selected(name)).toBe(false);
    expect(chip("Не определён")).toBeNull();
  });

  it("a type this app does not know yet draws no empty selected chip", async () => {
    const tx = txFixture({ type: "something_new" as never });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    await openTypes();
    for (const name of OUT_FREQUENT) expect(selected(name)).toBe(false);
    expect(screen.queryAllByRole("button", { name: "" })).toHaveLength(0);
    await fireEvent.press(screen.getByRole("button", { name: "Ещё" }));
    for (const name of ALL) expect(selected(name)).toBe(false);
    expect(screen.queryAllByRole("button", { name: "" })).toHaveLength(0);
  });
});

describe("TxEditSheet: categories from the server and «Всегда так» (В5)", () => {
  const LIST: CategoryDto[] = [
    { key: "cafe", name: "Кафе", icon: "coffee", system: false },
    { key: "groceries", name: "Продукты", icon: "cart", system: false },
    { key: "c_cat", name: "Кот", icon: "paw", system: false },
    { key: "refund", name: "Возвраты", icon: "arrowIn", system: true },
    { key: "uncategorized", name: "Без категории", icon: "circle", system: true },
  ];
  /** The server applies the patch to the row it was given. */
  const editing = (base: TransactionDto) =>
    jest.fn(async (_id: number, patch: Partial<TransactionDto>) => ({ transaction: { ...base, ...patch }, updated: 1 }));
  const silpo = txFixture({ id: 7, description: "SILPO KYIV UA", counterName: "Сільпо", type: "spend", category: "cafe" });
  const labels = () => screen.getAllByRole("button").map((b) => String(b.props.accessibilityLabel));

  it("offers the server's categories in its order, then «Новая»; no switch any more", async () => {
    await renderWith(<TxEditSheet tx={silpo} onClose={noop} />, fakeApi({ categories: jest.fn(async () => LIST) }));
    await openCategories();
    await screen.findByRole("button", { name: "Кот" });
    const shown = labels().filter((l) => [...LIST.map((c) => c.name), "Новая"].includes(l));
    expect(shown).toEqual(["Кафе", "Продукты", "Кот", "Возвраты", "Без категории", "Новая"]);
    expect(selected("Кафе")).toBe(true);
    expect(screen.queryByLabelText("Применить к похожим")).toBeNull();
    expect(screen.queryByText(/Всегда так/)).toBeNull();
  });

  it("an older server: today's built-in list, and no «Новая»", async () => {
    await renderWith(<TxEditSheet tx={silpo} onClose={noop} />, fakeApi({ categories: jest.fn(async () => null) }));
    await screen.findByText(TYPE_ROW);
    await waitFor(() => expect(chip("Кафе и рестораны")).toBeTruthy());
    await openCategories();
    expect(chip("Продукты")).toBeTruthy();
    expect(chip("Новая")).toBeNull();
  });

  it("a new category is saved for this operation only, then asks about the similar ones", async () => {
    const api = fakeApi({ categories: jest.fn(async () => LIST), editTransaction: editing(silpo), similarCount: jest.fn(async () => 24) });
    const onClose = jest.fn();
    await renderWith(<TxEditSheet tx={silpo} onClose={onClose} />, api);
    await openCategories();
    await fireEvent.press(await screen.findByRole("button", { name: "Продукты" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(7, { category: "groceries", applyToSimilar: false }));
    expect(await screen.findByText("Всегда так для «Сільпо»?")).toBeTruthy();
    expect(await screen.findByText("Ещё 23 операции станут «Продукты»")).toBeTruthy();
    expect(api.similarCount).toHaveBeenCalledWith(7, undefined);
    // Saved: the list folds back to the one chosen chip (ЯМ3).
    await waitFor(() => expect(chip("Кафе")).toBeNull());
    expect(selected("Продукты")).toBe(true);
    expect(chip("Свернуть")).toBeNull();
    expect(chip("Изменить")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    // The question sits between the categories and the type.
    const texts = screen.getAllByText(/^(Категория|Всегда так для «Сільпо»\?|Ещё: тип операции)$/).map((t) => String(t.props.children));
    expect(texts).toEqual(["Категория", "Всегда так для «Сільпо»?", TYPE_ROW]);
  });

  it("«Да, всегда» sends the same change for the similar ones, as the switch did, and closes", async () => {
    const api = fakeApi({ categories: jest.fn(async () => LIST), editTransaction: editing(silpo), similarCount: jest.fn(async () => 24) });
    const onClose = jest.fn();
    await renderWith(<TxEditSheet tx={silpo} onClose={onClose} />, api);
    await openCategories();
    await fireEvent.press(await screen.findByRole("button", { name: "Продукты" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Да, всегда" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenLastCalledWith(7, { category: "groceries", applyToSimilar: true }));
    expect(api.editTransaction).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("«Только эта» puts the question away and sends nothing more", async () => {
    const api = fakeApi({ categories: jest.fn(async () => LIST), editTransaction: editing(silpo) });
    const onClose = jest.fn();
    await renderWith(<TxEditSheet tx={silpo} onClose={onClose} />, api);
    await openCategories();
    await fireEvent.press(await screen.findByRole("button", { name: "Продукты" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Только эта" }));
    expect(screen.queryByText(/Всегда так/)).toBeNull();
    expect(api.editTransaction).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("with no other similar operations the question has no count line", async () => {
    const api = fakeApi({ categories: jest.fn(async () => LIST), editTransaction: editing(silpo), similarCount: jest.fn(async () => 1) });
    await renderWith(<TxEditSheet tx={silpo} onClose={noop} />, api);
    await openCategories();
    await fireEvent.press(await screen.findByRole("button", { name: "Продукты" }));
    expect(await screen.findByText("Всегда так для «Сільпо»?")).toBeTruthy();
    await waitFor(() => expect(api.similarCount).toHaveBeenCalled());
    expect(screen.queryByText(/^Ещё \d/)).toBeNull();
  });

  it("a new type asks the same, naming the type, and «Да, всегда» sends it for the similar ones", async () => {
    const api = fakeApi({ editTransaction: editing(silpo), similarCount: jest.fn(async () => 4) });
    await renderWith(<TxEditSheet tx={silpo} onClose={noop} />, api);
    await openTypes();
    await fireEvent.press(await screen.findByRole("button", { name: "Между своими" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(7, { type: "own_transfer", applyToSimilar: false }));
    expect(await screen.findByText("Ещё 3 операции станут «Между своими»")).toBeTruthy();
    expect(api.similarCount).toHaveBeenCalledWith(7, "own_transfer");
    await fireEvent.press(screen.getByRole("button", { name: "Да, всегда" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenLastCalledWith(7, { type: "own_transfer", applyToSimilar: true }));
  });

  it("tapping the category the operation already has saves nothing and asks", async () => {
    const api = fakeApi({ categories: jest.fn(async () => LIST), similarCount: jest.fn(async () => 5) });
    await renderWith(<TxEditSheet tx={silpo} onClose={noop} />, api);
    await openCategories();
    await fireEvent.press(await screen.findByRole("button", { name: "Кафе" }));
    expect(await screen.findByText("Ещё 4 операции станут «Кафе»")).toBeTruthy();
    expect(api.editTransaction).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Да, всегда" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(7, { category: "cafe", applyToSimilar: true }));
  });

  it("an operation with no type is changed alone: there is no rule to make, so no question", async () => {
    const untyped = { ...silpo, type: null };
    const api = fakeApi({ categories: jest.fn(async () => LIST), editTransaction: editing(untyped) });
    await renderWith(<TxEditSheet tx={untyped} onClose={noop} />, api);
    await openCategories();
    await fireEvent.press(await screen.findByRole("button", { name: "Продукты" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(7, { category: "groceries", applyToSimilar: false }));
    await waitFor(() => expect(selected("Продукты")).toBe(true));
    expect(screen.queryByText(/Всегда так/)).toBeNull();
  });

  it("a failed save says so and asks nothing", async () => {
    const api = fakeApi({ categories: jest.fn(async () => LIST), editTransaction: jest.fn(async () => Promise.reject(new Error("500"))) });
    await renderWith(<TxEditSheet tx={silpo} onClose={noop} />, api);
    await openCategories();
    await fireEvent.press(await screen.findByRole("button", { name: "Продукты" }));
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(screen.queryByText(/Всегда так/)).toBeNull();
    expect(selected("Кафе")).toBe(true);
  });

  it("«Новая» makes a category and puts this operation in it at once", async () => {
    const created: CategoryDto = { key: "c_new", name: "Спорт", icon: "dumbbell", system: false };
    const api = fakeApi({
      categories: jest.fn(async () => LIST),
      createCategory: jest.fn(async () => created),
      editTransaction: editing(silpo),
      similarCount: jest.fn(async () => 1),
    });
    await renderWith(<TxEditSheet tx={silpo} onClose={noop} />, api);
    await openCategories();
    await fireEvent.press(await screen.findByRole("button", { name: "Новая" }));
    expect(await screen.findByText("Новая категория")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Название"), "  Спорт ");
    await fireEvent.press(screen.getByRole("radio", { name: "Значок: гантель" }));
    await fireEvent.press(screen.getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(api.createCategory).toHaveBeenCalledWith({ name: "Спорт", icon: "dumbbell" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(7, { category: "c_new", applyToSimilar: false }));
    await waitFor(() => expect(screen.queryByText("Новая категория")).toBeNull());
    expect(await screen.findByText("Всегда так для «Сільпо»?")).toBeTruthy();
  });

  // On the phone a keyboard that rises while the form is still sliding in leaves the form off the screen, under its
  // own scrim, until the next tap — and that tap lands on the scrim and closes it. So the name is focused only once
  // the form has slid in.
  it("«Новая»: the name takes the keyboard only once the form has slid in", async () => {
    // The mock's focus is one jest.fn shared by every input, and it keeps the calls of earlier tests: a form an
    // earlier test opened may have taken focus.
    const focus = jest.spyOn(TextInput.prototype, "focus");
    focus.mockClear();
    const openings = holdSheetOpenings();
    try {
      await renderWith(<TxEditSheet tx={silpo} onClose={noop} />, fakeApi({ categories: jest.fn(async () => LIST) }));
      await openings.finish();
      await openCategories();
      await fireEvent.press(await screen.findByRole("button", { name: "Новая" }));
      const field = await screen.findByLabelText("Название");
      expect(field.props.autoFocus).toBeFalsy();
      // Still sliding in: no keyboard yet.
      expect(focus).not.toHaveBeenCalled();
      await openings.finish();
      expect(focus).toHaveBeenCalledTimes(1);
    } finally {
      openings.restore();
      focus.mockRestore();
    }
  });
});


describe("TxEditSheet: «Эта покупка» — нужное или желаемое (В6)", () => {
  const LIST: CategoryDto[] = [
    { key: "cafe", name: "Кафе", icon: "coffee", system: false, want: true },
    { key: "groceries", name: "Продукты", icon: "cart", system: false, want: false },
    { key: "refund", name: "Возвраты", icon: "arrowIn", system: true, want: null },
    { key: "uncategorized", name: "Без категории", icon: "circle", system: true, want: null },
  ];
  const cafe = txFixture({ id: 7, counterName: "Сільпо", type: "spend", category: "cafe", want: true, wantOverride: null });
  const side = (name: "Нужное" | "Желаемое") => screen.getByRole("button", { name });
  /** The server keeps the side it was sent; null gives the row back to its category's. */
  const keeping = (base: TransactionDto, categoryWant: boolean) =>
    jest.fn(async (_id: number, patch: TransactionEdit) => {
      const own = "want" in patch ? patch.want : (base.wantOverride ?? null);
      return { transaction: { ...base, wantOverride: own, want: own ?? categoryWant }, updated: 1 };
    });

  it("shows the side this purchase is on, with its category's usual one under it", async () => {
    await renderWith(<TxEditSheet tx={cafe} onClose={noop} />, fakeApi({ categories: jest.fn(async () => LIST) }));
    expect(await screen.findByText("Эта покупка")).toBeTruthy();
    expect(side("Желаемое").props.accessibilityState.selected).toBe(true);
    expect(side("Нужное").props.accessibilityState.selected).toBe(false);
    expect(screen.getByText("Для «Кафе» обычно — желаемое")).toBeTruthy();
    // Between the categories and the type.
    const texts = screen.getAllByText(/^(Категория|Эта покупка|Ещё: тип операции)$/).map((t) => String(t.props.children));
    expect(texts).toEqual(["Категория", "Эта покупка", TYPE_ROW]);
    const flatStyle = StyleSheet.flatten(screen.getByTestId("want-switch").props.style) as { height?: number };
    expect(flatStyle.height).toBeGreaterThanOrEqual(tokens.touchMin);
  });

  it("the other side is saved at once, alone, and asks nothing about the similar ones", async () => {
    const api = fakeApi({ categories: jest.fn(async () => LIST), editTransaction: keeping(cafe, true) });
    const onClose = jest.fn();
    await renderWith(<TxEditSheet tx={cafe} onClose={onClose} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Нужное" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(7, { want: false }));
    await waitFor(() => expect(side("Нужное").props.accessibilityState.selected).toBe(true));
    expect(screen.getByText("Для «Кафе» обычно — желаемое")).toBeTruthy();
    expect(screen.queryByText(/Всегда так/)).toBeNull();
    expect(api.similarCount).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the category's own side gives the purchase back to it", async () => {
    const moved = { ...cafe, want: false, wantOverride: false };
    const api = fakeApi({ categories: jest.fn(async () => LIST), editTransaction: keeping(moved, true) });
    await renderWith(<TxEditSheet tx={moved} onClose={noop} />, api);
    expect((await screen.findByRole("button", { name: "Нужное" })).props.accessibilityState.selected).toBe(true);
    await fireEvent.press(side("Желаемое"));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(7, { want: null }));
    await waitFor(() => expect(side("Желаемое").props.accessibilityState.selected).toBe(true));
  });

  it("the side it is already on sends nothing", async () => {
    const api = fakeApi({ categories: jest.fn(async () => LIST) });
    await renderWith(<TxEditSheet tx={cafe} onClose={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Желаемое" }));
    expect(api.editTransaction).not.toHaveBeenCalled();
  });

  it("a failed save says so and keeps the side it was on", async () => {
    const api = fakeApi({ categories: jest.fn(async () => LIST), editTransaction: jest.fn(async () => Promise.reject(new Error("422"))) });
    await renderWith(<TxEditSheet tx={cafe} onClose={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Нужное" }));
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(side("Желаемое").props.accessibilityState.selected).toBe(true);
  });

  it("a new category shows the side the server gives the purchase now, its own choice kept", async () => {
    const moved = { ...cafe, want: false, wantOverride: false };
    // The own choice stays on the row; in «Продукты» it is the category's side anyway.
    const editTransaction = jest.fn(async () => ({ transaction: { ...moved, category: "groceries", want: false }, updated: 1 }));
    const api = fakeApi({ categories: jest.fn(async () => LIST), editTransaction, similarCount: jest.fn(async () => 1) });
    await renderWith(<TxEditSheet tx={moved} onClose={noop} />, api);
    await openCategories();
    await fireEvent.press(await screen.findByRole("button", { name: "Продукты" }));
    expect(await screen.findByText("Для «Продукты» обычно — нужное")).toBeTruthy();
    expect(side("Нужное").props.accessibilityState.selected).toBe(true);
    expect(editTransaction).toHaveBeenCalledWith(7, { category: "groceries", applyToSimilar: false });
  });

  it("a purchase moved to a category with no side has no block", async () => {
    const editTransaction = jest.fn(async () => ({ transaction: { ...cafe, category: "uncategorized", want: null }, updated: 1 }));
    const api = fakeApi({ categories: jest.fn(async () => LIST), editTransaction });
    await renderWith(<TxEditSheet tx={cafe} onClose={noop} />, api);
    await openCategories();
    await fireEvent.press(await screen.findByRole("button", { name: "Без категории" }));
    await waitFor(() => expect(screen.queryByText("Эта покупка")).toBeNull());
  });

  it("no block for what is not a purchase, a category with no side, the cash wallet, or an older server", async () => {
    const cases: [TransactionDto, CategoryDto[] | null][] = [
      [{ ...cafe, type: "obligation", want: null }, LIST],
      [{ ...cafe, category: "refund", want: null }, LIST],
      [{ ...cafe, accountKind: "cash" }, LIST],
      [{ ...cafe, want: undefined, wantOverride: undefined }, LIST],
      [cafe, LIST.map((c) => ({ key: c.key, name: c.name, icon: c.icon, system: c.system }))],
      [cafe, null],
    ];
    for (const [tx, list] of cases) {
      const { unmount } = await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi({ categories: jest.fn(async () => list) }));
      await screen.findByText(TYPE_ROW);
      await waitFor(() => expect(screen.queryByText("Эта покупка")).toBeNull());
      await unmount();
    }
  });
});

describe("TxEditSheet: the answer to «Откуда наличные?» can be changed (Б21)", () => {
  const deposit = (cashAnswer: TransactionDto["cashAnswer"]) =>
    txFixture({ id: 12, type: "own_transfer", category: "own", amount: 2_950_000, amountUah: 2_950_000, description: "Термінал City24", cashAnswer });
  const UNTOUCHED = "Баланс Binance при смене этого ответа не изменится — если нужно, поправьте его в «Плане».";
  const RETURNS = "Сумма, которую списал этот ответ, вернётся на Binance — если вы уже поправляли баланс руками, проверьте его после смены ответа.";

  it("shows the same three choices as the question, the current one selected", async () => {
    await renderWith(<TxEditSheet tx={deposit({ answer: "binance", canBinance: true, binanceOnChange: "returns" })} onClose={noop} />, fakeApi());
    expect(await screen.findByText("Откуда наличные")).toBeTruthy();
    expect(selected("Вывод с Binance")).toBe(true);
    expect(selected("Из моих наличных")).toBe(false);
    expect(selected("Другое")).toBe(false);
    expect(screen.getByText(RETURNS)).toBeTruthy();
    expect(screen.queryByText(UNTOUCHED)).toBeNull();
  });

  it("a new answer goes to the server and the sheet closes", async () => {
    const api = fakeApi();
    const onClose = jest.fn();
    await renderWith(<TxEditSheet tx={deposit({ answer: "binance", canBinance: true, binanceOnChange: "returns" })} onClose={onClose} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Из моих наличных" }));
    await waitFor(() => expect(api.changeDepositAnswer).toHaveBeenCalledWith(12, "wallet"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.editTransaction).not.toHaveBeenCalled();
  });

  it("the answer already chosen sends nothing", async () => {
    const api = fakeApi();
    await renderWith(<TxEditSheet tx={deposit({ answer: "wallet", canBinance: true, binanceOnChange: null })} onClose={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Из моих наличных" }));
    expect(api.changeDepositAnswer).not.toHaveBeenCalled();
    expect(screen.queryByText(RETURNS)).toBeNull();
    expect(screen.queryByText(UNTOUCHED)).toBeNull();
  });

  it("an answer given before the server kept it says Binance stays as it is", async () => {
    await renderWith(<TxEditSheet tx={deposit({ answer: "binance", canBinance: true, binanceOnChange: "untouched" })} onClose={noop} />, fakeApi());
    expect(await screen.findByText(UNTOUCHED)).toBeTruthy();
    expect(screen.queryByText(RETURNS)).toBeNull();
  });

  it("with no USDC income to match, Binance is not offered", async () => {
    const tx = deposit({ answer: "other", canBinance: false, binanceOnChange: null });
    await renderWith(<TxEditSheet tx={{ ...tx, type: "cash_in", category: "cash" }} onClose={noop} />, fakeApi());
    await screen.findByText("Откуда наличные");
    expect(chip("Вывод с Binance")).toBeNull();
    expect(selected("Другое")).toBe(true);
  });

  it("a failed change says so and keeps the sheet open", async () => {
    const api = fakeApi({ changeDepositAnswer: jest.fn(async () => Promise.reject(new Error("422"))) });
    const onClose = jest.fn();
    await renderWith(<TxEditSheet tx={deposit({ answer: "wallet", canBinance: true, binanceOnChange: null })} onClose={onClose} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Другое" }));
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("no block on other rows, nor from an older server", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ cashAnswer: null })} onClose={noop} />, fakeApi());
    await screen.findByText(TYPE_ROW);
    expect(screen.queryByText("Откуда наличные")).toBeNull();
    const old = txFixture({ type: "cash_in", amount: 100_000, amountUah: 100_000 });
    delete old.cashAnswer;
    await renderWith(<TxEditSheet tx={old} onClose={noop} />, fakeApi());
    expect(screen.queryByText("Откуда наличные")).toBeNull();
    expect(chip("Из моих наличных")).toBeNull();
  });
});
