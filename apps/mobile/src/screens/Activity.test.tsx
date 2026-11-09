import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import { Activity } from "./Activity";
import { fakeApi, renderWith, txFixture } from "../testing";
import { NetworkError } from "../api/client";

const page = (items = [txFixture()], nextCursor: string | null = null, dayTotals: Record<string, number> = {}) =>
  jest.fn(async () => ({ items, nextCursor, dayTotals }));
const flat = (style: unknown) => StyleSheet.flatten(style as never) as unknown as { color: string };

describe("Activity list", () => {
  it("shows compact rows with a Russian category, hryvnias and the original currency noted", async () => {
    const items = [
      txFixture({ id: 1, description: "Кофейня", amount: -8500, amountUah: -8500 }),
      txFixture({ id: 2, description: "APPLE.COM", amount: -1000, amountUah: -41250, currency: "USD", category: "subscriptions", fxRate: 41.25 }),
      txFixture({ id: 3, description: "Возврат", amount: 500, amountUah: null, currency: "EUR", type: "income", category: "income" }),
      txFixture({ id: 4, description: "ФОП", amount: -2000, amountUah: -2000, type: "own_transfer", category: "own" }),
    ];
    await renderWith(<Activity />, fakeApi({ transactions: page(items) }));
    expect(await screen.findByText("Кофейня")).toBeTruthy();
    expect(screen.getByText("−₴85")).toBeTruthy();
    expect(screen.getByText("Кафе и рестораны")).toBeTruthy();
    expect(screen.getByText("−₴413")).toBeTruthy();
    expect(screen.getByText("−$10.00")).toBeTruthy();
    expect(screen.getByText("Подписки")).toBeTruthy();
    // no rate was known: the original amount stands alone, honestly
    expect(screen.getByText("+€5.00")).toBeTruthy();
    expect(screen.getByText("курс неизвестен")).toBeTruthy();
    expect(screen.getByText("Доход")).toBeTruthy();
    expect(screen.getByText("Между своими")).toBeTruthy();
  });

  it("spending is plain white, money in is the green accent, own transfers neutral", async () => {
    const items = [
      txFixture({ id: 1, description: "Трата", amount: -8500, amountUah: -8500 }),
      txFixture({ id: 2, description: "Доход", amount: 8600, amountUah: 8600, type: "income", category: "income" }),
      txFixture({ id: 3, description: "Перевод", amount: -8700, amountUah: -8700, type: "own_transfer", category: "own" }),
    ];
    await renderWith(<Activity />, fakeApi({ transactions: page(items) }));
    expect(flat((await screen.findByText("−₴85")).props.style).color).toBe(tokens.color.money.neutral);
    expect(flat(screen.getByText("+₴86").props.style).color).toBe(tokens.color.accent.signal);
    expect(flat(screen.getByText("−₴87").props.style).color).toBe(tokens.color.money.neutral);
  });

  it("groups by day with the server's total, naming today and yesterday", async () => {
    const items = [
      txFixture({ id: 1, description: "Сегодняшняя", localDate: "2026-11-03", amount: -100, amountUah: -100 }),
      txFixture({ id: 2, description: "Вчерашняя", localDate: "2026-11-02", amount: -200, amountUah: -200 }),
      txFixture({ id: 3, description: "Старая", localDate: "2026-10-31", amount: -300, amountUah: -300 }),
    ];
    const dayTotals = { "2026-11-03": -76000, "2026-11-02": -118000, "2026-10-31": 500000 };
    await renderWith(<Activity now={() => new Date("2026-11-03T10:00:00Z")} />, fakeApi({ transactions: page(items, null, dayTotals) }));
    expect(await screen.findByText("Сегодня, 3 ноя")).toBeTruthy();
    expect(screen.getByText("−₴760")).toBeTruthy();
    expect(screen.getByText("Вчера, 2 ноя")).toBeTruthy();
    expect(screen.getByText("−₴1,180")).toBeTruthy();
    expect(screen.getByText("31 окт")).toBeTruthy();
    expect(screen.getByText("+₴5,000")).toBeTruthy();
  });

  it("merges one day across pages under a single header, with the total from the page that knows it", async () => {
    const transactions = jest
      .fn()
      .mockResolvedValueOnce({ items: [txFixture({ id: 1, description: "Первая", amount: -1000, amountUah: -1000 })], nextCursor: "c1", dayTotals: { "2026-11-02": -3000 } })
      .mockResolvedValueOnce({ items: [txFixture({ id: 2, description: "Вторая", amount: -2000, amountUah: -2000 })], nextCursor: null, dayTotals: { "2026-11-02": -3000 } });
    await renderWith(<Activity now={() => new Date("2026-11-20T10:00:00Z")} />, fakeApi({ transactions }));
    await screen.findByText("Первая");
    await fireEvent(screen.getByTestId("activity-list"), "endReached");
    await screen.findByText("Вторая");
    expect(screen.getAllByText("2 ноя")).toHaveLength(1);
    expect(screen.getByText("−₴30")).toBeTruthy();
  });

  it("marks operations still on hold quietly under the amount, not in the category line", async () => {
    await renderWith(<Activity />, fakeApi({ transactions: page([txFixture({ hold: true })]) }));
    expect(await screen.findByText("Кафе и рестораны")).toBeTruthy();
    expect(screen.getByText("в обработке")).toBeTruthy();
    expect(screen.queryByText(/· в обработке/)).toBeNull();
  });

  it("each row has a round badge of its category; unknown ones a plain circle", async () => {
    const items = [
      txFixture({ id: 1, category: "groceries" }),
      txFixture({ id: 2, category: "who-knows" }),
      txFixture({ id: 3, type: "income", category: "income", amount: 100, amountUah: 100 }),
      txFixture({ id: 4, type: null, category: null }),
    ];
    await renderWith(<Activity />, fakeApi({ transactions: page(items) }));
    expect(await screen.findByTestId("tx-icon-cart")).toBeTruthy();
    expect(screen.getAllByTestId("tx-icon-circle")).toHaveLength(2);
    expect(screen.getByTestId("tx-icon-arrowIn")).toBeTruthy();
  });

  it("an operation that paid a planned payment is named after it", async () => {
    const items = [txFixture({ id: 1, description: "545708****4563", type: "obligation", category: "transfer", paymentName: "Квартплата" })];
    await renderWith(<Activity />, fakeApi({ transactions: page(items) }));
    expect(await screen.findByText("545708****4563")).toBeTruthy();
    expect(screen.getByText("Квартплата")).toBeTruthy();
    expect(screen.queryByText("Обязательный платёж")).toBeNull();
  });

  it("loads the next page by cursor when the end is reached", async () => {
    const transactions = jest
      .fn()
      .mockResolvedValueOnce({ items: [txFixture({ id: 1, description: "Первая" })], nextCursor: "c1", dayTotals: {} })
      .mockResolvedValueOnce({ items: [txFixture({ id: 2, description: "Вторая" })], nextCursor: null, dayTotals: {} });
    await renderWith(<Activity />, fakeApi({ transactions }));
    await screen.findByText("Первая");
    await fireEvent(screen.getByTestId("activity-list"), "endReached");
    expect(await screen.findByText("Вторая")).toBeTruthy();
    expect(transactions).toHaveBeenLastCalledWith({ cursor: "c1", group: "spend" });
    expect(screen.getByText("Первая")).toBeTruthy();
  });

  it("starts on spending, and the chips switch to income, everything and questions", async () => {
    const transactions = jest.fn(async (q: { group?: string; needsLabel?: boolean }) => ({
      items: [txFixture({ id: 1, description: q.needsLabel ? "Вопрос" : `Группа ${q.group}` })],
      nextCursor: null,
      dayTotals: {},
    }));
    await renderWith(<Activity />, fakeApi({ transactions }));
    expect(await screen.findByText("Группа spend")).toBeTruthy();
    expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend" });
    expect(screen.getByRole("button", { name: "Траты" }).props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Доходы" }));
    expect(await screen.findByText("Группа income")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Все" }));
    expect(await screen.findByText("Группа all")).toBeTruthy();
    // Questions live in the bell on Today now.
    expect(screen.queryByRole("button", { name: "Вопросы" })).toBeNull();
  });

  it("limits the search field to what the server accepts", async () => {
    await renderWith(<Activity />, fakeApi({ transactions: page() }));
    await fireEvent.press(await screen.findByRole("button", { name: "Поиск" }));
    expect(screen.getByLabelText("Поиск по операциям").props.maxLength).toBe(100);
  });

  it("searches 300 ms after typing stops and clears when the field is closed", async () => {
    jest.useFakeTimers();
    try {
      const transactions = page();
      await renderWith(<Activity />, fakeApi({ transactions }));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(screen.queryByLabelText("Поиск по операциям")).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: "Поиск" }));
      await fireEvent.changeText(screen.getByLabelText("Поиск по операциям"), "кафе");
      await act(async () => {
        await jest.advanceTimersByTimeAsync(299);
      });
      expect(transactions).not.toHaveBeenCalledWith(expect.objectContaining({ q: "кафе" }));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2);
      });
      expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", q: "кафе" });
      await fireEvent.press(screen.getByRole("button", { name: "Поиск" }));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(screen.queryByLabelText("Поиск по операциям")).toBeNull();
      expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend" });
    } finally {
      jest.useRealTimers();
    }
  });

  it("shows a calm retry when loading fails", async () => {
    const transactions = jest.fn().mockRejectedValueOnce(new NetworkError()).mockResolvedValue({ items: [txFixture()], nextCursor: null, dayTotals: {} });
    await renderWith(<Activity />, fakeApi({ transactions }));
    expect(await screen.findByText(/Не получилось загрузить операции/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Кофейня")).toBeTruthy();
  });

  it("says so when there is nothing to show, in the words of the filter", async () => {
    await renderWith(<Activity />, fakeApi({ transactions: page([]) }));
    expect(await screen.findByText("Трат пока нет.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Доходы" }));
    expect(await screen.findByText("Доходов пока нет.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Все" }));
    expect(await screen.findByText("Операций пока нет.")).toBeTruthy();
  });
});

describe("Activity filters", () => {
  const summaryPage = (summary: { total: number; count: number } | null) =>
    jest.fn(async () => ({ items: [txFixture()], nextCursor: null, dayTotals: {}, summary }));
  const now = () => new Date("2026-11-09T10:00:00Z");

  it("the kinds are one segmented switch; filters hide behind one button by the search", async () => {
    await renderWith(<Activity />, fakeApi({ transactions: summaryPage(null) }));
    expect(await screen.findByRole("button", { name: "Фильтры" })).toBeTruthy();
    expect(screen.getByTestId("kind-switch")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Период" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Категория" })).toBeNull();
  });

  it("a period and a category chosen in one window narrow the list, say how many on the button, and add up", async () => {
    const transactions = summaryPage({ total: -342000, count: 11 });
    await renderWith(<Activity now={now} />, fakeApi({ transactions }));
    await fireEvent.press(await screen.findByRole("button", { name: "Фильтры" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Неделя" }));
    await fireEvent.press(screen.getByRole("button", { name: "Кафе и рестораны" }));
    await fireEvent.press(screen.getByRole("button", { name: "Показать" }));
    await waitFor(() =>
      expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", category: "cafe", from: "2026-11-03", to: "2026-11-09" }),
    );
    expect(await screen.findByRole("button", { name: "Фильтры: 2" })).toBeTruthy();
    expect(await screen.findByText("Кафе и рестораны · 3–9 ноя: −₴3,420 · 11 операций")).toBeTruthy();
  });

  it("the window clears everything at once", async () => {
    const transactions = summaryPage({ total: -2500, count: 2 });
    await renderWith(<Activity now={now} />, fakeApi({ transactions }));
    await fireEvent.press(await screen.findByRole("button", { name: "Фильтры" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Сегодня" }));
    await fireEvent.press(screen.getByRole("button", { name: "Показать" }));
    expect(await screen.findByText("9 ноя: −₴25 · 2 операции")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Фильтры: 1" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Сбросить" }));
    await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend" }));
    expect(await screen.findByRole("button", { name: "Фильтры" })).toBeTruthy();
  });

  it("no categories in the window for income", async () => {
    await renderWith(<Activity />, fakeApi({ transactions: summaryPage(null) }));
    await fireEvent.press(await screen.findByRole("button", { name: "Доходы" }));
    await fireEvent.press(screen.getByRole("button", { name: "Фильтры" }));
    expect(await screen.findByRole("button", { name: "Неделя" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Кафе и рестораны" })).toBeNull();
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

  it("asks what the transfer is, says what each answer does, and takes one tap", async () => {
    const api = fakeApi({ transactions: page([person]) });
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Иван"));
    expect(await screen.findByText("Что это за перевод?")).toBeTruthy();
    expect(await screen.findByText("Переводов: 5, всего ₴1,000, последний 02.11")).toBeTruthy();
    expect(api.recipient).toHaveBeenCalledWith("fedcba9876543210");
    for (const t of ["Близкий человек, регулярно", "Разовая помощь или подарок", "Оплата услуги или покупка", "Возвращаю долг", "Даю в долг", "Это мой счёт", "Не спрашивать"]) {
      expect(screen.getByRole("button", { name: t })).toBeTruthy();
    }
    expect(screen.getByText("Считается в дневном лимите. Платёж из плана лимит не тратит")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Даю в долг" }));
    await waitFor(() => expect(api.labelRecipient).toHaveBeenCalledWith("fedcba9876543210", "lend"));
    await waitFor(() => expect(screen.queryByText("Что это за перевод?")).toBeNull());
  });

  it("can still be answered when the totals did not load", async () => {
    const api = fakeApi({
      transactions: page([person]),
      recipient: jest.fn(async () => {
        throw new Error("boom");
      }),
    });
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Иван"));
    await fireEvent.press(await screen.findByRole("button", { name: "Не спрашивать" }));
    await waitFor(() => expect(api.labelRecipient).toHaveBeenCalledWith("fedcba9876543210", "skip"));
  });

  it("an answer given before can be changed from the operation", async () => {
    const answered = { ...person, needsLabel: false, recipientLabel: "lend" as const, type: "loan_out" as const };
    const api = fakeApi({
      transactions: page([answered]),
      recipient: jest.fn(async () => ({ name: "Иван", count: 5, total: 100_000, lastOn: "2026-11-02", label: "lend" as const })),
    });
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Иван"));
    await fireEvent.press(await screen.findByRole("button", { name: "Что это за перевод: Даю в долг" }));
    expect(await screen.findByText("Что это за перевод?")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Даю в долг" }).props.accessibilityState.selected).toBe(true));
    await fireEvent.press(screen.getByRole("button", { name: "Это мой счёт" }));
    await waitFor(() => expect(api.labelRecipient).toHaveBeenCalledWith("fedcba9876543210", "own_account"));
  });

  it("a person transfer with no answer yet can get one from the operation; a purchase cannot", async () => {
    const plain = { ...person, needsLabel: false };
    const api = fakeApi({ transactions: page([plain, txFixture({ id: 6, description: "Кофейня" })]) });
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Иван"));
    expect(await screen.findByRole("button", { name: "Что это за перевод: не указано" })).toBeTruthy();
    const closes = screen.getAllByRole("button", { name: "Закрыть" });
    await fireEvent.press(closes[closes.length - 1]!);
    await fireEvent.press(await screen.findByText("Кофейня"));
    await screen.findByLabelText("Применить к похожим");
    expect(screen.queryByRole("button", { name: /Что это за перевод/ })).toBeNull();
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
