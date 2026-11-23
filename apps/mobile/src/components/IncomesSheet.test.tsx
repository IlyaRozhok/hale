import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { Alert, StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import type { ExpectedIncomeDto, OwnMoneyItemDto } from "@hale/contracts";
import { IncomesSheet } from "./IncomesSheet";
import { fakeApi, renderWith, todayWithItems } from "../testing";

const noop = () => undefined;
const press = async (name: string | RegExp) => fireEvent.press(await screen.findByRole("button", { name }));

const places: OwnMoneyItemDto[] = [
  { kind: "fop", name: "ФОП", own: 0, source: "account", id: 4 },
  { kind: "white", name: "Белая карта", own: 1_431_300, source: "account", id: 5 },
  { kind: "cash", name: "Наличные", own: 3_025_000, source: "cash" },
  { kind: "binance", name: "Binance", own: 579_900, currency: "USD", amount: 12_600, source: "manual", id: 7 },
];

const fop: ExpectedIncomeDto = {
  id: 1, source: "fop", amount: 500_000, currency: "USD", window_start_day: 1, window_end_day: 5, name: "ФОП", schedule: "monthly",
  second_day: null, pays_fop_tax: true, crypto: false, account: { source: "account", id: 4 },
};
const usdc: ExpectedIncomeDto = {
  id: 2, source: "usdc", amount: 120_000, currency: "USD", window_start_day: 20, window_end_day: 20, name: "USDC", schedule: "monthly",
  second_day: null, pays_fop_tax: false, crypto: true, account: { source: "manual", id: 7 },
};

const api = (incomes: ExpectedIncomeDto[] = [fop, usdc]) =>
  fakeApi({
    today: jest.fn(async () => todayWithItems(places)),
    expectedIncomes: jest.fn(async () => incomes),
    incomeEvents: jest.fn(async () => [
      { id: 5, expected_income_id: 1, period: "2999-12", expected_on: "2999-12-01", status: "expected", slot: 1 },
      { id: 6, expected_income_id: 2, period: "2999-12", expected_on: "2999-12-20", status: "expected", slot: 1 },
    ]),
  });

const taxSwitch = () => screen.getByLabelText("С этого дохода платится налог ФОП");
const cryptoSwitch = () => screen.getByLabelText("Приходит в крипте — спросить о выводе");

describe("IncomesSheet, a list of named incomes (Д3б, variant А)", () => {
  it("shows each income as a row with its amount, when and where, and no footnote under the list", async () => {
    await renderWith(<IncomesSheet onClose={noop} />, api());
    expect(await screen.findByText("$5,000 · 1–5 числа · на счёт ФОП")).toBeTruthy();
    expect(await screen.findByText("$1,200 · 20-го · на Binance")).toBeTruthy();
    expect(screen.queryByText(/Следующий —/)).toBeNull();
    expect(screen.getByRole("button", { name: "Новый доход" })).toBeTruthy();
    // The list is quiet: no «Изменить» under every row, the row itself opens the form.
    expect(screen.queryByText("Изменить")).toBeNull();
  });

  it("opens the owner's ФОП in the form and keeps its window 1–5 when saved", async () => {
    const fake = api();
    await renderWith(<IncomesSheet onClose={noop} />, fake);
    await press("ФОП");
    expect(screen.getByLabelText("Название").props.value).toBe("ФОП");
    expect(screen.getByLabelText("Сумма").props.value).toBe("5000");
    expect(screen.getByRole("radio", { name: "Раз в месяц" }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText("С какого числа").props.value).toBe("1");
    expect(screen.getByLabelText("По какое число").props.value).toBe("5");
    expect(screen.getByRole("button", { name: "На какой счёт: ФОП" })).toBeTruthy();
    expect(taxSwitch().props.value).toBe(true);
    expect(cryptoSwitch().props.value).toBe(false);
    await press("Сохранить доход");
    await waitFor(() =>
      expect(fake.patchExpectedIncome).toHaveBeenCalledWith(1, {
        name: "ФОП", amount: 500_000, currency: "USD", schedule: "monthly", window_start_day: 1, window_end_day: 5, second_day: null,
        pays_fop_tax: true, crypto: false, account: { source: "account", id: 4 },
      }),
    );
    expect(fake.setIncomeDate).not.toHaveBeenCalled();
  });

  it("adds a twice-monthly income with a name, two days, an account and the crypto question", async () => {
    const fake = api();
    await renderWith(<IncomesSheet onClose={noop} />, fake);
    await press("Новый доход");
    await fireEvent.changeText(screen.getByLabelText("Название"), "Основная работа");
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "38 000");
    await fireEvent.press(screen.getByRole("radio", { name: "Два раза в месяц" }));
    await fireEvent.changeText(screen.getByLabelText("Первый раз"), "5");
    await fireEvent.changeText(screen.getByLabelText("Второй раз"), "20");
    await press("На какой счёт: не выбран");
    await fireEvent.press(screen.getByRole("radio", { name: "Белая карта" }));
    expect(screen.getByRole("button", { name: "На какой счёт: Белая карта" })).toBeTruthy();
    await fireEvent(cryptoSwitch(), "valueChange", true);
    await press("Сохранить доход");
    await waitFor(() =>
      expect(fake.createExpectedIncome).toHaveBeenCalledWith({
        name: "Основная работа", amount: 3_800_000, currency: "UAH", schedule: "twice", window_start_day: 5, window_end_day: 5, second_day: 20,
        pays_fop_tax: false, crypto: true, account: { source: "account", id: 5 },
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Первый раз")).toBeNull());
  });

  it("does not let the fop tax go with two payments a month, and says so quietly", async () => {
    const fake = api();
    await renderWith(<IncomesSheet onClose={noop} />, fake);
    await press("ФОП");
    await fireEvent.press(screen.getByRole("radio", { name: "Два раза в месяц" }));
    expect(taxSwitch().props.value).toBe(false);
    expect(taxSwitch().props.disabled).toBe(true);
    expect(screen.getByText("Налог ФОП платится с дохода, который приходит раз в месяц или без расписания.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Первый раз"), "5");
    await fireEvent.changeText(screen.getByLabelText("Второй раз"), "20");
    await press("Сохранить доход");
    await waitFor(() => expect(fake.patchExpectedIncome).toHaveBeenCalledWith(1, expect.objectContaining({ schedule: "twice", second_day: 20, pays_fop_tax: false })));
  });

  it("gives the tax back when the income goes back to once a month", async () => {
    await renderWith(<IncomesSheet onClose={noop} />, api());
    await press("ФОП");
    await fireEvent.press(screen.getByRole("radio", { name: "Два раза в месяц" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Раз в месяц" }));
    expect(taxSwitch().props.value).toBe(true);
    expect(taxSwitch().props.disabled).toBeFalsy();
  });

  it("refuses a second payment that is not after the first", async () => {
    const fake = api();
    await renderWith(<IncomesSheet onClose={noop} />, fake);
    await press("USDC");
    await fireEvent.press(screen.getByRole("radio", { name: "Два раза в месяц" }));
    await fireEvent.changeText(screen.getByLabelText("Первый раз"), "20");
    await fireEvent.changeText(screen.getByLabelText("Второй раз"), "10");
    await press("Сохранить доход");
    expect(await screen.findByText("Второй раз должен быть позже первого.")).toBeTruthy();
    expect(fake.patchExpectedIncome).not.toHaveBeenCalled();
  });

  it("an income without a schedule asks for no days and sends none", async () => {
    const fake = api();
    await renderWith(<IncomesSheet onClose={noop} />, fake);
    await press("Новый доход");
    await fireEvent.changeText(screen.getByLabelText("Название"), "Заказчик А");
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "1200");
    // The currency is the native switch beside the amount, a touch target per sign.
    const currency = screen.getByTestId("currency-choice");
    expect((StyleSheet.flatten(currency.props.style) as { width?: number }).width).toBe(2 * tokens.touchMin);
    expect(within(currency).getByRole("button", { name: "₴" }).props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "$" }));
    expect(within(currency).getByRole("button", { name: "$" }).props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByRole("radio", { name: "Без расписания" }));
    expect(screen.queryByLabelText("С какого числа")).toBeNull();
    expect(screen.queryByLabelText("Первый раз")).toBeNull();
    await press("Сохранить доход");
    await waitFor(() =>
      expect(fake.createExpectedIncome).toHaveBeenCalledWith({
        name: "Заказчик А", amount: 120_000, currency: "USD", schedule: "none", second_day: null, pays_fop_tax: false, crypto: false, account: null,
      }),
    );
  });

  it("asks for a name", async () => {
    const fake = api();
    await renderWith(<IncomesSheet onClose={noop} />, fake);
    await press("Новый доход");
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "100");
    await fireEvent.changeText(screen.getByLabelText("С какого числа"), "5");
    await fireEvent.changeText(screen.getByLabelText("По какое число"), "5");
    await press("Сохранить доход");
    expect(await screen.findByText("Проверьте название, сумму и числа.")).toBeTruthy();
    expect(fake.createExpectedIncome).not.toHaveBeenCalled();
  });

  it("deletes an income from its form, only after asking", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
    const fake = api();
    await renderWith(<IncomesSheet onClose={noop} />, fake);
    await press("USDC");
    await press("Удалить: USDC");
    expect(fake.deleteExpectedIncome).not.toHaveBeenCalled();
    await act(async () => alert.mock.calls[0]![2]!.find((b) => b.style === "destructive")!.onPress!());
    await waitFor(() => expect(fake.deleteExpectedIncome).toHaveBeenCalledWith(2));
    alert.mockRestore();
  });
});

describe("IncomesSheet with a server older than Д3а", () => {
  const old = { id: 1, source: "fop" as const, amount: 500_000, currency: "USD", window_start_day: 1, window_end_day: 5 };

  it("shows the old titles and the old form, and sends only the old fields", async () => {
    const fake = fakeApi({ expectedIncomes: jest.fn(async () => [old]) });
    await renderWith(<IncomesSheet onClose={noop} />, fake);
    expect(await screen.findByText("$5,000 · 1–5 числа")).toBeTruthy();
    await press("ФОП");
    expect(screen.queryByLabelText("Название")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Два раза в месяц" })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Сумма дохода"), "6000");
    await press("Сохранить доход");
    await waitFor(() => expect(fake.patchExpectedIncome).toHaveBeenCalledWith(1, { amount: 600_000, currency: "USD", window_start_day: 1, window_end_day: 5 }));
  });

  it("adds an income by its old kind", async () => {
    const fake = fakeApi({ expectedIncomes: jest.fn(async () => [old]) });
    await renderWith(<IncomesSheet onClose={noop} />, fake);
    await press("Новый доход");
    await fireEvent.press(within(screen.getByTestId("income-source")).getByRole("button", { name: "USDC" }));
    await fireEvent.changeText(screen.getByLabelText("Сумма дохода"), "800");
    await fireEvent.changeText(screen.getByLabelText("С какого числа"), "8");
    await fireEvent.changeText(screen.getByLabelText("По какое число"), "12");
    await press("Сохранить доход");
    await waitFor(() => expect(fake.createExpectedIncome).toHaveBeenCalledWith({ source: "usdc", amount: 80_000, currency: "USD", window_start_day: 8, window_end_day: 12 }));
  });
});
