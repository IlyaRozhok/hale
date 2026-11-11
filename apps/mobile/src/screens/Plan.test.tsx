import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert, StyleSheet } from "react-native";
import { Plan } from "./Plan";
import { Today } from "./Today";
import { balanceFixture, fakeApi, goalFixture, loanFixture, loanHistoryFixture, makeClient, openPlanPart, pickDate, renderWith, taxFixture, todayFixture } from "../testing";
import { dateLabel, kyivDate, shiftDate } from "../format";
import { LAYOUT } from "../components/layout";
import { NetworkError } from "../api/client";
import { TODAY_KEY } from "../api/queries";

jest.mock("@react-native-community/slider", () => {
  const React = require("react");
  return { __esModule: true, default: (props: object) => React.createElement("Slider", props) };
});
jest.mock("../metal", () => {
  const { View } = require("react-native");
  return {
    LimitBar: ({ level, state }: { level: number; state: string }) => <View testID="limit-visual" accessibilityHint={`bar:${state}:${level}`} />,
  };
});

const noop = () => undefined;
const press = async (name: string) =>
  ["Доходы", "Платежи", "Рассрочки", "Налоги", "Займы", "Цели", "Наличные", "Binance"].includes(name)
    ? openPlanPart(name)
    : fireEvent.press(await screen.findByRole("button", { name }));

describe("Plan, calm groups", () => {
  it("groups the plan into money, coming in, going out and saving up", async () => {
    await renderWith(<Plan />, fakeApi());
    for (const g of ["Деньги", "Приходит", "Уходит", "Копится"]) expect(await screen.findByText(g)).toBeTruthy();
  });

  it("folds empty parts into one quiet row per group, which unfolds them", async () => {
    await renderWith(<Plan />, fakeApi());
    const more = await screen.findByRole("button", { name: /^Ещё: .*рассрочки/ });
    expect(screen.queryByRole("button", { name: "Рассрочки" })).toBeNull();
    await fireEvent.press(more);
    expect(await screen.findByRole("button", { name: "Рассрочки" })).toBeTruthy();
  });

  it("names a folded brand as it is, and shows the cash once, as its own row", async () => {
    await renderWith(<Plan />, fakeApi({ cash: jest.fn(async () => ({ started: true, start: "2026-11-01", balance: 100_000 })) }));
    expect(await screen.findByRole("button", { name: /^Ещё: Binance/ })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Наличные" })).toBeTruthy();
    expect(screen.queryByText("в том числе наличные")).toBeNull();
  });

  it("a part with something in it stays in view", async () => {
    await renderWith(<Plan />, fakeApi({ payments: jest.fn(async () => [taxFixture()]) }));
    expect(await screen.findByRole("button", { name: "Налоги" })).toBeTruthy();
  });
});

describe("Plan, money", () => {
  it("shows own and credit money separately, with the title", async () => {
    await renderWith(<Plan />, fakeApi());
    expect(screen.getByText("План")).toBeTruthy();
    expect(await screen.findByText("Свои")).toBeTruthy();
    expect(screen.getByText("Деньги")).toBeTruthy();
    expect(screen.getByText("₴10,325")).toBeTruthy();
    expect(screen.getByText("Кредитные")).toBeTruthy();
    expect(screen.getByText("₴30,000")).toBeTruthy();
    expect(screen.queryByText("₴40,325")).toBeNull();
  });

  it("puts no dollars next to hryvnia totals; dollars stay where the money is in dollars", async () => {
    const api = fakeApi({
      today: jest.fn(async () => todayFixture({ accounts: { own: 1_032_500, credit: 3_000_000, fop: 412_500, binance: 0, cash: 0 } })),
      manualBalances: jest.fn(async () => [balanceFixture()]),
    });
    await renderWith(<Plan />, api);
    expect(await screen.findByText("в том числе ФОП")).toBeTruthy();
    expect(screen.getByText("₴10,325")).toBeTruthy();
    expect(screen.getByText("₴4,125")).toBeTruthy();
    expect(screen.getByText("₴30,000")).toBeTruthy();
    expect(await screen.findByText("$2,700")).toBeTruthy();
    // At the fixture's rate of 41.25 the totals used to carry $250, $100 and $727 under them.
    expect(screen.queryAllByText(/\$/).map((t) => t.props.children)).toEqual(["$2,700"]);
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
    await openPlanPart("Займы");
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
    let closed = false;
    const loanHistory = jest.fn(async () => (closed ? { ...first, ...second, old: [] } : first));
    const repayOldLoans = jest.fn(async () => {
      closed = true;
    });
    const api = fakeApi({ loanHistory, repayOldLoans });
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
    const before = api.loanHistory.mock.calls.length;
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.repayLoan).toHaveBeenCalledWith(7, expect.objectContaining({ amount: 500_000 })));
    await waitFor(() => expect(api.loanHistory.mock.calls.length).toBeGreaterThan(before));
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
    expect(screen.getByRole("button", { name: "Новый займ" })).toBeTruthy();
  });
});

describe("Plan, settings", () => {
  it("opens settings from the profile button and closes them", async () => {
    await renderWith(<Plan />, fakeApi());
    expect(screen.queryByText("Потолок трат")).toBeNull();
    await fireEvent.press(await screen.findByRole("button", { name: "Настройки" }));
    expect(await screen.findByText("Потолок трат")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Закрыть" }));
    await waitFor(() => expect(screen.queryByText("Потолок трат")).toBeNull());
  });

  it("settings stay reachable when the data does not load", async () => {
    const api = fakeApi({ today: jest.fn(async () => { throw new Error("offline"); }) });
    await renderWith(<Plan />, api);
    expect(await screen.findByRole("button", { name: "Настройки" })).toBeTruthy();
  });
});

describe("Plan, the screen", () => {
  it("leaves room for the floating menu under the last line", async () => {
    await renderWith(<Plan />, fakeApi());
    let node = screen.getByText("План").parent;
    while (node && node.props.contentContainerStyle === undefined) node = node.parent;
    expect(StyleSheet.flatten(node!.props.contentContainerStyle).paddingBottom).toBeGreaterThanOrEqual(LAYOUT.tabBar);
  });

  it("shows the data first: summaries and no input fields", async () => {
    const api = fakeApi({
      expectedIncomes: jest.fn(async () => [{ id: 1, source: "fop" as const, amount: 1_000_000, currency: "UAH", window_start_day: 25, window_end_day: 25 }]),
      incomeEvents: jest.fn(async () => [{ id: 5, expected_income_id: 1, period: "2026-11", expected_on: "2026-11-25", status: "expected" }]),
      payments: jest.fn(async () => [
        taxFixture({ id: 1, kind: "obligation", name: "Квартира", amount: 100_000, due_on: "2026-11-26" }),
        taxFixture({ id: 2, kind: "installment", name: "Телефон", amount: 200_000, due_on: "2026-12-02" }),
        taxFixture({ id: 3 }),
      ]),
      goals: jest.fn(async () => [goalFixture()]),
      loanHistory: jest.fn(async () => loanHistoryFixture({ stats: { borrowed: 1, repaid: 0, serviceCost: 0, stillOpen: 300_000 } })),
      manualBalances: jest.fn(async () => [balanceFixture()]),
    });
    await renderWith(<Plan />, api);
    expect(await screen.findByText("следующий 25.11, ₴10,000")).toBeTruthy();
    expect(await screen.findByText("ближайший 26.11, ₴1,000")).toBeTruthy();
    expect(screen.getByText("осталось ₴2,000")).toBeTruthy();
    expect(screen.getByText("₴12,000, ближайший 20.11")).toBeTruthy();
    expect(await screen.findByText("открыто ₴3,000")).toBeTruthy();
    expect(await screen.findByText("$500 из $5,000")).toBeTruthy();
    expect(await screen.findByText("$2,700")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/./)).toBeNull();
  });
});

describe("Plan, incomes", () => {
  const withIncome = () => ({
    expectedIncomes: jest.fn(async () => [{ id: 1, source: "usdc" as const, amount: 80_000, currency: "USD", window_start_day: 1, window_end_day: 5 }]),
    incomeEvents: jest.fn(async () => [{ id: 5, expected_income_id: 1, period: "2999-11", expected_on: "2999-11-05", status: "expected" }]),
  });

  it("adds an income, from where it comes and when", async () => {
    const api = fakeApi();
    await renderWith(<Plan />, api);
    await press("Доходы");
    await press("Новый доход");
    await fireEvent.press(screen.getByRole("radio", { name: "ФОП" }));
    await fireEvent.changeText(screen.getByLabelText("Сумма дохода"), "100 000");
    await fireEvent.changeText(screen.getByLabelText("С какого числа"), "20");
    await fireEvent.changeText(screen.getByLabelText("По какое число"), "25");
    await press("Сохранить доход");
    await waitFor(() => expect(api.createExpectedIncome).toHaveBeenCalledWith({ source: "fop", amount: 10_000_000, currency: "UAH", window_start_day: 20, window_end_day: 25 }));
    await waitFor(() => expect(screen.queryByLabelText("Сумма дохода")).toBeNull());
  });

  it("refuses days that do not make a window", async () => {
    const api = fakeApi();
    await renderWith(<Plan />, api);
    await press("Доходы");
    await press("Новый доход");
    await fireEvent.changeText(screen.getByLabelText("Сумма дохода"), "100");
    await fireEvent.changeText(screen.getByLabelText("С какого числа"), "25");
    await fireEvent.changeText(screen.getByLabelText("По какое число"), "20");
    await press("Сохранить доход");
    expect(await screen.findByText("Проверьте сумму и числа.")).toBeTruthy();
    expect(api.createExpectedIncome).not.toHaveBeenCalled();
  });

  it("changes the amount, in the income's own currency, and moves the next date", async () => {
    const api = fakeApi(withIncome());
    await renderWith(<Plan />, api);
    await press("Доходы");
    expect(await screen.findByText("$800, следующий 05.11")).toBeTruthy();
    await press("Изменить: USDC");
    expect(screen.getByLabelText("Сумма дохода").props.value).toBe("800");
    await fireEvent.changeText(screen.getByLabelText("Сумма дохода"), "900");
    await pickDate("Следующий доход", "2999-11-07");
    await press("Сохранить доход");
    await waitFor(() => expect(api.patchExpectedIncome).toHaveBeenCalledWith(1, { amount: 90_000, currency: "USD", window_start_day: 1, window_end_day: 5 }));
    await waitFor(() => expect(api.setIncomeDate).toHaveBeenCalledWith(5, "2999-11-07"));
  });

  it("does not touch the date when it was not changed", async () => {
    const api = fakeApi(withIncome());
    await renderWith(<Plan />, api);
    await press("Доходы");
    await press("Изменить: USDC");
    await press("Сохранить доход");
    await waitFor(() => expect(api.patchExpectedIncome).toHaveBeenCalled());
    expect(api.setIncomeDate).not.toHaveBeenCalled();
  });

  it("deletes only after asking", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
    const api = fakeApi(withIncome());
    await renderWith(<Plan />, api);
    await press("Доходы");
    await press("Удалить: USDC");
    expect(api.deleteExpectedIncome).not.toHaveBeenCalled();
    await act(async () => alert.mock.calls[0]![2]!.find((b) => b.style === "destructive")!.onPress!());
    await waitFor(() => expect(api.deleteExpectedIncome).toHaveBeenCalledWith(1));
    alert.mockRestore();
  });
});

describe("Plan, obligatory payments", () => {
  const withBoth = () => ({
    recurring: jest.fn(async () => [{ id: 3, kind: "obligation" as const, name: "Квартира", amount: 1_700_000, currency: "UAH", day_of_month: 26, active: true }]),
    payments: jest.fn(async () => [
      taxFixture({ id: 10, kind: "obligation", name: "Квартира", amount: 1_700_000, due_on: "2026-11-26", recurring_id: 3 }),
      taxFixture({ id: 11, kind: "obligation", name: "Страховка", amount: 50_000, due_on: "2026-12-10" }),
      taxFixture({ id: 12, kind: "obligation", name: "Старый", paid_at: "2026-10-01T00:00:00Z" }),
    ]),
  });

  it("lists monthly payments and one-off ones, without the rows a monthly one made", async () => {
    await renderWith(<Plan />, fakeApi(withBoth()));
    await press("Платежи");
    expect(await screen.findByText("₴17,000, каждый месяц, 26 числа")).toBeTruthy();
    expect(screen.getByText("₴500, срок 10.12")).toBeTruthy();
    expect(screen.getAllByText("Квартира")).toHaveLength(1);
    expect(screen.queryByText("Старый")).toBeNull();
  });

  it("adds a monthly payment in dollars", async () => {
    const api = fakeApi();
    await renderWith(<Plan />, api);
    await press("Платежи");
    await press("Новый платёж");
    await fireEvent.changeText(screen.getByLabelText("Название"), " Девушке ");
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "800");
    await fireEvent.press(screen.getByRole("radio", { name: "$" }));
    await fireEvent.changeText(screen.getByLabelText("Какого числа"), "26");
    await press("Сохранить платёж");
    await waitFor(() => expect(api.createRecurring).toHaveBeenCalledWith({ name: "Девушке", amount: 80_000, currency: "USD", day_of_month: 26 }));
    await waitFor(() => expect(screen.queryByLabelText("Сумма")).toBeNull());
  });

  it("adds a one-off payment with a date from the calendar", async () => {
    const api = fakeApi();
    const due = shiftDate(kyivDate(), 10);
    await renderWith(<Plan />, api);
    await press("Платежи");
    await press("Новый платёж");
    await fireEvent.changeText(screen.getByLabelText("Название"), "Страховка");
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "500");
    await fireEvent(screen.getByRole("switch", { name: "Каждый месяц" }), "valueChange", false);
    await pickDate("Срок", due);
    await press("Сохранить платёж");
    await waitFor(() => expect(api.createPayment).toHaveBeenCalledWith({ kind: "obligation", name: "Страховка", amount: 50_000, currency: "UAH", due_on: due }));
  });

  it("refuses an incomplete payment or a day outside the month", async () => {
    const api = fakeApi();
    await renderWith(<Plan />, api);
    await press("Платежи");
    await press("Новый платёж");
    await fireEvent.changeText(screen.getByLabelText("Название"), "Квартира");
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "100");
    await fireEvent.changeText(screen.getByLabelText("Какого числа"), "32");
    await press("Сохранить платёж");
    expect(await screen.findByText("Проверьте название, сумму и дату.")).toBeTruthy();
    expect(api.createRecurring).not.toHaveBeenCalled();
  });

  it("changes a monthly payment and a one-off one by their own kind", async () => {
    const api = fakeApi(withBoth());
    await renderWith(<Plan />, api);
    await press("Платежи");
    await press("Изменить: Квартира");
    expect(screen.queryByRole("switch", { name: "Каждый месяц" })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Какого числа"), "28");
    await press("Сохранить платёж");
    await waitFor(() => expect(api.patchRecurring).toHaveBeenCalledWith(3, { name: "Квартира", amount: 1_700_000, currency: "UAH", day_of_month: 28 }));
    await press("Изменить: Страховка");
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "600");
    await press("Сохранить платёж");
    await waitFor(() => expect(api.patchPayment).toHaveBeenCalledWith(11, { name: "Страховка", amount: 60_000, currency: "UAH", due_on: "2026-12-10" }));
  });

  it("deletes each by its own kind, after asking", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
    const api = fakeApi(withBoth());
    await renderWith(<Plan />, api);
    await press("Платежи");
    await press("Удалить: Квартира");
    await act(async () => alert.mock.calls[0]![2]!.find((b) => b.style === "destructive")!.onPress!());
    await waitFor(() => expect(api.deleteRecurring).toHaveBeenCalledWith(3));
    await press("Удалить: Страховка");
    await act(async () => alert.mock.calls[1]![2]!.find((b) => b.style === "destructive")!.onPress!());
    await waitFor(() => expect(api.deletePayment).toHaveBeenCalledWith(11));
    alert.mockRestore();
  });

  it("says so when a save fails, and keeps the form", async () => {
    const api = fakeApi({ createRecurring: jest.fn(async () => { throw new NetworkError(); }) });
    await renderWith(<Plan />, api);
    await press("Платежи");
    await press("Новый платёж");
    await fireEvent.changeText(screen.getByLabelText("Название"), "Квартира");
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "100");
    await fireEvent.changeText(screen.getByLabelText("Какого числа"), "5");
    await press("Сохранить платёж");
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(screen.getByLabelText("Название").props.value).toBe("Квартира");
  });
});

describe("Plan, installments", () => {
  const withPhone = () => ({
    payments: jest.fn(async () => [
      taxFixture({ id: 1, kind: "installment", name: "Телефон", amount: 200_000, due_on: "2026-11-02" }),
      taxFixture({ id: 2, kind: "installment", name: "Телефон", amount: 200_000, due_on: "2026-12-02" }),
    ]),
  });

  it("shows a series as one line", async () => {
    await renderWith(<Plan />, fakeApi(withPhone()));
    await press("Рассрочки");
    expect(await screen.findByText("₴2,000 в месяц, осталось платежей: 2, следующий 02.11")).toBeTruthy();
  });

  it("adds a series", async () => {
    const api = fakeApi();
    const first = shiftDate(kyivDate(), 20);
    await renderWith(<Plan />, api);
    await press("Рассрочки");
    await press("Новая рассрочка");
    await fireEvent.changeText(screen.getByLabelText("Название"), "Ноутбук");
    await fireEvent.changeText(screen.getByLabelText("Платёж в месяц"), "3000");
    await fireEvent.changeText(screen.getByLabelText("Сколько платежей осталось"), "6");
    await pickDate("Первый платёж", first);
    await press("Сохранить рассрочку");
    await waitFor(() => expect(api.createInstallment).toHaveBeenCalledWith({ name: "Ноутбук", amount: 300_000, currency: "UAH", remaining: 6, first_due: first }));
  });

  it("refuses an incomplete series", async () => {
    const api = fakeApi();
    await renderWith(<Plan />, api);
    await press("Рассрочки");
    await press("Новая рассрочка");
    await fireEvent.changeText(screen.getByLabelText("Название"), "Ноутбук");
    await press("Сохранить рассрочку");
    expect(await screen.findByText("Проверьте название, сумму, количество и дату.")).toBeTruthy();
    expect(api.createInstallment).not.toHaveBeenCalled();
  });

  it("changes and deletes the whole series", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
    const api = fakeApi(withPhone());
    await renderWith(<Plan />, api);
    await press("Рассрочки");
    await press("Изменить: Телефон");
    expect(screen.queryByLabelText("Сколько платежей осталось")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Платёж в месяц"), "1500");
    await press("Сохранить рассрочку");
    await waitFor(() => expect(api.patchInstallment).toHaveBeenCalledWith("Телефон", { name: "Телефон", amount: 150_000, currency: "UAH" }));
    await press("Удалить: Телефон");
    await act(async () => alert.mock.calls[0]![2]!.find((b) => b.style === "destructive")!.onPress!());
    await waitFor(() => expect(api.deleteInstallment).toHaveBeenCalledWith("Телефон"));
    alert.mockRestore();
  });
});

describe("Plan, calendar", () => {
  it("does not offer days outside the allowed range", async () => {
    const today = kyivDate();
    const api = fakeApi();
    await renderWith(<Plan />, api);
    await press("Займы");
    await press("Новый займ");
    await fireEvent.press(screen.getByRole("button", { name: `Дата займа: ${dateLabel(today)}` }));
    const tomorrow = shiftDate(today, 1);
    if (tomorrow.slice(0, 7) === today.slice(0, 7)) {
      expect(screen.getByRole("button", { name: dateLabel(tomorrow) }).props.accessibilityState.disabled).toBe(true);
    }
    expect(screen.getByRole("button", { name: dateLabel(today) }).props.accessibilityState.selected).toBe(true);
  });
});

describe("Plan, goals", () => {
  const withGoal = (over = {}) => ({ goals: jest.fn(async () => [goalFixture(over)]) });
  const openNew = async () => {
    await press("Цели");
    await press("Новая цель");
  };

  it("lists a goal with saved of target and progress", async () => {
    await renderWith(<Plan />, fakeApi(withGoal()));
    await press("Цели");
    expect(await screen.findByText("Подушка")).toBeTruthy();
    expect(screen.getAllByText("$500 из $5,000").length).toBeGreaterThan(0);
    const bar = screen.getByLabelText("Прогресс: 10%");
    expect(StyleSheet.flatten((bar.children[0] as unknown as { props: { style: never } }).props.style)).toMatchObject({ width: "10%" });
  });

  it("adds a goal from a name and a target in dollars", async () => {
    const api = fakeApi();
    await renderWith(<Plan />, api);
    await openNew();
    await fireEvent.changeText(await screen.findByLabelText("Название цели"), " Машина ");
    await fireEvent.changeText(screen.getByLabelText("Сумма цели, $"), "10 000");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить цель" }));
    await waitFor(() => expect(api.createGoal).toHaveBeenCalledWith({ name: "Машина", target_cents: 1_000_000 }));
    await waitFor(() => expect(screen.queryByLabelText("Название цели")).toBeNull());
  });

  it("does not send a goal without a name or a positive target", async () => {
    const api = fakeApi();
    await renderWith(<Plan />, api);
    await openNew();
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
    await press("Цели");
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
    await press("Цели");
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
    await press("Цели");
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
    await press("Цели");
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
    await press("Binance");
    expect(await screen.findByText("$2,700.00, ₴111,375")).toBeTruthy();
  });

  it("saves a new value, zero included, and refreshes the balance and Today", async () => {
    const api = fakeApi(withBalance());
    const client = makeClient();
    client.setQueryData(TODAY_KEY, todayFixture());
    await renderWith(<Plan />, api, client);
    await press("Binance");
    await screen.findByText(/\$2,700\.00/);
    await type("2 500,50");
    await waitFor(() => expect(api.patchManualBalance).toHaveBeenCalledWith(7, 250_050));
    expect(await screen.findByText("Баланс сохранён.")).toBeTruthy();
    await waitFor(() => expect(api.manualBalances.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(api.today.mock.calls.length).toBeGreaterThan(1));
    await type("0");
    await waitFor(() => expect(api.patchManualBalance).toHaveBeenLastCalledWith(7, 0));
  });

  it("creates the row the first time", async () => {
    const api = fakeApi();
    await renderWith(<Plan />, api);
    await press("Binance");
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
    await press("Binance");
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
    await press("Binance");
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
    await press("Налоги");
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
    await press("Налоги");
    await fireEvent.press(await screen.findByRole("button", { name: "Отметить оплаченным" }));
    await waitFor(() => expect(api.markPaid).toHaveBeenCalledWith(2));
    await waitFor(() => expect(api.payments.mock.calls.length).toBeGreaterThan(1));
  });

  it("adds a payment for a new quarter", async () => {
    const api = fakeApi({ payments: payments() });
    await renderWith(<Plan />, api);
    await press("Налоги");
    await press("Новый налог");
    await fireEvent.changeText(await screen.findByLabelText("Название платежа"), "Налог за 4 кв.");
    await fireEvent.changeText(screen.getByLabelText("Сумма платежа"), "15 000,50");
    await pickDate("Срок оплаты", "2027-02-20");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить налог" }));
    await waitFor(() =>
      expect(api.createPayment).toHaveBeenCalledWith({ kind: "tax", name: "Налог за 4 кв.", amount: 1_500_050, currency: "UAH", due_on: "2027-02-20", tax_quarter: "2026-Q4" }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Название платежа")).toBeNull());
  });

  it("does not send an incomplete payment", async () => {
    const api = fakeApi({ payments: payments() });
    await renderWith(<Plan />, api);
    await press("Налоги");
    await press("Новый налог");
    await fireEvent.changeText(await screen.findByLabelText("Название платежа"), "Налог");
    await fireEvent.changeText(screen.getByLabelText("Сумма платежа"), "abc");
    await pickDate("Срок оплаты", "2027-02-20");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить налог" }));
    expect(await screen.findByText("Проверьте название, сумму и срок.")).toBeTruthy();
    expect(api.createPayment).not.toHaveBeenCalled();
  });

  it("says so when a payment cannot be saved", async () => {
    const createPayment = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(<Plan />, fakeApi({ payments: payments(), createPayment }));
    await press("Налоги");
    await press("Новый налог");
    await fireEvent.changeText(await screen.findByLabelText("Название платежа"), "Налог");
    await fireEvent.changeText(screen.getByLabelText("Сумма платежа"), "100");
    await pickDate("Срок оплаты", "2027-02-20");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить налог" }));
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
        <Today onOpenActivity={noop} />
        <Plan />
      </>,
      api,
    );
    await screen.findByText("Сегодня можно");
    expect(screen.queryByText(badCase.text)).toBeNull();
    await press("Займы");
    await press("Новый займ");
    const day = shiftDate(kyivDate(), -1);
    await fireEvent.changeText(await screen.findByLabelText("Сумма займа"), "5000");
    await pickDate("Дата займа", day);
    await fireEvent.changeText(screen.getByLabelText("Заметка к займу"), "до зарплаты");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить займ" }));
    await waitFor(() => expect(api.createLoan).toHaveBeenCalledWith({ amount: 500_000, received_on: day, note: "до зарплаты" }));
    expect(await screen.findByText(badCase.text)).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText("Сумма займа")).toBeNull());
  });

  it("rejects a bad amount or date before sending, and reports a failed save", async () => {
    const createLoan = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(<Plan />, fakeApi({ createLoan }));
    await press("Займы");
    await press("Новый займ");
    await fireEvent.changeText(await screen.findByLabelText("Сумма займа"), "0");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить займ" }));
    expect(await screen.findByText("Проверьте сумму и дату.")).toBeTruthy();
    expect(createLoan).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText("Сумма займа"), "100");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить займ" }));
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
  });
});

