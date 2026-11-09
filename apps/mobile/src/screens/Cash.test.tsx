import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { Activity } from "./Activity";
import { Plan } from "./Plan";
import { Today } from "./Today";
import { fakeApi, renderWith, todayFixture, txFixture } from "../testing";
import { kyivDate } from "../format";
import { ApiError } from "../api/client";

jest.mock("../metal", () => {
  const { View } = require("react-native");
  return { LimitBar: () => <View testID="limit-visual" /> };
});

const noop = () => undefined;
const press = async (name: string | RegExp) => fireEvent.press(await screen.findByRole("button", { name }));
const started = () => ({ cash: jest.fn(async () => ({ started: true, start: "2026-11-01", balance: 250_000 })) });
const notStarted = () => ({ cash: jest.fn(async () => ({ started: false, start: null, balance: 0 })) });
const manual = txFixture({ id: 5, manual: true, accountKind: "cash", description: "Рынок", amount: -30_000, amountUah: -30_000, category: "groceries", localDate: kyivDate() });

describe("adding a cash operation from Today", () => {
  it("a purchase: amount, category, save", async () => {
    const api = fakeApi(started());
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await press("Добавить операцию");
    await fireEvent.changeText(await screen.findByLabelText("Сумма"), "300,50");
    await press("Кафе и рестораны");
    await press("Сохранить");
    await waitFor(() => expect(api.addCashOperation).toHaveBeenCalledWith({ kind: "spend", amount: 30_050, category: "cafe", date: kyivDate() }));
    await waitFor(() => expect(screen.queryByLabelText("Сумма")).toBeNull());
  });

  it("other kinds need no category and keep a note", async () => {
    const api = fakeApi(started());
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await press("Добавить операцию");
    await press("Получил");
    expect(screen.queryByRole("button", { name: "Кафе и рестораны" })).toBeNull();
    await fireEvent.changeText(await screen.findByLabelText("Сумма"), "1000");
    await fireEvent.changeText(screen.getByLabelText("Заметка"), "Вернули долг");
    await press("Сохранить");
    await waitFor(() => expect(api.addCashOperation).toHaveBeenCalledWith({ kind: "received", amount: 100_000, date: kyivDate(), note: "Вернули долг" }));
  });

  it("asks for an amount and a category before saving", async () => {
    const api = fakeApi(started());
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await press("Добавить операцию");
    await press("Сохранить");
    expect(await screen.findByText("Введите сумму и выберите категорию.")).toBeTruthy();
    expect(api.addCashOperation).not.toHaveBeenCalled();
  });

  it("starts the wallet first when it is not started", async () => {
    const api = fakeApi(notStarted());
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await press("Добавить операцию");
    expect(await screen.findByText(/Сколько наличных у вас сейчас/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Наличные сейчас"), "2500");
    api.cash.mockResolvedValue({ started: true, start: kyivDate(), balance: 250_000 });
    await press("Начать учёт");
    await waitFor(() => expect(api.startCash).toHaveBeenCalledWith({ amount: 250_000 }));
    expect(await screen.findByLabelText("Сумма")).toBeTruthy();
  });
});

describe("the cash question", () => {
  const question = (id: string) => todayFixture({ questions: [{ id, kind: "cash_source", text: "Внесено ₴2,000 (10.11). Откуда наличные?" }] });

  it("from the wallet, from Binance, or other", async () => {
    const api = fakeApi({ today: jest.fn(async () => question("cash_source:42:7")) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: /^Вопросы: / }));
    expect(screen.getByRole("button", { name: "Вывод с Binance" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Другое" })).toBeTruthy();
    await press("Из кошелька");
    await waitFor(() => expect(api.depositFromWallet).toHaveBeenCalledWith(42));
  });

  it("offers Binance only with a USDC income to match", async () => {
    const api = fakeApi({ today: jest.fn(async () => question("cash_source:42:0")) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: /^Вопросы: / }));
    expect(screen.queryByRole("button", { name: "Вывод с Binance" })).toBeNull();
    await press("Другое");
    await waitFor(() => expect(api.dismissUsdcMatch).toHaveBeenCalledWith(42));
  });
});

describe("the wallet in Plan", () => {
  it("shows the balance, and counting less records the gap as spent", async () => {
    const api = fakeApi(started());
    await renderWith(<Plan />, api);
    await press(/^Наличные/);
    expect(await screen.findByText("По записям ₴2,500, учёт с 01.11")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Сколько в кармане"), "2000");
    expect(screen.getByText("₴500 запишется тратой «Не записано» за сегодня.")).toBeTruthy();
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
    expect(await screen.findByText("Изменить тип или категорию")).toBeTruthy();
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

describe("a payment in «Скоро платить»", () => {
  const overdue = () => todayFixture({ date: "2026-11-09", upcoming: [{ id: "3", name: "Квартплата", amount: 1_700_000, dueOn: "2026-11-06", kind: "obligation", currency: "UAH" }] });
  const wallet = (balance: number, isStarted = true) => ({ cash: jest.fn(async () => ({ started: isStarted, start: isStarted ? "2026-11-01" : null, balance })) });

  it("marks an overdue payment calmly", async () => {
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => overdue()) }));
    expect(await screen.findByText("просрочен")).toBeTruthy();
  });

  it("an upcoming one is not marked", async () => {
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi());
    await screen.findByText("Квартплата");
    expect(screen.queryByText("просрочен")).toBeNull();
  });

  it("is marked paid in one tap, without cash when the wallet is not started", async () => {
    const api = fakeApi({ today: jest.fn(async () => overdue()), ...wallet(0, false) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await press(/^Квартплата/);
    expect(screen.queryByLabelText("Наличными из кошелька")).toBeNull();
    await press("Оплачено");
    await waitFor(() => expect(api.markPaid).toHaveBeenCalledWith(3));
    expect(api.payFromWallet).not.toHaveBeenCalled();
  });

  it("is paid from the wallet when it covers the payment", async () => {
    const api = fakeApi({ today: jest.fn(async () => overdue()), ...wallet(2_000_000) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await press(/^Квартплата/);
    await fireEvent(await screen.findByLabelText("Наличными из кошелька"), "valueChange", true);
    expect(screen.getByText("Наличные уменьшатся на ₴17,000, лимит не изменится.")).toBeTruthy();
    await press("Оплачено");
    await waitFor(() => expect(api.payFromWallet).toHaveBeenCalledWith(3));
    expect(api.markPaid).not.toHaveBeenCalled();
  });

  it("cannot be paid from a wallet that has less", async () => {
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => overdue()), ...wallet(1_000_000) }));
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
