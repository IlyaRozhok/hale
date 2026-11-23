import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { AddSheet } from "./AddSheet";
import { fakeApi, renderWith, todayFixture } from "../testing";
import { kyivDate } from "../format";

const noop = () => undefined;
const press = async (name: string | RegExp) => fireEvent.press(await screen.findByRole("button", { name }));
const started = () => ({ cash: jest.fn(async () => ({ started: true, start: "2026-11-01", balance: 250_000 })) });
const notStarted = () => ({ cash: jest.fn(async () => ({ started: false, start: null, balance: 0 })) });
const rent = { id: "1", name: "Квартплата", amount: 1_700_000, dueOn: "2026-12-06", kind: "obligation", currency: "UAH" };
const internet = { id: "2", name: "Интернет", amount: 30_000, dueOn: "2026-12-10", kind: "obligation", currency: "UAH" };
const withUpcoming = (upcoming: (typeof rent)[]) => ({ today: jest.fn(async () => todayFixture({ date: "2026-11-22", upcoming })) });

describe("AddSheet: one window for everything entered by hand (Д5)", () => {
  it("is a short menu of four actions, each with one quiet line", async () => {
    await renderWith(<AddSheet onClose={noop} />, fakeApi({ ...started(), ...withUpcoming([rent, internet]) }));
    expect(await screen.findByText("Добавить")).toBeTruthy();
    // The nearest unpaid payment is the hint, once «Сегодня» has come.
    expect(await screen.findByText("Квартплата · 6 дек")).toBeTruthy();
    for (const name of ["Трата", "Получил", "Оплатил платёж", "Перевёл между своими"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.getByText("доход или вернули долг")).toBeTruthy();
    // The subtitle names the kind as it is now called, «Перевёл в свои» (Я5).
    expect(screen.getByText("перевёл в свои или обменял USDC · лимит не меняется")).toBeTruthy();
    expect(screen.queryByText(/отдал/i)).toBeNull();
    // No form yet: the action comes first.
    expect(screen.queryByLabelText("Сумма")).toBeNull();
  });

  it("has no «Оплатил платёж» when nothing is due", async () => {
    await renderWith(<AddSheet onClose={noop} />, fakeApi({ ...started(), ...withUpcoming([]) }));
    expect(await screen.findByRole("button", { name: "Трата" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Перевёл между своими" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Оплатил платёж" })).toBeNull();
  });

  describe("«Трата»", () => {
    it("is spent from cash: amount, category, save", async () => {
      const api = fakeApi(started());
      const onClose = jest.fn();
      await renderWith(<AddSheet onClose={onClose} />, api);
      await press("Трата");
      expect(await screen.findByLabelText("Сумма")).toBeTruthy();
      // Cash is the only source, so there is no choice of it (Я7).
      expect(screen.queryByText("С чего")).toBeNull();
      expect(screen.queryByRole("radio", { name: "Наличные" })).toBeNull();
      expect(screen.queryByText("Сколько наличных сейчас?")).toBeNull();
      // The cash sheet's other kinds live elsewhere now.
      expect(screen.queryByRole("button", { name: "Получил" })).toBeNull();
      expect(screen.getByText("Тратит лимит дня.")).toBeTruthy();
      await fireEvent.changeText(screen.getByLabelText("Сумма"), "240");
      await press("Кафе и рестораны");
      await press("Сохранить");
      await waitFor(() => expect(api.addCashOperation).toHaveBeenCalledWith({ kind: "spend", amount: 24_000, category: "cafe", date: kyivDate() }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it("shows each category with its icon, as the operation's card does, and the chosen one says so (Я7)", async () => {
      await renderWith(<AddSheet onClose={noop} />, fakeApi(started()));
      await press("Трата");
      const cafe = await screen.findByRole("button", { name: "Кафе и рестораны" });
      expect(within(cafe).getByTestId("icon-coffee")).toBeTruthy();
      expect(within(screen.getByRole("button", { name: "Продукты" })).getByTestId("icon-cart")).toBeTruthy();
      expect(cafe.props.accessibilityState.selected).toBe(false);
      await fireEvent.press(cafe);
      expect(screen.getByRole("button", { name: "Кафе и рестораны" }).props.accessibilityState.selected).toBe(true);
    });

    it("the first time, asks once how much cash there is after this purchase: the wallet starts with it plus the purchase", async () => {
      const api = fakeApi(notStarted());
      await renderWith(<AddSheet onClose={noop} />, api);
      await press("Трата");
      expect(await screen.findByText("Сколько наличных сейчас?")).toBeTruthy();
      expect(screen.getByText("Уже без этой траты. Спросим один раз.")).toBeTruthy();
      expect(screen.getByText("С сегодняшнего дня снятие в банкомате не тратит лимит: его тратят покупки за наличные.")).toBeTruthy();
      // The wallet starts today, so the purchase is today's.
      expect(screen.queryByRole("button", { name: /^Дата:/ })).toBeNull();
      await fireEvent.changeText(screen.getByLabelText("Наличные после этой траты"), "3260");
      await fireEvent.changeText(screen.getByLabelText("Сумма"), "240");
      await press("Кафе и рестораны");
      await press("Сохранить");
      await waitFor(() => expect(api.addCashOperation).toHaveBeenCalledWith({ kind: "spend", amount: 24_000, category: "cafe", date: kyivDate() }));
      // 3,260 after the purchase: started at 3,500, minus the 240 spent, the wallet ends at the answer.
      expect(api.startCash).toHaveBeenCalledWith({ amount: 350_000 });
      expect(api.startCash.mock.invocationCallOrder[0]).toBeLessThan(api.addCashOperation.mock.invocationCallOrder[0]!);
    });

    it("a start refused because the wallet is already started reads the wallet again, and a second try only saves", async () => {
      const api = fakeApi(notStarted());
      api.startCash.mockImplementationOnce(async () => {
        api.cash.mockResolvedValue({ started: true, start: kyivDate(), balance: 100_000 });
        throw new Error("409");
      });
      await renderWith(<AddSheet onClose={noop} />, api);
      await press("Трата");
      await fireEvent.changeText(await screen.findByLabelText("Наличные после этой траты"), "3260");
      await fireEvent.changeText(screen.getByLabelText("Сумма"), "240");
      await press("Кафе и рестораны");
      await press("Сохранить");
      expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
      await waitFor(() => expect(screen.queryByText("Сколько наличных сейчас?")).toBeNull());
      await press("Сохранить");
      await waitFor(() => expect(api.addCashOperation).toHaveBeenCalledWith({ kind: "spend", amount: 24_000, category: "cafe", date: kyivDate() }));
      expect(api.startCash).toHaveBeenCalledTimes(1);
    });

    for (const action of ["Получил", "Перевёл между своими"]) {
      it(`«${action}» without a wallet starts it as a step of its own, never with the operation`, async () => {
        const api = fakeApi(notStarted());
        await renderWith(<AddSheet onClose={noop} />, api);
        await press(action);
        expect(await screen.findByText(/Сколько наличных у вас сейчас/)).toBeTruthy();
        expect(screen.queryByText("Уже без этой траты. Спросим один раз.")).toBeNull();
        expect(screen.queryByLabelText("Наличные после этой траты")).toBeNull();
        expect(screen.queryByLabelText("Сумма")).toBeNull();
        await fireEvent.changeText(screen.getByLabelText("Наличные сейчас"), "5000");
        api.cash.mockResolvedValue({ started: true, start: kyivDate(), balance: 500_000 });
        await press("Начать учёт");
        await waitFor(() => expect(api.startCash).toHaveBeenCalledWith({ amount: 500_000 }));
        expect(await screen.findByLabelText("Сумма")).toBeTruthy();
        expect(api.addCashOperation).not.toHaveBeenCalled();
      });
    }

    it("the first time, needs the cash in the pocket too, 0 allowed", async () => {
      const api = fakeApi(notStarted());
      await renderWith(<AddSheet onClose={noop} />, api);
      await press("Трата");
      await fireEvent.changeText(await screen.findByLabelText("Сумма"), "240");
      await press("Кафе и рестораны");
      await press("Сохранить");
      expect(await screen.findByText("Введите, сколько наличных сейчас, можно 0.")).toBeTruthy();
      expect(api.startCash).not.toHaveBeenCalled();
      expect(api.addCashOperation).not.toHaveBeenCalled();
    });

    it("keeps the wallet started when the purchase fails, so a second try only saves it", async () => {
      const api = fakeApi(notStarted());
      api.addCashOperation.mockRejectedValueOnce(new Error("offline"));
      api.startCash.mockImplementation(async () => {
        api.cash.mockResolvedValue({ started: true, start: kyivDate(), balance: 350_000 });
        return { started: true, start: kyivDate(), balance: 350_000 };
      });
      await renderWith(<AddSheet onClose={noop} />, api);
      await press("Трата");
      await fireEvent.changeText(await screen.findByLabelText("Наличные после этой траты"), "3260");
      await fireEvent.changeText(screen.getByLabelText("Сумма"), "240");
      await press("Кафе и рестораны");
      await press("Сохранить");
      expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
      await waitFor(() => expect(screen.queryByText("Сколько наличных сейчас?")).toBeNull());
      await press("Сохранить");
      await waitFor(() => expect(api.addCashOperation).toHaveBeenCalledTimes(2));
      expect(api.startCash).toHaveBeenCalledTimes(1);
    });
  });

  it("«Получил»: cash in, no category, with a note", async () => {
    const api = fakeApi(started());
    await renderWith(<AddSheet onClose={noop} />, api);
    await press("Получил");
    expect(await screen.findByText("Наличных больше, лимит не меняется.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Кафе и рестораны" })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "1000");
    await fireEvent.changeText(screen.getByLabelText("Заметка"), "Вернули долг");
    await press("Сохранить");
    await waitFor(() => expect(api.addCashOperation).toHaveBeenCalledWith({ kind: "received", amount: 100_000, date: kyivDate(), note: "Вернули долг" }));
  });

  it("«Перевёл между своими» holds «Перевёл в свои» and «Обменял USDC»", async () => {
    const api = fakeApi(started());
    await renderWith(<AddSheet onClose={noop} />, api);
    await press("Перевёл между своими");
    expect(await screen.findByRole("button", { name: "Перевёл в свои" })).toBeTruthy();
    // Task Я5: its own hint, which also covers buying USDC for cash.
    expect(screen.getByText("Наличные на карту или на Binance. Наличных меньше, лимит не меняется.")).toBeTruthy();
    expect(screen.queryByText(/Например, купил USDC/)).toBeNull();
    expect(screen.getByRole("button", { name: "Обменял USDC" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Трата" })).toBeNull();
    // The two kinds are the native switch, «Перевёл в свои» first and chosen.
    const kinds = within(screen.getByTestId("cash-kind")).getAllByRole("button");
    expect(kinds.map((k) => k.props.accessibilityLabel as string)).toEqual(["Перевёл в свои", "Обменял USDC"]);
    expect(kinds[0]!.props.accessibilityState.selected).toBe(true);
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "500");
    await press("Сохранить");
    await waitFor(() => expect(api.addCashOperation).toHaveBeenCalledWith({ kind: "own_out", amount: 50_000, date: kyivDate() }));
  });

  describe("«Оплатил платёж»", () => {
    it("with one payment due, opens its «Оплачено» window", async () => {
      const api = fakeApi({ ...started(), ...withUpcoming([rent]) });
      await renderWith(<AddSheet onClose={noop} />, api);
      await press("Оплатил платёж");
      expect(await screen.findByText("Квартплата")).toBeTruthy();
      await press("Оплачено");
      await waitFor(() => expect(api.markPaid).toHaveBeenCalledWith(1));
    });

    it("with several, lets you pick one, nearest first", async () => {
      const api = fakeApi({ ...started(), ...withUpcoming([rent, internet]) });
      await renderWith(<AddSheet onClose={noop} />, api);
      await press("Оплатил платёж");
      const rows = await screen.findAllByRole("button", { name: /Квартплата|Интернет/ });
      expect(rows.map((r) => r.props.accessibilityLabel)).toEqual(["Квартплата, 6 дек, ₴17,000", "Интернет, 10 дек, ₴300"]);
      await press(/^Интернет/);
      await press("Оплачено");
      await waitFor(() => expect(api.markPaid).toHaveBeenCalledWith(2));
    });
  });
});
