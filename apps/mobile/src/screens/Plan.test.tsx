import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert, StyleSheet } from "react-native";
import { Plan } from "./Plan";
import { Today } from "./Today";
import { balanceFixture, fakeApi, goalFixture, loanFixture, loanHistoryFixture, makeClient, renderWith, taxFixture, todayFixture } from "../testing";
import { NetworkError } from "../api/client";
import { TODAY_KEY } from "../api/queries";

jest.mock("../metal", () => {
  const { View } = require("react-native");
  return { LimitVisual: ({ mode, level }: { mode: string; level: number }) => <View testID="limit-visual" accessibilityHint={`${mode}:${level}`} /> };
});

const noop = () => undefined;

describe("Plan, money", () => {
  it("shows own and credit money separately, with the title", async () => {
    await renderWith(<Plan />, fakeApi());
    expect(screen.getByText("План")).toBeTruthy();
    expect(await screen.findByText("Деньги")).toBeTruthy();
    expect(screen.getByText("Свои")).toBeTruthy();
    expect(screen.getByText("₴10,325")).toBeTruthy();
    expect(screen.getByText("Кредитные")).toBeTruthy();
    expect(screen.getByText("₴30,000")).toBeTruthy();
    expect(screen.queryByText("₴40,325")).toBeNull();
  });
});

describe("Plan, loans", () => {
  const history = () =>
    loanHistoryFixture({
      stats: { borrowed: 2_000_000, repaid: 1_500_000, serviceCost: 120_000, stillOpen: 500_000 },
      open: [loanFixture()],
      old: [loanFixture({ id: 8, title: "Розстрочка на картку", manual: false, amount: 300_000, remaining: 300_000, receivedOn: "2026-03-01" })],
      repaid: [loanFixture({ id: 9, title: "Кредит До завтра", manual: false, remaining: 0, repaidOn: "2026-10-20", repaidAmount: 500_000, serviceCost: 20_000, receivedOn: "2026-10-10" })],
    });
  const open = async (api: ReturnType<typeof fakeApi>) => {
    await renderWith(<Plan />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Займы" }));
  };

  it("shows how much was borrowed, returned and spent on servicing, with open and repaid loans", async () => {
    await open(fakeApi({ loanHistory: jest.fn(async () => history()) }));
    expect(await screen.findByText("Взято")).toBeTruthy();
    expect(screen.getByText("₴20,000")).toBeTruthy();
    expect(screen.getByText("Возвращено")).toBeTruthy();
    expect(screen.getByText("₴15,000")).toBeTruthy();
    expect(screen.getByText("На обслуживание")).toBeTruthy();
    expect(screen.getByText("₴1,200")).toBeTruthy();
    expect(screen.getByText("Открытые")).toBeTruthy();
    expect(screen.getByText("Друг")).toBeTruthy();
    expect(screen.getByText("До начала учёта")).toBeTruthy();
    expect(screen.getByText("Погашенные")).toBeTruthy();
    expect(screen.getByText("₴5,000 от 10.10, погашен 20.10, ещё ₴200 на обслуживание")).toBeTruthy();
  });

  it("only a loan entered by hand can be deleted; only an unpaid one can be repaid", async () => {
    await open(fakeApi({ loanHistory: jest.fn(async () => history()) }));
    await screen.findByText("Взято");
    expect(screen.getByRole("button", { name: "Погасил: Друг" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Удалить: Друг" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Погасил: Розстрочка на картку" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Удалить: Розстрочка на картку" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Погасил: Кредит До завтра" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Удалить: Кредит До завтра" })).toBeNull();
  });

  it("closes all the old loans at once, after asking, and shows they have no date", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
    const first = history();
    const second = loanHistoryFixture({ repaid: [loanFixture({ id: 8, title: "Розстрочка на картку", manual: false, remaining: 0, repaidOn: "2026-11-03", repaidDateKnown: false, repaidAmount: 500_000 })] });
    const loanHistory = jest.fn(async () => first).mockResolvedValueOnce(first).mockResolvedValue({ ...first, ...second });
    const api = fakeApi({ loanHistory });
    await open(api);
    await fireEvent.press(await screen.findByRole("button", { name: "Все уже погашены" }));
    expect(api.repayOldLoans).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]![2]!;
    await act(async () => buttons.find((b) => b.text === "Да, погашены")!.onPress!());
    await waitFor(() => expect(api.repayOldLoans).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("₴5,000 от 01.11, погашен, дата неизвестна")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Все уже погашены" })).toBeNull();
    alert.mockRestore();
  });

  it("repaying from the list refreshes it", async () => {
    const api = fakeApi({ loanHistory: jest.fn(async () => history()) });
    await open(api);
    await fireEvent.press(await screen.findByRole("button", { name: "Погасил: Друг" }));
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.repayLoan).toHaveBeenCalledWith(7, expect.objectContaining({ amount: 500_000 })));
    await waitFor(() => expect(api.loanHistory).toHaveBeenCalledTimes(2));
  });

  it("offers a retry when the history does not load, and says when there are no loans", async () => {
    const loanHistory = jest.fn(async (): Promise<ReturnType<typeof history>> => {
      throw new NetworkError();
    });
    const api = fakeApi({ loanHistory });
    await open(api);
    loanHistory.mockImplementation(async () => loanHistoryFixture());
    await fireEvent.press(await screen.findByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Займов пока нет.")).toBeTruthy();
  });
});

describe("Plan, goals", () => {
  const withGoal = (over = {}) => ({ goals: jest.fn(async () => [goalFixture(over)]) });

  it("lists a goal with saved of target and progress", async () => {
    await renderWith(<Plan />, fakeApi(withGoal()));
    expect(await screen.findByText("Подушка")).toBeTruthy();
    expect(screen.getByText("$500 из $5,000")).toBeTruthy();
    const bar = screen.getByLabelText("Прогресс: 10%");
    expect(StyleSheet.flatten((bar.children[0] as unknown as { props: { style: never } }).props.style)).toMatchObject({ width: "10%" });
  });

  it("adds a goal from a name and a target in dollars", async () => {
    const api = fakeApi();
    await renderWith(<Plan />, api);
    await fireEvent.changeText(await screen.findByLabelText("Название цели"), " Машина ");
    await fireEvent.changeText(screen.getByLabelText("Сумма цели, $"), "10 000");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить цель" }));
    await waitFor(() => expect(api.createGoal).toHaveBeenCalledWith({ name: "Машина", target_cents: 1_000_000 }));
    expect(await screen.findByText("Цель добавлена.")).toBeTruthy();
    expect(screen.getByLabelText("Название цели").props.value).toBe("");
  });

  it("does not send a goal without a name or a positive target", async () => {
    const api = fakeApi();
    await renderWith(<Plan />, api);
    await fireEvent.changeText(await screen.findByLabelText("Сумма цели, $"), "0");
    await fireEvent.changeText(screen.getByLabelText("Название цели"), "Машина");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить цель" }));
    expect(await screen.findByText("Проверьте название и сумму.")).toBeTruthy();
    expect(api.createGoal).not.toHaveBeenCalled();
  });

  it("updates the saved amount, zero included, and refreshes the list and Today", async () => {
    const client = makeClient();
    client.setQueryData(TODAY_KEY, todayFixture());
    const api = fakeApi(withGoal());
    await renderWith(<Plan />, api, client);
    await fireEvent.press(await screen.findByRole("button", { name: "Изменить накопленное: Подушка" }));
    await fireEvent.changeText(screen.getByLabelText("Накоплено, $"), "0");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.patchGoal).toHaveBeenCalledWith(1, { saved_cents: 0 }));
    await waitFor(() => expect(api.goals.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(api.today.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(screen.queryByLabelText("Накоплено, $")).toBeNull());
  });

  it("keeps the field and says so when saving fails or the amount is bad", async () => {
    const patchGoal = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(<Plan />, fakeApi({ ...withGoal(), patchGoal }));
    await fireEvent.press(await screen.findByRole("button", { name: "Изменить накопленное: Подушка" }));
    await fireEvent.changeText(screen.getByLabelText("Накоплено, $"), "abc");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Проверьте сумму.")).toBeTruthy();
    expect(patchGoal).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText("Накоплено, $"), "100");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(screen.getByLabelText("Накоплено, $")).toBeTruthy();
  });

  it("deletes only after confirmation", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
    const api = fakeApi(withGoal());
    await renderWith(<Plan />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Удалить цель: Подушка" }));
    expect(api.deleteGoal).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]![2] as { text: string; style?: string; onPress?: () => void }[];
    expect(buttons.find((b) => b.style === "cancel")).toBeTruthy();
    buttons.find((b) => b.style === "destructive")!.onPress!();
    await waitFor(() => expect(api.deleteGoal).toHaveBeenCalledWith(1));
    alert.mockRestore();
  });

  it("says so when goals cannot be loaded", async () => {
    await renderWith(<Plan />, fakeApi({ goals: jest.fn(async () => { throw new NetworkError(); }) }));
    expect(await screen.findByText("Не получилось загрузить цели.")).toBeTruthy();
  });
});

describe("Plan, Binance balance", () => {
  const withBalance = () => ({ manualBalances: jest.fn(async () => [balanceFixture({ id: 1, name: "Other", amount: 1 }), balanceFixture()]) });
  const type = async (text: string) => {
    await fireEvent.changeText(await screen.findByLabelText("Новый баланс Binance, $"), text);
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить баланс" }));
  };

  it("shows the balance in dollars with hryvnias alongside", async () => {
    const client = makeClient();
    client.setQueryData(TODAY_KEY, todayFixture());
    await renderWith(<Plan />, fakeApi(withBalance()), client);
    expect(await screen.findByText("$2,700.00, ₴111,375")).toBeTruthy();
  });

  it("saves a new value, zero included, and refreshes the balance and Today", async () => {
    const api = fakeApi(withBalance());
    const client = makeClient();
    client.setQueryData(TODAY_KEY, todayFixture());
    await renderWith(<Plan />, api, client);
    await screen.findByText(/\$2,700\.00/);
    await type("2 500,50");
    await waitFor(() => expect(api.patchManualBalance).toHaveBeenCalledWith(7, 250_050));
    expect(await screen.findByText("Баланс сохранён.")).toBeTruthy();
    expect(api.manualBalances).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(api.today.mock.calls.length).toBeGreaterThan(1));
    await type("0");
    await waitFor(() => expect(api.patchManualBalance).toHaveBeenLastCalledWith(7, 0));
  });

  it("creates the row the first time", async () => {
    const api = fakeApi();
    await renderWith(<Plan />, api);
    expect(await screen.findByText("Баланс не задан")).toBeTruthy();
    await type("100");
    await waitFor(() => expect(api.createManualBalance).toHaveBeenCalledWith({ name: "Binance", amount: 10_000, currency: "USD" }));
    expect(api.patchManualBalance).not.toHaveBeenCalled();
  });

  it("refuses a bad amount before sending, and reports a failed save or load", async () => {
    const api = fakeApi({
      ...withBalance(),
      patchManualBalance: jest.fn(async () => {
        throw new NetworkError();
      }),
    });
    await renderWith(<Plan />, api);
    await screen.findByText(/\$2,700\.00/);
    await type("abc");
    expect(await screen.findByText("Проверьте сумму.")).toBeTruthy();
    expect(api.patchManualBalance).not.toHaveBeenCalled();
    await type("5");
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
  });

  it("says so when the balance cannot be loaded", async () => {
    const manualBalances = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(<Plan />, fakeApi({ manualBalances }));
    expect(await screen.findByText("Не получилось загрузить баланс.")).toBeTruthy();
  });
});

describe("Plan, tax payments", () => {
  const payments = () =>
    jest.fn(async () => [
      taxFixture({ id: 1, name: "Налог за 2 кв.", amount: 900_000, due_on: "2026-08-20", paid_at: "2026-08-19T09:00:00.000Z" }),
      taxFixture({ id: 2 }),
      taxFixture({ id: 3, kind: "obligation", name: "Квартплата" }),
    ]);

  it("lists tax payments with sum, due date and a paid mark", async () => {
    await renderWith(<Plan />, fakeApi({ payments: payments() }));
    expect(await screen.findByText("Налог за 3 кв.")).toBeTruthy();
    expect(screen.getByText("₴12,000")).toBeTruthy();
    expect(screen.getByText("срок 20.11")).toBeTruthy();
    expect(screen.getByText("Налог за 2 кв.")).toBeTruthy();
    expect(screen.getByText("₴9,000")).toBeTruthy();
    expect(screen.getByText("Оплачен")).toBeTruthy();
    expect(screen.queryByText("Квартплата")).toBeNull();
  });

  it("marks a payment as paid with one tap and reloads the list", async () => {
    const api = fakeApi({ payments: payments() });
    await renderWith(<Plan />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Отметить оплаченным" }));
    await waitFor(() => expect(api.markPaid).toHaveBeenCalledWith(2));
    await waitFor(() => expect(api.payments.mock.calls.length).toBeGreaterThan(1));
  });

  it("adds a payment for a new quarter", async () => {
    const api = fakeApi({ payments: payments() });
    await renderWith(<Plan />, api);
    await fireEvent.changeText(await screen.findByLabelText("Название платежа"), "Налог за 4 кв.");
    await fireEvent.changeText(screen.getByLabelText("Сумма платежа"), "15 000,50");
    await fireEvent.changeText(screen.getByLabelText("Срок оплаты, ГГГГ-ММ-ДД"), "2027-02-20");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить платёж" }));
    await waitFor(() =>
      expect(api.createPayment).toHaveBeenCalledWith({ kind: "tax", name: "Налог за 4 кв.", amount: 1_500_050, currency: "UAH", due_on: "2027-02-20", tax_quarter: "2026-Q4" }),
    );
    await waitFor(() => expect(screen.getByLabelText("Название платежа").props.value).toBe(""));
  });

  it("does not send an incomplete payment", async () => {
    const api = fakeApi({ payments: payments() });
    await renderWith(<Plan />, api);
    await fireEvent.changeText(await screen.findByLabelText("Название платежа"), "Налог");
    await fireEvent.changeText(screen.getByLabelText("Сумма платежа"), "abc");
    await fireEvent.changeText(screen.getByLabelText("Срок оплаты, ГГГГ-ММ-ДД"), "2027-02-20");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить платёж" }));
    expect(await screen.findByText("Проверьте название, сумму и срок.")).toBeTruthy();
    expect(api.createPayment).not.toHaveBeenCalled();
  });

  it("says so when a payment cannot be saved", async () => {
    const createPayment = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(<Plan />, fakeApi({ payments: payments(), createPayment }));
    await fireEvent.changeText(await screen.findByLabelText("Название платежа"), "Налог");
    await fireEvent.changeText(screen.getByLabelText("Сумма платежа"), "100");
    await fireEvent.changeText(screen.getByLabelText("Срок оплаты, ГГГГ-ММ-ДД"), "2027-02-20");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить платёж" }));
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(screen.getByLabelText("Название платежа").props.value).toBe("Налог");
  });
});

describe("Plan, manual loan", () => {
  it("creates a loan and Today then shows the bad case", async () => {
    const badCase = { id: "loan:1", text: "Взят займ ₴5,000 (02.11): столько не хватало." };
    let created = false;
    const api = fakeApi({
      today: jest.fn(async () => todayFixture({ badCases: created ? [badCase] : [] })),
      createLoan: jest.fn(async () => {
        created = true;
      }),
    });
    await renderWith(
      <>
        <Today onOpenActivity={noop} onOpenPlan={noop} />
        <Plan />
      </>,
      api,
    );
    await screen.findByText("Сегодня можно");
    expect(screen.queryByText(badCase.text)).toBeNull();
    await fireEvent.changeText(await screen.findByLabelText("Сумма займа"), "5000");
    await fireEvent.changeText(screen.getByLabelText("Дата займа, ГГГГ-ММ-ДД"), "2026-11-02");
    await fireEvent.changeText(screen.getByLabelText("Заметка к займу"), "до зарплаты");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить займ" }));
    await waitFor(() => expect(api.createLoan).toHaveBeenCalledWith({ amount: 500_000, received_on: "2026-11-02", note: "до зарплаты" }));
    expect(await screen.findByText(badCase.text)).toBeTruthy();
    expect(screen.getByText("Займ добавлен.")).toBeTruthy();
  });

  it("rejects a bad amount or date before sending, and reports a failed save", async () => {
    const createLoan = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(<Plan />, fakeApi({ createLoan }));
    await fireEvent.changeText(await screen.findByLabelText("Сумма займа"), "0");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить займ" }));
    expect(await screen.findByText("Проверьте сумму и дату.")).toBeTruthy();
    expect(createLoan).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText("Сумма займа"), "100");
    await fireEvent.changeText(screen.getByLabelText("Дата займа, ГГГГ-ММ-ДД"), "2026-11-02");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить займ" }));
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
  });
});

