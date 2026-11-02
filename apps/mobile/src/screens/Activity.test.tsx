import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Activity } from "./Activity";
import { fakeApi, renderWith, txFixture } from "../testing";
import { NetworkError } from "../api/client";

const page = (items = [txFixture()], nextCursor: string | null = null) => jest.fn(async () => ({ items, nextCursor }));

describe("Activity list", () => {
  it("shows rows with Russian category and type names, amounts in hryvnias with the original currency noted", async () => {
    const items = [
      txFixture({ id: 1, description: "Кофейня", amount: -8500, amountUah: -8500 }),
      txFixture({ id: 2, description: "APPLE.COM", amount: -1000, amountUah: -41250, currency: "USD", category: "subscriptions", fxRate: 41.25 }),
      txFixture({ id: 3, description: "Возврат", amount: 500, amountUah: null, currency: "EUR", type: "income", category: "income" }),
    ];
    await renderWith(<Activity />, fakeApi({ transactions: page(items) }));
    expect(await screen.findByText("Кофейня")).toBeTruthy();
    expect(screen.getByText("−₴85")).toBeTruthy();
    expect(screen.getByText("Кафе и рестораны · Трата")).toBeTruthy();
    expect(screen.getByText("−₴413")).toBeTruthy();
    expect(screen.getByText("−$10.00")).toBeTruthy();
    expect(screen.getByText("Подписки · Трата")).toBeTruthy();
    // no rate was known: the original amount stands alone, honestly
    expect(screen.getByText("€5.00")).toBeTruthy();
    expect(screen.getByText("курс неизвестен")).toBeTruthy();
  });

  it("loads the next page by cursor when the end is reached", async () => {
    const transactions = jest
      .fn()
      .mockResolvedValueOnce({ items: [txFixture({ id: 1, description: "Первая" })], nextCursor: "c1" })
      .mockResolvedValueOnce({ items: [txFixture({ id: 2, description: "Вторая" })], nextCursor: null });
    await renderWith(<Activity />, fakeApi({ transactions }));
    await screen.findByText("Первая");
    await fireEvent(screen.getByTestId("activity-list"), "endReached");
    expect(await screen.findByText("Вторая")).toBeTruthy();
    expect(transactions).toHaveBeenLastCalledWith({ cursor: "c1", needsLabel: undefined });
    expect(screen.getByText("Первая")).toBeTruthy();
  });

  it("filters to rows that need an answer", async () => {
    const transactions = jest.fn(async (q: { needsLabel?: boolean }) => ({
      items: [txFixture({ id: q.needsLabel ? 9 : 1, description: q.needsLabel ? "Нужен ответ тут" : "Обычная" })],
      nextCursor: null,
    }));
    await renderWith(<Activity />, fakeApi({ transactions }));
    await screen.findByText("Обычная");
    await fireEvent.press(screen.getByRole("button", { name: "Нужен ответ" }));
    expect(await screen.findByText("Нужен ответ тут")).toBeTruthy();
    expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, needsLabel: true });
  });

  it("shows a calm retry when loading fails", async () => {
    const transactions = jest.fn().mockRejectedValueOnce(new NetworkError()).mockResolvedValue({ items: [txFixture()], nextCursor: null });
    await renderWith(<Activity />, fakeApi({ transactions }));
    expect(await screen.findByText(/Не получилось загрузить операции/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Кофейня")).toBeTruthy();
  });

  it("says so when there is nothing to show", async () => {
    await renderWith(<Activity />, fakeApi({ transactions: page([]) }));
    expect(await screen.findByText("Операций пока нет.")).toBeTruthy();
  });
});

describe("Activity edit sheet", () => {
  it("changes the category in one tap, applying to similar by default", async () => {
    const api = fakeApi();
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Кофейня"));
    const similar = await screen.findByLabelText("Применить к похожим");
    expect(similar.props.value).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Продукты" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(1, { category: "groceries", applyToSimilar: true }));
    await waitFor(() => expect(screen.queryByLabelText("Применить к похожим")).toBeNull());
  });

  it("changes the type in one tap, and the similar switch can be turned off", async () => {
    const api = fakeApi();
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Кофейня"));
    await fireEvent(await screen.findByLabelText("Применить к похожим"), "valueChange", false);
    await fireEvent.press(screen.getByRole("button", { name: "Обязательный платёж" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(1, { type: "obligation", applyToSimilar: false }));
  });

  it("refreshes the list after an edit", async () => {
    const api = fakeApi();
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Кофейня"));
    await fireEvent.press(await screen.findByRole("button", { name: "Транспорт" }));
    await waitFor(() => expect(api.transactions.mock.calls.length).toBeGreaterThan(1));
  });

  it("keeps the sheet open with a message when saving fails", async () => {
    const editTransaction = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(<Activity />, fakeApi({ editTransaction }));
    await fireEvent.press(await screen.findByText("Кофейня"));
    await fireEvent.press(await screen.findByRole("button", { name: "Транспорт" }));
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(screen.getByLabelText("Применить к похожим")).toBeTruthy();
  });
});

describe("Activity recipient label", () => {
  const person = txFixture({ id: 5, description: "Перевод на карту", counterName: "Иван", type: "person_transfer", category: "transfer", needsLabel: true, counterKey: "fedcba9876543210" });

  it("asks who it is with the five answers, in one tap", async () => {
    const api = fakeApi({ transactions: page([person]) });
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Иван"));
    expect(await screen.findByText("Кто это?")).toBeTruthy();
    for (const t of ["Общий бюджет", "Помощь", "Возврат долга", "Разово", "Обязательное"]) {
      expect(screen.getByRole("button", { name: t })).toBeTruthy();
    }
    await fireEvent.press(screen.getByRole("button", { name: "Помощь" }));
    await waitFor(() => expect(api.labelRecipient).toHaveBeenCalledWith("fedcba9876543210", "help"));
    await waitFor(() => expect(screen.queryByText("Кто это?")).toBeNull());
  });

  it("still lets the type be changed from the label sheet", async () => {
    const api = fakeApi({ transactions: page([person]) });
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Иван"));
    await fireEvent.press(await screen.findByRole("button", { name: "Изменить тип" }));
    expect(await screen.findByLabelText("Применить к похожим")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Обязательный платёж" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(5, { type: "obligation", applyToSimilar: true }));
  });

  it("marks rows that need an answer", async () => {
    await renderWith(<Activity />, fakeApi({ transactions: page([person]) }));
    expect(await screen.findByText("Ждёт ответа")).toBeTruthy();
  });
});
