import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { Activity } from "./Activity";
import { Plan } from "./Plan";
import { Today } from "./Today";
import { MainTabs } from "../MainTabs";
import { fakeApi, renderWith, todayFixture, txFixture } from "../testing";
import { kyivDate } from "../format";
import { ApiError } from "../api/client";
import { MANUAL_BALANCES_KEY } from "../api/queries";

jest.mock("../metal", () => {
  const { View } = require("react-native");
  return { LimitBar: () => <View testID="limit-visual" /> };
});

const noop = () => undefined;
const press = async (name: string | RegExp) => fireEvent.press(await screen.findByRole("button", { name }));
const started = () => ({ cash: jest.fn(async () => ({ started: true, start: "2026-11-01", balance: 250_000 })) });
const notStarted = () => ({ cash: jest.fn(async () => ({ started: false, start: null, balance: 0 })) });
const manual = txFixture({ id: 5, manual: true, accountKind: "cash", description: "Рынок", amount: -30_000, amountUah: -30_000, category: "groceries", localDate: kyivDate() });

/** The tabs with «+» («Добавить»), as on every screen. */
const menu = <MainTabs />;
const openAdd = async () => fireEvent.press(await screen.findByRole("tab", { name: "Добавить" }));

describe("adding a cash operation from the menu", () => {
  it("a purchase: amount, category, save", async () => {
    const api = fakeApi(started());
    await renderWith(menu, api);
    await openAdd();
    await press("Трата");
    await fireEvent.changeText(await screen.findByLabelText("Сумма"), "300,50");
    await press("Кафе и рестораны");
    await press("Сохранить");
    await waitFor(() => expect(api.addCashOperation).toHaveBeenCalledWith({ kind: "spend", amount: 30_050, category: "cafe", date: kyivDate() }));
    await waitFor(() => expect(screen.queryByLabelText("Сумма")).toBeNull());
  });

  it("other kinds need no category and keep a note", async () => {
    const api = fakeApi(started());
    await renderWith(menu, api);
    await openAdd();
    await press("Получил");
    expect(screen.queryByRole("button", { name: "Кафе и рестораны" })).toBeNull();
    await fireEvent.changeText(await screen.findByLabelText("Сумма"), "1000");
    await fireEvent.changeText(screen.getByLabelText("Заметка"), "Вернули долг");
    await press("Сохранить");
    await waitFor(() => expect(api.addCashOperation).toHaveBeenCalledWith({ kind: "received", amount: 100_000, date: kyivDate(), note: "Вернули долг" }));
  });

  it("asks for an amount and a category before saving", async () => {
    const api = fakeApi(started());
    await renderWith(menu, api);
    await openAdd();
    await press("Трата");
    await press("Сохранить");
    expect(await screen.findByText("Введите сумму и выберите категорию.")).toBeTruthy();
    expect(api.addCashOperation).not.toHaveBeenCalled();
  });

  it("starts the wallet with the first purchase when it is not started (Д5)", async () => {
    const api = fakeApi(notStarted());
    await renderWith(menu, api);
    await openAdd();
    await press("Трата");
    await fireEvent.changeText(await screen.findByLabelText("Наличные после этой траты"), "2500");
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "300");
    await press("Кафе и рестораны");
    await press("Сохранить");
    await waitFor(() => expect(api.addCashOperation).toHaveBeenCalledWith({ kind: "spend", amount: 30_000, category: "cafe", date: kyivDate() }));
    // ₴2,500 is what is left after the purchase: the wallet starts at ₴2,800.
    expect(api.startCash).toHaveBeenCalledWith({ amount: 280_000 });
  });
});

describe("USDC exchanged for cash (Б22)", () => {
  const exchanged = txFixture({
    id: 7, manual: true, accountKind: "cash", type: "own_transfer", category: "own", description: "Обмен USDC на наличные",
    amount: 6_543_000, amountUah: 6_543_000, localDate: kyivDate(), inLimit: false, exchange: { usdc: 140_000, rate: 46.74 },
  });
  const listed = () => ({ transactions: jest.fn(async () => ({ items: [exchanged], nextCursor: null, dayTotals: {} })), ...started() });

  it("a fourth kind with two amounts, a sentence that follows them, and one save", async () => {
    const api = fakeApi(started());
    const { client } = await renderWith(menu, api);
    const refetched = jest.spyOn(client, "invalidateQueries");
    await openAdd();
    await press("Перевёл между своими");
    await press("Обменял USDC");
    expect(screen.queryByLabelText("Сумма")).toBeNull();
    expect(screen.getByText("Binance уменьшится на отданные USDC, наличных станет больше. Это перевод между своими, не доход.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Отдал USDC, $"), "1400");
    await fireEvent.changeText(screen.getByLabelText("Получил наличными, ₴"), "65430");
    expect(
      screen.getByText("Курс обмена ₴46.74 за $1. Binance уменьшится на $1,400, наличных станет больше на ₴65,430. Это перевод между своими, не доход."),
    ).toBeTruthy();
    await press("Сохранить");
    await waitFor(() => expect(api.addCashOperation).toHaveBeenCalledWith({ kind: "exchange", usdc: 140_000, amount: 6_543_000, date: kyivDate() }));
    // Binance changed on the server: Plan reads it afresh.
    await waitFor(() => expect(refetched).toHaveBeenCalledWith({ queryKey: MANUAL_BALANCES_KEY }));
  });

  it("asks for both amounts before saving", async () => {
    const api = fakeApi(started());
    await renderWith(menu, api);
    await openAdd();
    await press("Перевёл между своими");
    await press("Обменял USDC");
    await fireEvent.changeText(screen.getByLabelText("Получил наличными, ₴"), "65430");
    await press("Сохранить");
    expect(await screen.findByText("Введите, сколько USDC отдали и сколько гривен получили.")).toBeTruthy();
    expect(api.addCashOperation).not.toHaveBeenCalled();
  });

  it("shows one row in Activity: the dollars and the rate, the hryvnias, and «свои»", async () => {
    await renderWith(<Activity />, fakeApi(listed()));
    expect(await screen.findByText("Обмен USDC на наличные")).toBeTruthy();
    expect(screen.getByText("$1,400 · курс ₴46.74")).toBeTruthy();
    expect(screen.getByText("+₴65,430")).toBeTruthy();
    expect(screen.getByText("свои")).toBeTruthy();
    expect(screen.queryByText("Между своими")).toBeNull();
  });

  it("opens with its kind and both amounts, and saves them", async () => {
    const api = fakeApi(listed());
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Обмен USDC на наличные"));
    expect((await screen.findByRole("button", { name: "Обменял USDC" })).props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText("Отдал USDC, $").props.value).toBe("1400");
    const uah = screen.getByLabelText("Получил наличными, ₴");
    expect(uah.props.value).toBe("65430");
    await fireEvent.changeText(uah, "65000");
    await press("Сохранить");
    await waitFor(() =>
      expect(api.patchCashOperation).toHaveBeenCalledWith(7, {
        kind: "exchange", usdc: 140_000, amount: 6_500_000, date: exchanged.localDate, note: "Обмен USDC на наличные",
      }),
    );
  });
});

describe("the cash question", () => {
  const question = (id: string) => todayFixture({ questions: [{ id, kind: "cash_source", text: "Внесено ₴2,000 (10.11). Откуда наличные?" }] });

  it("from the wallet, from Binance, or other", async () => {
    const api = fakeApi({ today: jest.fn(async () => question("cash_source:42:7")) });
    await renderWith(<Today onOpenActivity={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: /^Вопросы: / }));
    expect(screen.getByRole("button", { name: "Вывод с Binance" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Другое" })).toBeTruthy();
    await press("Из кошелька");
    await waitFor(() => expect(api.depositFromWallet).toHaveBeenCalledWith(42));
  });

  it("offers Binance only with a USDC income to match", async () => {
    const api = fakeApi({ today: jest.fn(async () => question("cash_source:42:0")) });
    await renderWith(<Today onOpenActivity={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: /^Вопросы: / }));
    expect(screen.queryByRole("button", { name: "Вывод с Binance" })).toBeNull();
    await press("Другое");
    await waitFor(() => expect(api.dismissUsdcMatch).toHaveBeenCalledWith(42));
  });
});

describe("the wallet in Plan", () => {
  it("shows the balance, and counting less records the gap as «Не записано», out of the day's limit (Б47 (2))", async () => {
    const api = fakeApi(started());
    await renderWith(<Plan />, api);
    await press(/^Наличные/);
    expect(await screen.findByText("По записям ₴2,500, учёт с 01.11")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Сколько в кармане"), "2000");
    expect(screen.getByText("₴500 запишется как «Не записано» за сегодня. Лимит дня не изменится.")).toBeTruthy();
    expect(screen.queryByText(/запишется тратой/)).toBeNull();
    await press("Пересчитал");
    await waitFor(() => expect(api.countCash).toHaveBeenCalledWith(200_000));
  });

  it("counting more only corrects the balance", async () => {
    await renderWith(<Plan />, fakeApi(started()));
    await press(/^Наличные/);
    await fireEvent.changeText(await screen.findByLabelText("Сколько в кармане"), "3000");
    expect(screen.getByText("Остаток станет больше на ₴500, лимит не изменится.")).toBeTruthy();
  });

  it("starts the wallet from the line when not started", async () => {
    const api = fakeApi(notStarted());
    await renderWith(<Plan />, api);
    expect(await screen.findByText("не начат")).toBeTruthy();
    await press(/^Наличные/);
    await fireEvent.changeText(await screen.findByLabelText("Наличные сейчас"), "0");
    await press("Начать учёт");
    await waitFor(() => expect(api.startCash).toHaveBeenCalledWith({ amount: 0 }));
  });

  it("shows cash once, as its own row under money, with the wallet's balance", async () => {
    await renderWith(<Plan />, fakeApi({ ...started(), today: jest.fn(async () => todayFixture({ accounts: { own: 1_282_500, credit: 3_000_000, fop: 0, binance: 0, cash: 250_000 } })) }));
    expect(await screen.findByRole("button", { name: "Наличные" })).toBeTruthy();
    expect(await screen.findByText("₴2,500")).toBeTruthy();
    expect(screen.queryByText("в том числе наличные")).toBeNull();
  });
});

describe("an operation entered by hand, in Activity", () => {
  it("opens for change, and saves the new amount", async () => {
    const api = fakeApi({ transactions: jest.fn(async () => ({ items: [manual], nextCursor: null, dayTotals: {} })), ...started() });
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Рынок"));
    const amount = await screen.findByLabelText("Сумма");
    expect(amount.props.value).toBe("300");
    await fireEvent.changeText(amount, "450");
    await press("Сохранить");
    await waitFor(() => expect(api.patchCashOperation).toHaveBeenCalledWith(5, { kind: "spend", amount: 45_000, category: "groceries", date: manual.localDate, note: "Рынок" }));
  });

  it("deletes after asking", async () => {
    const alert = jest.spyOn(Alert, "alert");
    const api = fakeApi({ transactions: jest.fn(async () => ({ items: [manual], nextCursor: null, dayTotals: {} })), ...started() });
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Рынок"));
    await press("Удалить");
    const buttons = alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === "Удалить")!.onPress!();
    await waitFor(() => expect(api.deleteCashOperation).toHaveBeenCalledWith(5));
  });

  it("a bank row still opens the type editor", async () => {
    await renderWith(<Activity />, fakeApi());
    await fireEvent.press(await screen.findByText("Кофейня"));
    expect(await screen.findByText("Тип")).toBeTruthy();
    expect(screen.getByText("Категория")).toBeTruthy();
  });

  const KIND_CHIPS = ["Трата", "Получил", "Отдал в свои", "Обменял USDC"];
  const surplus = txFixture({
    id: 11, manual: true, accountKind: "cash", type: "own_transfer", category: "own", description: "Сверка: больше, чем записано",
    amount: 2_950_000, amountUah: 2_950_000, localDate: kyivDate(), exchange: null,
  });

  it("a correction of the balance opens without kinds and saves no kind, so it stays a plus", async () => {
    const api = fakeApi({ transactions: jest.fn(async () => ({ items: [surplus], nextCursor: null, dayTotals: {} })), ...started() });
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Сверка: больше, чем записано"));
    const amount = await screen.findByLabelText("Сумма");
    expect(amount.props.value).toBe("29500");
    for (const label of KIND_CHIPS) expect(screen.queryByRole("button", { name: label })).toBeNull();
    expect(screen.queryByText(/Наличных меньше/)).toBeNull();
    expect(screen.getByText("Поправка остатка наличных.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Удалить" })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Заметка"), "Нашёл в куртке");
    await press("Сохранить");
    await waitFor(() => expect(api.patchCashOperation).toHaveBeenCalledWith(11, { amount: 2_950_000, date: surplus.localDate, note: "Нашёл в куртке" }));
  });

  it("«Отдал в свои» still opens with its kinds", async () => {
    const own = txFixture({ id: 12, manual: true, accountKind: "cash", type: "own_transfer", category: "own", description: "Купил USDC", amount: -50_000, amountUah: -50_000, localDate: kyivDate(), exchange: null });
    const api = fakeApi({ transactions: jest.fn(async () => ({ items: [own], nextCursor: null, dayTotals: {} })), ...started() });
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Купил USDC"));
    expect((await screen.findByRole("button", { name: "Отдал в свои" })).props.accessibilityState.selected).toBe(true);
    for (const label of KIND_CHIPS) expect(screen.getByRole("button", { name: label })).toBeTruthy();
    // Four kinds do not fit the native switch: they stay chips.
    expect(screen.queryByTestId("cash-kind")).toBeNull();
    await press("Сохранить");
    await waitFor(() => expect(api.patchCashOperation).toHaveBeenCalledWith(12, { kind: "own_out", amount: 50_000, date: own.localDate, note: "Купил USDC" }));
  });

  it("shows a failed save calmly", async () => {
    const api = fakeApi({
      transactions: jest.fn(async () => ({ items: [manual], nextCursor: null, dayTotals: {} })),
      patchCashOperation: jest.fn(async () => { throw new ApiError(500); }),
      ...started(),
    });
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Рынок"));
    await press("Сохранить");
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
  });
});

describe("a payment that is waiting, from the phrase of the day", () => {
  const overdue = () => todayFixture({ date: "2026-11-09", upcoming: [{ id: "3", name: "Квартплата", amount: 1_700_000, dueOn: "2026-11-06", kind: "obligation", currency: "UAH" }] });
  const wallet = (balance: number, isStarted = true) => ({ cash: jest.fn(async () => ({ started: isStarted, start: isStarted ? "2026-11-01" : null, balance })) });

  it("names an overdue payment calmly, without the word and without red", async () => {
    await renderWith(<Today onOpenActivity={noop} />, fakeApi({ today: jest.fn(async () => overdue()) }));
    expect(await screen.findByText("Квартплата ждёт с 6 ноя. Отметьте, если уже оплачено.")).toBeTruthy();
    expect(screen.queryByText("просрочен")).toBeNull();
  });

  it("is marked paid in one tap, without cash when the wallet is not started", async () => {
    const api = fakeApi({ today: jest.fn(async () => overdue()), ...wallet(0, false) });
    await renderWith(<Today onOpenActivity={noop} />, api);
    await press(/^Квартплата/);
    expect(screen.queryByLabelText("Наличными из кошелька")).toBeNull();
    await press("Оплачено");
    await waitFor(() => expect(api.markPaid).toHaveBeenCalledWith(3));
    expect(api.payFromWallet).not.toHaveBeenCalled();
  });

  it("is paid from the wallet when it covers the payment", async () => {
    const api = fakeApi({ today: jest.fn(async () => overdue()), ...wallet(2_000_000) });
    await renderWith(<Today onOpenActivity={noop} />, api);
    await press(/^Квартплата/);
    await fireEvent(await screen.findByLabelText("Наличными из кошелька"), "valueChange", true);
    expect(screen.getByText("Наличные уменьшатся на ₴17,000, лимит не изменится.")).toBeTruthy();
    await press("Оплачено");
    await waitFor(() => expect(api.payFromWallet).toHaveBeenCalledWith(3));
    expect(api.markPaid).not.toHaveBeenCalled();
  });

  it("cannot be paid from a wallet that has less", async () => {
    await renderWith(<Today onOpenActivity={noop} />, fakeApi({ today: jest.fn(async () => overdue()), ...wallet(1_000_000) }));
    await press(/^Квартплата/);
    expect((await screen.findByLabelText("Наличными из кошелька")).props.disabled).toBe(true);
    expect(screen.getByText("В кошельке по записям ₴10,000. Если наличные были до начала учёта, просто отметьте оплату.")).toBeTruthy();
  });
});

describe("a planned payment paid from the wallet, in Activity", () => {
  it("can only be deleted, which opens the payment again", async () => {
    const paid = txFixture({ id: 9, manual: true, accountKind: "cash", type: "obligation", description: "Квартплата", amount: -1_700_000, amountUah: -1_700_000, category: "transfer" });
    const api = fakeApi({ transactions: jest.fn(async () => ({ items: [paid], nextCursor: null, dayTotals: {} })), ...started() });
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Квартплата"));
    expect(await screen.findByText("Платёж из плана, оплачен наличными. Если удалить, платёж снова станет неоплаченным.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull();
    expect(screen.getByRole("button", { name: "Удалить" })).toBeTruthy();
  });
});

describe("a cash purchase's categories (В5)", () => {
  it("are the server's, own ones included, without «Возвраты»", async () => {
    const categories = jest.fn(async () => [
      { key: "groceries", name: "Еда", icon: "cart" as const, system: false },
      { key: "c_cat", name: "Кот", icon: "paw" as const, system: false },
      { key: "refund", name: "Возвраты", icon: "arrowIn" as const, system: true },
      { key: "uncategorized", name: "Без категории", icon: "circle" as const, system: true },
    ]);
    const api = fakeApi({ ...started(), categories });
    await renderWith(menu, api);
    await openAdd();
    await press("Трата");
    await fireEvent.changeText(await screen.findByLabelText("Сумма"), "120");
    await press("Кот");
    expect(screen.queryByRole("button", { name: "Возвраты" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Кафе и рестораны" })).toBeNull();
    await press("Сохранить");
    await waitFor(() => expect(api.addCashOperation).toHaveBeenCalledWith({ kind: "spend", amount: 12_000, category: "c_cat", date: kyivDate() }));
  });

  it("an operation of an own category opens with it chosen", async () => {
    const categories = jest.fn(async () => [{ key: "c_cat", name: "Кот", icon: "paw" as const, system: false }]);
    const own = { ...manual, category: "c_cat" };
    await renderWith(<Activity />, fakeApi({ transactions: jest.fn(async () => ({ items: [own], nextCursor: null, dayTotals: {} })), ...started(), categories }));
    await fireEvent.press(await screen.findByText("Рынок"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Кот" }).props.accessibilityState.selected).toBe(true));
  });
});
