import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import { Activity } from "./Activity";
import { fakeApi, pickDate, renderWith, txFixture } from "../testing";
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

  it("a row with a type this app does not know reads as an undefined type, not as empty or «undefined»", async () => {
    const items = [txFixture({ id: 1, description: "Новое", amount: -500, amountUah: -500, type: "something_new" as never, category: null })];
    await renderWith(<Activity />, fakeApi({ transactions: page(items) }));
    expect(await screen.findByText("Новое")).toBeTruthy();
    expect(screen.getByText("Не определён")).toBeTruthy();
    expect(screen.queryByText(/undefined/)).toBeNull();
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

  it("under «Траты» a row the limit does not count is marked quietly; one without the field is not", async () => {
    const items = [
      txFixture({ id: 1, description: "Квартплата", type: "obligation", category: "transfer", amount: -800000, amountUah: -800000, inLimit: false }),
      txFixture({ id: 2, description: "Кофейня", inLimit: true }),
      txFixture({ id: 3, description: "Старый сервер", type: "tax", category: "tax", amount: -300000, amountUah: -300000 }),
    ];
    await renderWith(<Activity />, fakeApi({ transactions: page(items, null, { "2026-11-02": -12000 }) }));
    expect(await screen.findByText("Квартплата")).toBeTruthy();
    const marks = screen.getAllByText("не из лимита");
    expect(marks).toHaveLength(1);
    expect(flat(marks[0]!.props.style).color).toBe(tokens.color.fg.muted);
    // The category line stays as it was: the mark is its own line, not glued to it.
    expect(screen.getByText("Обязательный платёж")).toBeTruthy();
    expect(screen.queryByText(/· не из лимита/)).toBeNull();
    // The day header is the server's figure: nothing is added up or taken out here.
    expect(screen.getByText("−₴120")).toBeTruthy();
    expect(screen.queryByText("−₴11,085")).toBeNull();
    expect(screen.queryByText("−₴8,085")).toBeNull();
  });

  it("under «Все» and «Доходы» nothing is marked, whatever the server says about the limit", async () => {
    const items = [txFixture({ id: 1, description: "Квартплата", type: "obligation", category: "transfer", inLimit: false })];
    await renderWith(<Activity />, fakeApi({ transactions: page(items) }));
    expect(await screen.findByText("не из лимита")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Все"));
    await waitFor(() => expect(screen.queryByText("не из лимита")).toBeNull());
    expect(screen.getByText("Квартплата")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Доходы"));
    await screen.findByText("Квартплата");
    expect(screen.queryByText("не из лимита")).toBeNull();
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

  /** "Показать" and "Сбросить" close the window; nothing under it can be pressed until it is gone. */
  const windowGone = () => waitFor(() => expect(screen.queryByRole("button", { name: "Показать" })).toBeNull());

  it("the dates stay empty until a period is chosen, and empty again once it is taken off", async () => {
    const transactions = summaryPage({ total: -2500, count: 2 });
    await renderWith(<Activity now={now} />, fakeApi({ transactions }));
    await fireEvent.press(await screen.findByRole("button", { name: "Фильтры" }));
    expect(await screen.findByRole("button", { name: "С: не выбрана" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "По: не выбрана" })).toBeTruthy();
    expect(screen.getAllByText("Выбрать")).toHaveLength(2);

    await fireEvent.press(screen.getByRole("button", { name: "Неделя" }));
    expect(screen.getByRole("button", { name: "С: 3 ноября 2026" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "По: 9 ноября 2026" })).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Неделя" }));
    expect(screen.getByRole("button", { name: "С: не выбрана" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "По: не выбрана" })).toBeTruthy();

    // Nothing was chosen, so nothing narrows the list.
    await fireEvent.press(screen.getByRole("button", { name: "Показать" }));
    await windowGone();
    expect(screen.getByRole("button", { name: "Фильтры" })).toBeTruthy();
    expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend" });
  });

  it("a start date alone runs to today, and both dates show it", async () => {
    const transactions = summaryPage({ total: -2500, count: 2 });
    await renderWith(<Activity now={now} />, fakeApi({ transactions }));
    await fireEvent.press(await screen.findByRole("button", { name: "Фильтры" }));
    await screen.findByRole("button", { name: "С: не выбрана" });
    await pickDate("С", "2026-11-05");
    expect(screen.getByRole("button", { name: "С: 5 ноября 2026" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "По: 9 ноября 2026" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Показать" }));
    await windowGone();
    await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", from: "2026-11-05", to: "2026-11-09" }));
  });

  it("an end date alone is that one day, and both dates show it", async () => {
    const transactions = summaryPage({ total: -2500, count: 2 });
    await renderWith(<Activity now={now} />, fakeApi({ transactions }));
    await fireEvent.press(await screen.findByRole("button", { name: "Фильтры" }));
    await screen.findByRole("button", { name: "По: не выбрана" });
    await pickDate("По", "2026-11-05");
    expect(screen.getByRole("button", { name: "С: 5 ноября 2026" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "По: 5 ноября 2026" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Показать" }));
    await windowGone();
    await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", from: "2026-11-05", to: "2026-11-05" }));
  });

  it("«Месяц» is today and the 29 days before it, so it is not empty at the start of a month", async () => {
    const transactions = summaryPage({ total: -130600, count: 3 });
    await renderWith(<Activity now={() => new Date("2026-11-02T10:00:00Z")} />, fakeApi({ transactions }));
    await fireEvent.press(await screen.findByRole("button", { name: "Фильтры" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Месяц" }));
    expect(screen.getByRole("button", { name: "Месяц" }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole("button", { name: "С: 4 октября 2026" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "По: 2 ноября 2026" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Показать" }));
    await windowGone();
    await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", from: "2026-10-04", to: "2026-11-02" }));
    expect(await screen.findByText("4 окт – 2 ноя: −₴1,306 · 3 операции")).toBeTruthy();
  });

  it("a category chosen for spending stays on under «Все», in sight, until it is taken off in the window", async () => {
    const transactions = summaryPage({ total: -342000, count: 11 });
    await renderWith(<Activity now={now} />, fakeApi({ transactions }));
    await fireEvent.press(await screen.findByRole("button", { name: "Фильтры" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Кафе и рестораны" }));
    await fireEvent.press(screen.getByRole("button", { name: "Показать" }));
    await windowGone();
    await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", category: "cafe" }));

    await fireEvent.press(screen.getByRole("button", { name: "Все" }));
    await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "all", category: "cafe" }));
    expect(await screen.findByRole("button", { name: "Фильтры: 1" })).toBeTruthy();
    expect(await screen.findByText("Кафе и рестораны: −₴3,420 · 11 операций")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Фильтры: 1" }));
    const chosen = await screen.findByRole("button", { name: "Кафе и рестораны" });
    expect(chosen.props.accessibilityState.selected).toBe(true);
    await fireEvent.press(chosen);
    await fireEvent.press(screen.getByRole("button", { name: "Показать" }));
    await windowGone();
    await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "all" }));
    expect(screen.getByRole("button", { name: "Фильтры" })).toBeTruthy();
    expect(screen.queryByText(/Кафе и рестораны: /)).toBeNull();
  });

  describe("arriving from a day of the limit calendar", () => {
    /** The tab screen as the navigator gives it: each arrival is a new `at` beside the day. */
    let arrive: (day: string) => Promise<void>;
    function Arriving() {
      const [params, setParams] = useState<{ day: string; at: number }>();
      arrive = (day) => act(async () => setParams((p) => ({ day, at: (p?.at ?? 0) + 1 })));
      return <Activity now={now} route={{ params }} />;
    }

    it("shows that one day's spending, with the period in sight as any filter is", async () => {
      const transactions = summaryPage({ total: -312000, count: 4 });
      await renderWith(<Activity now={now} route={{ params: { day: "2026-11-02", at: 1 } }} />, fakeApi({ transactions }));
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", from: "2026-11-02", to: "2026-11-02" }));
      expect(await screen.findByRole("button", { name: "Фильтры: 1" })).toBeTruthy();
      expect(await screen.findByText("2 ноя: −₴3,120 · 4 операции")).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Фильтры: 1" }));
      expect(await screen.findByRole("button", { name: "С: 2 ноября 2026" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "По: 2 ноября 2026" })).toBeTruthy();
    });

    it("puts aside what was chosen before: the kind, the category and the search", async () => {
      const transactions = summaryPage({ total: -312000, count: 4 });
      await renderWith(<Arriving />, fakeApi({ transactions }));
      await fireEvent.press(await screen.findByRole("button", { name: "Фильтры" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Кафе и рестораны" }));
      await fireEvent.press(screen.getByRole("button", { name: "Показать" }));
      await windowGone();
      await fireEvent.press(screen.getByRole("button", { name: "Все" }));
      await fireEvent.press(screen.getByRole("button", { name: "Поиск" }));
      await fireEvent.changeText(screen.getByLabelText("Поиск по операциям"), "кофе");
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "all", category: "cafe", q: "кофе" }));

      await arrive("2026-11-02");
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", from: "2026-11-02", to: "2026-11-02" }));
      expect(screen.getByRole("button", { name: "Траты" }).props.accessibilityState.selected).toBe(true);
      expect(screen.queryByLabelText("Поиск по операциям")).toBeNull();
      expect(await screen.findByRole("button", { name: "Фильтры: 1" })).toBeTruthy();
      expect(await screen.findByText("2 ноя: −₴3,120 · 4 операции")).toBeTruthy();
      // The search that was typed does not come back later.
      await act(async () => new Promise<void>((r) => void setTimeout(r, 400)));
      expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", from: "2026-11-02", to: "2026-11-02" });
    });

    it("the same day again, after the filter was taken off, is applied again", async () => {
      const transactions = summaryPage({ total: -312000, count: 4 });
      await renderWith(<Arriving />, fakeApi({ transactions }));
      await screen.findByRole("button", { name: "Фильтры" });
      await arrive("2026-11-02");
      await fireEvent.press(await screen.findByRole("button", { name: "Фильтры: 1" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Сбросить" }));
      await windowGone();
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend" }));
      expect(screen.getByRole("button", { name: "Фильтры" })).toBeTruthy();

      await arrive("2026-11-02");
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", from: "2026-11-02", to: "2026-11-02" }));
      expect(await screen.findByRole("button", { name: "Фильтры: 1" })).toBeTruthy();
    });

    it("a filters window left open does not stay over the day", async () => {
      const transactions = summaryPage({ total: -312000, count: 4 });
      await renderWith(<Arriving />, fakeApi({ transactions }));
      await fireEvent.press(await screen.findByRole("button", { name: "Фильтры" }));
      await screen.findByRole("button", { name: "Показать" });
      await arrive("2026-11-02");
      await windowGone();
      expect(await screen.findByRole("button", { name: "Фильтры: 1" })).toBeTruthy();
    });
  });

  describe("arriving from a category of «Итоги» (В2)", () => {
    type Params = { day?: string; category?: string; from?: string; to?: string; at: number };
    let arrive: (p: Omit<Params, "at">) => Promise<void>;
    function Arriving() {
      const [params, setParams] = useState<Params>();
      arrive = (next) => act(async () => setParams((p) => ({ ...next, at: (p?.at ?? 0) + 1 })));
      return <Activity now={now} route={{ params }} />;
    }

    it("shows that category's spending over the month's days, both filters in sight", async () => {
      const transactions = summaryPage({ total: -880000, count: 12 });
      await renderWith(
        <Activity now={now} route={{ params: { category: "groceries", from: "2026-11-01", to: "2026-11-16", at: 1 } }} />,
        fakeApi({ transactions }),
      );
      await waitFor(() =>
        expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", category: "groceries", from: "2026-11-01", to: "2026-11-16" }),
      );
      expect(await screen.findByRole("button", { name: "Фильтры: 2" })).toBeTruthy();
      expect(await screen.findByText("Продукты · 1–16 ноя: −₴8,800 · 12 операций")).toBeTruthy();
    });

    it("«Без категории» is asked for as the filters window asks for it", async () => {
      const transactions = summaryPage({ total: -10000, count: 1 });
      await renderWith(
        <Activity now={now} route={{ params: { category: "uncategorized", from: "2026-10-01", to: "2026-10-31", at: 1 } }} />,
        fakeApi({ transactions }),
      );
      await waitFor(() =>
        expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", category: "uncategorized", from: "2026-10-01", to: "2026-10-31" }),
      );
      expect(await screen.findByText("Без категории · 1–31 окт: −₴100 · 1 операция")).toBeTruthy();
    });

    it("puts aside what was chosen before, and a day arriving later takes the category off", async () => {
      const transactions = summaryPage({ total: -312000, count: 4 });
      await renderWith(<Arriving />, fakeApi({ transactions }));
      await fireEvent.press(await screen.findByRole("button", { name: "Все" }));
      await fireEvent.press(screen.getByRole("button", { name: "Поиск" }));
      await fireEvent.changeText(screen.getByLabelText("Поиск по операциям"), "кофе");
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "all", q: "кофе" }));

      await arrive({ category: "cafe", from: "2026-11-01", to: "2026-11-16" });
      await waitFor(() =>
        expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", category: "cafe", from: "2026-11-01", to: "2026-11-16" }),
      );
      expect(screen.getByRole("button", { name: "Траты" }).props.accessibilityState.selected).toBe(true);
      expect(screen.queryByLabelText("Поиск по операциям")).toBeNull();

      await arrive({ day: "2026-11-02" });
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", from: "2026-11-02", to: "2026-11-02" }));
      expect(await screen.findByRole("button", { name: "Фильтры: 1" })).toBeTruthy();
    });

    it("the same category again, after the filters were taken off, is applied again", async () => {
      const transactions = summaryPage({ total: -312000, count: 4 });
      await renderWith(<Arriving />, fakeApi({ transactions }));
      await screen.findByRole("button", { name: "Фильтры" });
      await arrive({ category: "cafe", from: "2026-11-01", to: "2026-11-16" });
      await fireEvent.press(await screen.findByRole("button", { name: "Фильтры: 2" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Сбросить" }));
      await windowGone();
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend" }));

      await arrive({ category: "cafe", from: "2026-11-01", to: "2026-11-16" });
      await waitFor(() =>
        expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", category: "cafe", from: "2026-11-01", to: "2026-11-16" }),
      );
      expect(await screen.findByRole("button", { name: "Фильтры: 2" })).toBeTruthy();
    });
  });

  describe("arriving from «Из них на желаемое» of «Итоги» (В6)", () => {
    type Params = { day?: string; category?: string; want?: boolean; from?: string; to?: string; at: number };
    let arrive: (p: Omit<Params, "at">) => Promise<void>;
    function Arriving() {
      const [params, setParams] = useState<Params>();
      arrive = (next) => act(async () => setParams((p) => ({ ...next, at: (p?.at ?? 0) + 1 })));
      return <Activity now={now} route={{ params }} />;
    }
    const wanted = { cursor: undefined, group: "spend", want: true, from: "2026-11-01", to: "2026-11-16" };

    it("shows the purchases of «желаемое» over the month's days, named in the summary and counted on the button", async () => {
      const transactions = summaryPage({ total: -360000, count: 9 });
      await renderWith(<Activity now={now} route={{ params: { want: true, from: "2026-11-01", to: "2026-11-16", at: 1 } }} />, fakeApi({ transactions }));
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith(wanted));
      expect(await screen.findByRole("button", { name: "Фильтры: 2" })).toBeTruthy();
      expect(await screen.findByText("Желаемое · 1–16 ноя: −₴3,600 · 9 операций")).toBeTruthy();
    });

    it("«Сбросить» takes it off with the rest", async () => {
      const transactions = summaryPage({ total: -360000, count: 9 });
      await renderWith(<Arriving />, fakeApi({ transactions }));
      await screen.findByRole("button", { name: "Фильтры" });
      await arrive({ want: true, from: "2026-11-01", to: "2026-11-16" });
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith(wanted));
      await fireEvent.press(await screen.findByRole("button", { name: "Фильтры: 2" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Сбросить" }));
      await windowGone();
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend" }));
      expect(await screen.findByRole("button", { name: "Фильтры" })).toBeTruthy();
      expect(screen.queryByText(/Желаемое/)).toBeNull();

      // The same again is applied again.
      await arrive({ want: true, from: "2026-11-01", to: "2026-11-16" });
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith(wanted));
    });

    it("«Показать» with another period keeps it", async () => {
      const transactions = summaryPage({ total: -120000, count: 3 });
      await renderWith(<Arriving />, fakeApi({ transactions }));
      await screen.findByRole("button", { name: "Фильтры" });
      await arrive({ want: true, from: "2026-11-01", to: "2026-11-16" });
      await fireEvent.press(await screen.findByRole("button", { name: "Фильтры: 2" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Неделя" }));
      await fireEvent.press(screen.getByRole("button", { name: "Показать" }));
      await windowGone();
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ ...wanted, from: "2026-11-03", to: "2026-11-09" }));
      expect(await screen.findByText("Желаемое · 3–9 ноя: −₴1,200 · 3 операции")).toBeTruthy();
    });

    it("a category or a day arriving later takes it off", async () => {
      const transactions = summaryPage({ total: -360000, count: 9 });
      await renderWith(<Arriving />, fakeApi({ transactions }));
      await screen.findByRole("button", { name: "Фильтры" });
      await arrive({ want: true, from: "2026-11-01", to: "2026-11-16" });
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith(wanted));
      await arrive({ category: "cafe", from: "2026-11-01", to: "2026-11-16" });
      await waitFor(() =>
        expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", category: "cafe", from: "2026-11-01", to: "2026-11-16" }),
      );
      await arrive({ want: true, from: "2026-11-01", to: "2026-11-16" });
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith(wanted));
      await arrive({ day: "2026-11-02" });
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", from: "2026-11-02", to: "2026-11-02" }));
      expect(await screen.findByRole("button", { name: "Фильтры: 1" })).toBeTruthy();
    });

    it("income is not narrowed by it and does not count it", async () => {
      const transactions = summaryPage({ total: -360000, count: 9 });
      await renderWith(<Activity now={now} route={{ params: { want: true, from: "2026-11-01", to: "2026-11-16", at: 1 } }} />, fakeApi({ transactions }));
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith(wanted));
      await fireEvent.press(screen.getByRole("button", { name: "Доходы" }));
      await waitFor(() =>
        expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "income", from: "2026-11-01", to: "2026-11-16" }),
      );
      expect(await screen.findByRole("button", { name: "Фильтры: 1" })).toBeTruthy();
    });
  });

  describe("arriving from the phrase of the day's observation (В7)", () => {
    const spike = { kind: "spike" as const, period: "month" as const, category: "cafe", spent: 482_000, usual: 310_000, amount: null, from: "2026-11-01", to: "2026-11-09" };
    const TEXT = "Кафе и рестораны с начала ноября ₴4,820. Обычно к этому дню около ₴3,100.";
    const CAPTION = "Обычно — середина трёх прошлых месяцев за те же дни";
    const fromObservation = { params: { category: "cafe", from: "2026-11-01", to: "2026-11-09", at: 1, observation: true } };

    it("says the same sentence above the list, with what «обычно» means, on that category and those days", async () => {
      const transactions = summaryPage({ total: -482000, count: 9 });
      await renderWith(<Activity now={now} route={fromObservation} />, fakeApi({ transactions, observation: jest.fn(async () => spike) }));
      expect(await screen.findByText(TEXT)).toBeTruthy();
      expect(screen.getByText(CAPTION)).toBeTruthy();
      await waitFor(() =>
        expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", category: "cafe", from: "2026-11-01", to: "2026-11-09" }),
      );
      expect(screen.getByRole("button", { name: "Не показывать такое" })).toBeTruthy();
    });

    it("the same filters from «Итоги» carry no observation", async () => {
      const observation = jest.fn(async () => spike);
      const { category, from, to, at } = fromObservation.params;
      await renderWith(<Activity now={now} route={{ params: { category, from, to, at } }} />, fakeApi({ transactions: summaryPage({ total: -482000, count: 9 }), observation }));
      await screen.findByText("Кафе и рестораны · 1–9 ноя: −₴4,820 · 9 операций");
      expect(screen.queryByText(TEXT)).toBeNull();
      expect(observation).not.toHaveBeenCalled();
    });

    it("«Не показывать такое» tells the server, hides the card and asks for today's observation again", async () => {
      const observation = jest.fn().mockResolvedValueOnce(spike).mockResolvedValue(null);
      const dismissObservation = jest.fn(async () => undefined);
      await renderWith(<Activity now={now} route={fromObservation} />, fakeApi({ transactions: summaryPage({ total: -482000, count: 9 }), observation, dismissObservation }));
      await fireEvent.press(await screen.findByRole("button", { name: "Не показывать такое" }));
      expect(dismissObservation).toHaveBeenCalledWith({ kind: "spike", category: "cafe" });
      await waitFor(() => expect(screen.queryByText(TEXT)).toBeNull());
      await waitFor(() => expect(observation).toHaveBeenCalledTimes(2));
      expect(screen.queryByText(CAPTION)).toBeNull();
    });

    it("comes back when «Не показывать такое» did not reach the server", async () => {
      const dismissObservation = jest.fn(async () => {
        throw new NetworkError();
      });
      await renderWith(
        <Activity now={now} route={fromObservation} />,
        fakeApi({ transactions: summaryPage({ total: -482000, count: 9 }), observation: jest.fn(async () => spike), dismissObservation }),
      );
      await fireEvent.press(await screen.findByRole("button", { name: "Не показывать такое" }));
      await waitFor(() => expect(dismissObservation).toHaveBeenCalled());
      expect(await screen.findByText(TEXT)).toBeTruthy();
    });

    it("goes away once the filters are changed", async () => {
      await renderWith(<Activity now={now} route={fromObservation} />, fakeApi({ transactions: summaryPage({ total: -482000, count: 9 }), observation: jest.fn(async () => spike) }));
      await screen.findByText(TEXT);
      await fireEvent.press(screen.getByRole("button", { name: "Фильтры: 2" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Сбросить" }));
      await windowGone();
      expect(screen.queryByText(TEXT)).toBeNull();
    });

    it("says nothing when today's observation is another one by now", async () => {
      await renderWith(
        <Activity now={now} route={fromObservation} />,
        fakeApi({ transactions: summaryPage({ total: -482000, count: 9 }), observation: jest.fn(async () => ({ ...spike, category: "groceries" })) }),
      );
      await screen.findByText("Кафе и рестораны · 1–9 ноя: −₴4,820 · 9 операций");
      expect(screen.queryByText(CAPTION)).toBeNull();
    });
  });

  it("income has no categories: one chosen for spending does not narrow it and is not counted there", async () => {
    const transactions = summaryPage({ total: -342000, count: 11 });
    await renderWith(<Activity now={now} />, fakeApi({ transactions }));
    await fireEvent.press(await screen.findByRole("button", { name: "Фильтры" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Кафе и рестораны" }));
    await fireEvent.press(screen.getByRole("button", { name: "Показать" }));
    await windowGone();
    await screen.findByRole("button", { name: "Фильтры: 1" });
    await fireEvent.press(screen.getByRole("button", { name: "Доходы" }));
    await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "income" }));
    expect(screen.getByRole("button", { name: "Фильтры" })).toBeTruthy();
  });

  describe("the window under «Доходы», with a category remembered from spending", () => {
    /** «Кафе и рестораны» chosen under «Траты», then over to «Доходы» with the window open there. */
    const openUnderIncome = async (transactions: ReturnType<typeof summaryPage>) => {
      await renderWith(<Activity now={now} />, fakeApi({ transactions }));
      await fireEvent.press(await screen.findByRole("button", { name: "Фильтры" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Кафе и рестораны" }));
      await fireEvent.press(screen.getByRole("button", { name: "Показать" }));
      await windowGone();
      await fireEvent.press(screen.getByRole("button", { name: "Доходы" }));
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "income" }));
      await fireEvent.press(screen.getByRole("button", { name: "Фильтры" }));
      await screen.findByRole("button", { name: "Показать" });
      expect(screen.queryByRole("button", { name: "Кафе и рестораны" })).toBeNull();
    };

    it("«Показать» there keeps the category: it is back on «Траты» and on «Все»", async () => {
      const transactions = summaryPage({ total: -342000, count: 11 });
      await openUnderIncome(transactions);
      await fireEvent.press(screen.getByRole("button", { name: "Неделя" }));
      await fireEvent.press(screen.getByRole("button", { name: "Показать" }));
      await windowGone();
      // Income itself is narrowed by the period only.
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "income", from: "2026-11-03", to: "2026-11-09" }));
      expect(screen.getByRole("button", { name: "Фильтры: 1" })).toBeTruthy();

      await fireEvent.press(screen.getByRole("button", { name: "Траты" }));
      await waitFor(() =>
        expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", category: "cafe", from: "2026-11-03", to: "2026-11-09" }),
      );
      expect(await screen.findByRole("button", { name: "Фильтры: 2" })).toBeTruthy();

      await fireEvent.press(screen.getByRole("button", { name: "Все" }));
      await waitFor(() =>
        expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "all", category: "cafe", from: "2026-11-03", to: "2026-11-09" }),
      );
      expect(await screen.findByRole("button", { name: "Фильтры: 2" })).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Фильтры: 2" }));
      expect((await screen.findByRole("button", { name: "Кафе и рестораны" })).props.accessibilityState.selected).toBe(true);
    });

    it("«Сбросить» there clears everything, the category too", async () => {
      const transactions = summaryPage({ total: -342000, count: 11 });
      await openUnderIncome(transactions);
      await fireEvent.press(screen.getByRole("button", { name: "Сбросить" }));
      await windowGone();

      await fireEvent.press(screen.getByRole("button", { name: "Траты" }));
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend" }));
      expect(screen.getByRole("button", { name: "Фильтры" })).toBeTruthy();

      await fireEvent.press(screen.getByRole("button", { name: "Все" }));
      await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "all" }));
      expect(screen.getByRole("button", { name: "Фильтры" })).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Фильтры" }));
      expect((await screen.findByRole("button", { name: "Кафе и рестораны" })).props.accessibilityState.selected).toBe(false);
    });
  });
});

describe("Activity edit sheet", () => {
  it("changes the category in one tap for this operation, then «Да, всегда» takes it to the similar ones (В5)", async () => {
    const api = fakeApi();
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Кофейня"));
    await fireEvent.press(await screen.findByRole("button", { name: "Продукты" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(1, { category: "groceries", applyToSimilar: false }));
    expect(await screen.findByText("Всегда так для «Кофейня»?")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Да, всегда" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenLastCalledWith(1, { category: "groceries", applyToSimilar: true }));
    await waitFor(() => expect(screen.queryByText("Тип")).toBeNull());
  });

  it("changes the type in one tap; «Только эта» leaves the similar ones as they are (В5)", async () => {
    const api = fakeApi();
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Кофейня"));
    await fireEvent.press(await screen.findByRole("button", { name: "Обязательный платёж" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(1, { type: "obligation", applyToSimilar: false }));
    await fireEvent.press(await screen.findByRole("button", { name: "Только эта" }));
    expect(screen.queryByText(/Всегда так/)).toBeNull();
    expect(api.editTransaction).toHaveBeenCalledTimes(1);
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
    expect(screen.getByText("Тип")).toBeTruthy();
  });
});

describe("Activity recipient label", () => {
  const person = txFixture({ id: 5, description: "Перевод на карту", counterName: "Иван", type: "person_transfer", category: "transfer", needsLabel: true, counterKey: "fedcba9876543210" });

  it("asks what the transfer is, says what each answer does, and takes one tap", async () => {
    const api = fakeApi({ transactions: page([person]) });
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Иван"));
    expect(await screen.findByText("Что это за перевод?")).toBeTruthy();
    expect(await screen.findByText("Иван · 5 переводов, ₴1,000")).toBeTruthy();
    expect(api.recipient).toHaveBeenCalledWith("fedcba9876543210");
    for (const t of ["Близкий человек, регулярно", "Оплата услуги или покупка", "Это мой счёт"]) {
      expect(screen.getByRole("button", { name: t })).toBeTruthy();
    }
    expect(screen.getByText("Считается в дневном лимите. Платёж из плана лимит не тратит")).toBeTruthy();
    // The rare answers wait behind «Другое».
    expect(screen.queryByRole("button", { name: "Даю в долг" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Другое" }));
    for (const t of ["Разовая помощь или подарок", "Возвращаю долг", "Даю в долг", "Не спрашивать"]) {
      expect(screen.getByRole("button", { name: t })).toBeTruthy();
    }
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
    await fireEvent.press(await screen.findByRole("button", { name: "Другое" }));
    await fireEvent.press(screen.getByRole("button", { name: "Не спрашивать" }));
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
    // The window closes with an animation and covers the list until it is gone: a person cannot tap a row before that.
    await waitFor(() => expect(screen.queryByRole("button", { name: /Что это за перевод/ })).toBeNull());
    await fireEvent.press(await screen.findByText("Кофейня"));
    await screen.findByText("Тип");
    expect(screen.queryByRole("button", { name: /Что это за перевод/ })).toBeNull();
  });

  it("still lets the type be changed from the label sheet", async () => {
    const api = fakeApi({ transactions: page([person]) });
    await renderWith(<Activity />, api);
    await fireEvent.press(await screen.findByText("Иван"));
    await fireEvent.press(await screen.findByRole("button", { name: "Изменить тип" }));
    expect(await screen.findByText("Тип")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Обязательный платёж" }));
    await waitFor(() => expect(api.editTransaction).toHaveBeenCalledWith(5, { type: "obligation", applyToSimilar: false }));
  });

  it("marks rows that need an answer", async () => {
    await renderWith(<Activity />, fakeApi({ transactions: page([person]) }));
    expect(await screen.findByText("Ждёт ответа")).toBeTruthy();
  });
});

describe("Activity: own categories (В5)", () => {
  const LIST = [
    { key: "cafe", name: "Кофе", icon: "coffee" as const, system: false },
    { key: "c_cat", name: "Кот", icon: "paw" as const, system: false },
    { key: "uncategorized", name: "Без категории", icon: "circle" as const, system: true },
  ];

  it("rows carry the server's name and icon; type-level keys keep today's words", async () => {
    const items = [
      txFixture({ id: 1, description: "Зоомагазин", category: "c_cat" }),
      txFixture({ id: 2, description: "ФОП", type: "tax", category: "tax", amount: -2000, amountUah: -2000 }),
    ];
    await renderWith(<Activity />, fakeApi({ transactions: page(items), categories: jest.fn(async () => LIST) }));
    expect(await screen.findByText("Кот")).toBeTruthy();
    expect(screen.getByTestId("tx-icon-paw")).toBeTruthy();
    expect(screen.getByText("Налог")).toBeTruthy();
  });

  it("the filters offer the server's categories, and the summary names the chosen one as the server does", async () => {
    const transactions = jest.fn(async () => ({ items: [txFixture()], nextCursor: null, dayTotals: {}, summary: { total: -2500, count: 2 } }));
    await renderWith(<Activity />, fakeApi({ transactions, categories: jest.fn(async () => LIST) }));
    await screen.findByText("Кофейня");
    await fireEvent.press(screen.getByRole("button", { name: "Фильтры" }));
    expect(await screen.findByRole("button", { name: "Кот" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Продукты" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Кот" }));
    await fireEvent.press(screen.getByRole("button", { name: "Показать" }));
    await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", category: "c_cat" }));
    expect(await screen.findByText("Кот: −₴25 · 2 операции")).toBeTruthy();
  });

  it("a chosen category that has since been deleted drops out of the filters instead of showing its key", async () => {
    const transactions = jest.fn(async () => ({ items: [txFixture()], nextCursor: null, dayTotals: {}, summary: { total: -2500, count: 2 } }));
    await renderWith(
      <Activity route={{ params: { category: "c_gone", from: "2026-11-01", to: "2026-11-16", at: 1 } }} />,
      fakeApi({ transactions, categories: jest.fn(async () => LIST) }),
    );
    await waitFor(() => expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", from: "2026-11-01", to: "2026-11-16" }));
    expect(await screen.findByRole("button", { name: "Фильтры: 1" })).toBeTruthy();
    expect(screen.queryByText(/c_gone/)).toBeNull();
  });

  it("a type-level key from «Итоги» («Переводы») stays chosen though the list of purchase categories lacks it", async () => {
    const transactions = jest.fn(async () => ({ items: [txFixture()], nextCursor: null, dayTotals: {}, summary: { total: -2500, count: 2 } }));
    const categories = jest.fn(async () => LIST);
    await renderWith(
      <Activity route={{ params: { category: "transfer", from: "2026-11-01", to: "2026-11-16", at: 1 } }} />,
      fakeApi({ transactions, categories }),
    );
    await waitFor(() => expect(categories).toHaveBeenCalled());
    expect(await screen.findByText("Переводы · 1–16 ноя: −₴25 · 2 операции")).toBeTruthy();
    expect(transactions).toHaveBeenLastCalledWith({ cursor: undefined, group: "spend", category: "transfer", from: "2026-11-01", to: "2026-11-16" });
    expect(screen.getByRole("button", { name: "Фильтры: 2" })).toBeTruthy();
  });
});
