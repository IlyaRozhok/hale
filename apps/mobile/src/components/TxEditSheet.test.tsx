import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { TxEditSheet } from "./TxEditSheet";
import { fakeApi, renderWith, txFixture } from "../testing";

const noop = () => undefined;
/** 10 November, 14:32 on the device's own clock, whatever zone the tests run in. */
const at = new Date(2026, 10, 10, 14, 32).toISOString();
const chip = (name: string) => screen.queryByRole("button", { name });
const selected = (name: string) => screen.getByRole("button", { name }).props.accessibilityState.selected;

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

  it("shows the bank's text when the name on top is the counterparty's", async () => {
    const tx = txFixture({ description: "SILPO KYIV UA", counterName: "Сільпо" });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    expect(await screen.findByText("SILPO KYIV UA")).toBeTruthy();
  });

  it("does not repeat the bank's text when it is the name already", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ description: "Кофейня", counterName: null })} onClose={noop} />, fakeApi());
    await screen.findByText(/^Изменится/);
    expect(screen.getAllByText("Кофейня")).toHaveLength(1);
  });

  it("an empty bank text under a name leaves no blank line", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ description: "", counterName: "Сільпо" })} onClose={noop} />, fakeApi());
    await screen.findByText(/^Изменится/);
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
    expect(await screen.findByText("−$10.00 · 10 ноя, 14:32 · Белая карта")).toBeTruthy();
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

  it("own money or an old row: no line", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ creditPart: null })} onClose={noop} />, fakeApi());
    await screen.findByText("Тип");
    expect(screen.queryByText(/кредитного лимита/)).toBeNull();
  });

  it("an older server without the field: no line", async () => {
    const tx = txFixture();
    delete tx.creditPart;
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    await screen.findByText("Тип");
    expect(screen.queryByText(/кредитного лимита/)).toBeNull();
  });
});

describe("TxEditSheet types: the frequent ones and «Ещё»", () => {
  it("money going out: four frequent types, the rest are hidden", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ type: "spend" })} onClose={noop} />, fakeApi());
    await screen.findByText("Тип");
    for (const name of OUT_FREQUENT) expect(chip(name)).toBeTruthy();
    for (const name of ALL.filter((t) => !OUT_FREQUENT.includes(t))) expect(chip(name)).toBeNull();
    expect(selected("Трата")).toBe(true);
    expect(chip("Ещё")).toBeTruthy();
  });

  it("money coming in: three frequent types, the rest are hidden", async () => {
    const tx = txFixture({ type: "income", category: "income", amount: 5_000_000, amountUah: 5_000_000 });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    await screen.findByText("Тип");
    for (const name of IN_FREQUENT) expect(chip(name)).toBeTruthy();
    for (const name of ALL.filter((t) => !IN_FREQUENT.includes(t))) expect(chip(name)).toBeNull();
    expect(selected("Доход")).toBe(true);
    expect(chip("Ещё")).toBeTruthy();
  });

  it("«Ещё» opens the other types in place and saves nothing", async () => {
    const api = fakeApi();
    await renderWith(<TxEditSheet tx={txFixture({ type: "spend" })} onClose={noop} />, api);
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
    await fireEvent.press(await screen.findByRole("button", { name: "Ещё" }));
    await fireEvent.press(screen.getByRole("button", { name: "Налог" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(9, { type: "tax", applyToSimilar: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("a rare type the row already has is in sight and selected without «Ещё»", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ type: "debt_payment", category: "debt" })} onClose={noop} />, fakeApi());
    await screen.findByText("Тип");
    expect(selected("Платёж по долгу")).toBe(true);
    for (const name of OUT_FREQUENT) expect(selected(name)).toBe(false);
    expect(chip("Налог")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Ещё" }));
    expect(screen.getAllByRole("button", { name: "Платёж по долгу" })).toHaveLength(1);
    expect(chip("Налог")).toBeTruthy();
  });

  it("a row with no type yet has nothing selected", async () => {
    await renderWith(<TxEditSheet tx={txFixture({ type: null })} onClose={noop} />, fakeApi());
    await screen.findByText("Тип");
    for (const name of OUT_FREQUENT) expect(selected(name)).toBe(false);
    expect(chip("Не определён")).toBeNull();
  });

  it("a type this app does not know yet draws no empty selected chip", async () => {
    const tx = txFixture({ type: "something_new" as never });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi());
    await screen.findByText("Тип");
    for (const name of OUT_FREQUENT) expect(selected(name)).toBe(false);
    expect(screen.queryAllByRole("button", { name: "" })).toHaveLength(0);
    await fireEvent.press(screen.getByRole("button", { name: "Ещё" }));
    for (const name of ALL) expect(selected(name)).toBe(false);
    expect(screen.queryAllByRole("button", { name: "" })).toHaveLength(0);
  });
});

describe("TxEditSheet: the order and «Применить к похожим»", () => {
  it("the category comes first, then the type, then the switch with its count", async () => {
    const tx = txFixture({ description: "SILPO KYIV UA", counterName: "Сільпо" });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, fakeApi({ similarCount: jest.fn(async () => 14) }));
    await screen.findByText("Изменится 14 операций");
    const texts = screen.getAllByText(/^(SILPO KYIV UA|Категория|Тип|Применить к похожим|Изменится 14 операций)$/).map((t) => String(t.props.children));
    expect(texts).toEqual(["SILPO KYIV UA", "Категория", "Тип", "Применить к похожим", "Изменится 14 операций"]);
  });

  it("the switch decides whether the change goes to similar rows, and hides the count when off", async () => {
    const api = fakeApi({ similarCount: jest.fn(async () => 3) });
    await renderWith(<TxEditSheet tx={txFixture({ id: 7 })} onClose={noop} />, api);
    expect(await screen.findByText("Изменится 3 операции")).toBeTruthy();
    const similar = screen.getByLabelText("Применить к похожим");
    expect(similar.props.value).toBe(true);
    await fireEvent(similar, "valueChange", false);
    expect(screen.queryByText(/^Изменится/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Продукты" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(7, { category: "groceries", applyToSimilar: false }));
  });

  it("left on, a type chip saves for similar rows too", async () => {
    const api = fakeApi();
    await renderWith(<TxEditSheet tx={txFixture({ id: 7 })} onClose={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Между своими" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(7, { type: "own_transfer", applyToSimilar: true }));
  });
});
