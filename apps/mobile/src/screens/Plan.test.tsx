import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { Alert, StyleSheet } from "react-native";
import type { OwnMoneyItemDto, TodayDto } from "@hale/contracts";
import { Plan } from "./Plan";
import { Today } from "./Today";
import { balanceFixture, fakeApi, goalFixture, loanFixture, loanHistoryFixture, makeClient, openPlanPart, ownItemsFixture, pickDate, renderWith, taxFixture, todayFixture, todayWithItems } from "../testing";
import { dateLabel, formatMoney, kyivDate, shiftDate } from "../format";
import { LAYOUT } from "../components/layout";
import { LoansSheet } from "../components/LoansSheet";
import { NetworkError } from "../api/client";
import { TODAY_KEY } from "../api/queries";
import { tokens } from "@hale/tokens";

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
/** One open loan: «Займы» then shows a count. */
const withOpenLoan = () => ({ loanHistory: jest.fn(async () => loanHistoryFixture({ stats: { borrowed: 500_000, repaid: 0, serviceCost: 0, stillOpen: 500_000 }, open: [loanFixture()] })) });
/** The texts on the screen in their order, among those given. */
const inOrder = (pattern: RegExp) => screen.getAllByText(pattern).map((t) => t.props.children);

describe("Plan, the iOS list (variant А)", () => {
  it("has a large title, «Свои деньги» as the first figure, and the sections in their order", async () => {
    await renderWith(<Plan />, fakeApi());
    expect(screen.getByText("План")).toBeTruthy();
    expect(await screen.findByText("Свои деньги")).toBeTruthy();
    expect(screen.getByText("₴10,325")).toBeTruthy();
    await screen.findByText("Счета");
    expect(inOrder(/^(До дохода|Счета|Разделы)$/)).toEqual(["До дохода", "Счета", "Разделы"]);
    // The old groups and their fold are gone.
    for (const old of ["Деньги", "Приходит", "Уходит", "Копится"]) expect(screen.queryByText(old)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Ещё/ })).toBeNull();
  });

  it("draws the large title and own money a touch brighter than the text, the caption in the quiet grey (variant «Б»)", async () => {
    await renderWith(<Plan />, fakeApi());
    const caption = await screen.findByText("Свои деньги");
    expect(StyleSheet.flatten(screen.getByText("План").props.style).color).toBe(tokens.color.fg.strong);
    expect(StyleSheet.flatten(caption.props.style).color).toBe(tokens.color.list.secondary);
    const own = screen.getByText(formatMoney(todayFixture().accounts.own));
    expect(StyleSheet.flatten(own.props.style).color).toBe(tokens.color.fg.strong);
  });

  it("has no line about what is left after the payments: the free money also holds back the tax reserve and loans", async () => {
    await renderWith(<Plan />, fakeApi());
    await screen.findByText("Свои деньги");
    expect(screen.queryByText(/^После платежей/)).toBeNull();
    expect(screen.queryByText(/останется/)).toBeNull();
  });

  it("puts every part in «Разделы» with a short count, and no amounts or dates under the rows", async () => {
    const api = fakeApi({
      expectedIncomes: jest.fn(async () => [{ id: 1, source: "fop" as const, amount: 1_000_000, currency: "UAH", window_start_day: 25, window_end_day: 25 }]),
      incomeEvents: jest.fn(async () => [{ id: 5, expected_income_id: 1, period: "2026-11", expected_on: "2026-11-25", status: "expected" }]),
      recurring: jest.fn(async () => [{ id: 3, kind: "obligation" as const, name: "Квартира", amount: 100_000, currency: "UAH", day_of_month: 26, active: true }]),
      payments: jest.fn(async () => [
        taxFixture({ id: 1, kind: "obligation", name: "Квартира", amount: 100_000, due_on: "2026-11-26", recurring_id: 3 }),
        taxFixture({ id: 4, kind: "obligation", name: "Страховка", amount: 50_000, due_on: "2026-12-10" }),
        taxFixture({ id: 2, kind: "installment", name: "Телефон", amount: 200_000, due_on: "2026-12-02" }),
        taxFixture({ id: 6, kind: "installment", name: "Телефон", amount: 200_000, due_on: "2027-01-02" }),
        taxFixture({ id: 3 }),
      ]),
      goals: jest.fn(async () => [goalFixture(), goalFixture({ id: 2, name: "Машина" })]),
      ...withOpenLoan(),
    });
    await renderWith(<Plan />, api);
    await waitFor(() => expect(screen.getByRole("button", { name: "Платежи" }).props.accessibilityHint).toBe("2"));
    expect(screen.getByRole("button", { name: "Доходы" }).props.accessibilityHint).toBe("1");
    expect(screen.getByRole("button", { name: "Рассрочки" }).props.accessibilityHint).toBe("1");
    expect(screen.getByRole("button", { name: "Налоги" }).props.accessibilityHint).toBe("1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Займы" }).props.accessibilityHint).toBe("1"));
    expect(screen.getByRole("button", { name: "Цели" }).props.accessibilityHint).toBe("2");
    expect(inOrder(/^(Доходы|Платежи|Рассрочки|Налоги|Займы|Цели)$/)).toEqual(["Доходы", "Платежи", "Рассрочки", "Налоги", "Займы", "Цели"]);
    for (const old of [/ближайший/, /^осталось/, /^следующий/, /из \$/, /^открыто/]) expect(screen.queryByText(old)).toBeNull();
    expect(screen.queryByPlaceholderText(/./)).toBeNull();
  });

  it("shows nothing on the right of an empty part rather than «нет»", async () => {
    await renderWith(<Plan />, fakeApi({ payments: jest.fn(async () => [taxFixture({ paid_at: "2026-11-01T00:00:00Z" })]) }));
    await screen.findByText("Счета");
    expect(screen.getByRole("button", { name: "Налоги" }).props.accessibilityHint).toBeUndefined();
    expect(screen.getByRole("button", { name: "Рассрочки" }).props.accessibilityHint).toBeUndefined();
    expect(screen.queryByText("нет")).toBeNull();
  });

  it("keeps «Займы» with no open loan, with nothing on the right, and a loan can still be added from it", async () => {
    const repaidOnly = loanHistoryFixture({ repaid: [loanFixture({ id: 9, remaining: 0, repaidOn: "2026-10-20", repaidAmount: 500_000 })] });
    const api = fakeApi({ loanHistory: jest.fn(async () => repaidOnly) });
    await renderWith(<Plan />, api);
    await screen.findByText("Счета");
    await waitFor(() => expect(api.loanHistory).toHaveBeenCalled());
    await act(async () => new Promise<void>((r) => setTimeout(r, 50)));
    const row = screen.getByRole("button", { name: "Займы" });
    expect(row.props.accessibilityHint).toBeUndefined();
    await fireEvent.press(row);
    expect(await screen.findByRole("button", { name: "Новый займ" })).toBeTruthy();
  });

  it("has no «Налоги» and no word «ФОП» when the server says there are no taxes (Д4)", async () => {
    await renderWith(<Plan />, fakeApi({ today: jest.fn(async () => ({ ...todayWithItems(), taxes: false })) }));
    expect(await screen.findByRole("button", { name: "Рассрочки" })).toBeTruthy();
    await screen.findByText("Счета");
    expect(screen.queryByRole("button", { name: "Налоги" })).toBeNull();
    expect(screen.queryByText(/налог/i)).toBeNull();
    expect(screen.queryByText(/ФОП/)).toBeNull();
  });

  it("keeps «Налоги» with an unpaid tax payment, even when the server says there are no taxes (Д4)", async () => {
    await renderWith(<Plan />, fakeApi({ today: jest.fn(async () => ({ ...todayFixture(), taxes: false })), payments: jest.fn(async () => [taxFixture()]) }));
    expect(await screen.findByRole("button", { name: "Налоги" })).toBeTruthy();
  });

  it("shows «Налоги» when the server has taxes on, or does not say (Д4)", async () => {
    await renderWith(<Plan />, fakeApi({ today: jest.fn(async () => ({ ...todayFixture(), taxes: true })) }));
    expect(await screen.findByRole("button", { name: "Налоги" })).toBeTruthy();
  });
});

describe("Plan, «До дохода» (variant А)", () => {
  const runway = (over: Partial<NonNullable<TodayDto["runway"]>> = {}): NonNullable<TodayDto["runway"]> => ({
    endOn: "2026-12-15",
    incomeOn: "2026-12-15",
    reserve: 0,
    zeroOn: null,
    points: [],
    events: [
      { id: "2", date: "2026-12-12", name: "Рассрочка · техника", amount: 240_000 },
      { id: "1", date: "2026-12-06", name: "Квартплата", amount: 800_000 },
    ],
    ...over,
  });
  const withIncome = () => ({
    expectedIncomes: jest.fn(async () => [{ id: 1, source: "usdc" as const, amount: 270_000, currency: "USD", window_start_day: 15, window_end_day: 15, name: "Работа" }]),
    incomeEvents: jest.fn(async () => [{ id: 5, expected_income_id: 1, period: "2026-12", expected_on: "2026-12-15", status: "expected" }]),
  });

  it("lists the unpaid payments by date and the income last, with dates as «6 дек»", async () => {
    await renderWith(<Plan />, fakeApi({ ...withIncome(), today: jest.fn(async () => todayFixture({ runway: runway() })) }));
    expect(await screen.findByText("+$2,700")).toBeTruthy();
    expect(inOrder(/^(Квартплата|Рассрочка · техника|Работа)$/)).toEqual(["Квартплата", "Рассрочка · техника", "Работа"]);
    expect(screen.getByText("−₴8,000")).toBeTruthy();
    expect(screen.getByText("−₴2,400")).toBeTruthy();
    // One line each, «6 дек», not the day stacked over its month.
    expect(inOrder(/^\d+ дек$/)).toEqual(["6 дек", "12 дек", "15 дек"]);
    expect(screen.queryAllByText("дек")).toHaveLength(0);
    expect(screen.getByText("Что после дохода — в разделах ниже.")).toBeTruthy();
    // No date on this screen as «06.12».
    expect(screen.queryAllByText(/\d\d\.\d\d/)).toHaveLength(0);
  });

  it("reads each row as one whole: the date, what happens and its amount", async () => {
    await renderWith(<Plan />, fakeApi({ ...withIncome(), today: jest.fn(async () => todayFixture({ runway: runway() })) }));
    await screen.findByText("+$2,700");
    expect(screen.getByLabelText("6 декабря, Квартплата, −₴8,000")).toBeTruthy();
    expect(screen.getByLabelText("12 декабря, Рассрочка · техника, −₴2,400")).toBeTruthy();
    expect(screen.getByLabelText("15 декабря, Работа, +$2,700")).toBeTruthy();
  });

  it("calls the income «Доход» and shows no amount when no expected income falls on that day", async () => {
    await renderWith(<Plan />, fakeApi({ today: jest.fn(async () => todayFixture({ runway: runway() })) }));
    expect(await screen.findByText("Доход")).toBeTruthy();
    expect(screen.queryByText(/^\+/)).toBeNull();
    expect(screen.getByLabelText("15 декабря, Доход")).toBeTruthy();
  });

  it("is not there without a runway (an older server) or without an income date; with no payments it still shows the income", async () => {
    const { unmount } = await renderWith(<Plan />, fakeApi({ today: jest.fn(async () => todayFixture({ runway: undefined })) }));
    await screen.findByText("Счета");
    expect(screen.queryByText("До дохода")).toBeNull();
    await unmount();
    const second = await renderWith(<Plan />, fakeApi({ today: jest.fn(async () => todayFixture({ runway: runway({ incomeOn: null }) })) }));
    await screen.findByText("Счета");
    expect(screen.queryByText("До дохода")).toBeNull();
    expect(screen.queryByText("Квартплата")).toBeNull();
    await second.unmount();
    await renderWith(<Plan />, fakeApi({ today: jest.fn(async () => todayFixture({ runway: runway({ events: [] }) })) }));
    // Only the income: still a row of its own.
    expect(await screen.findByText("До дохода")).toBeTruthy();
    expect(screen.getByText("Доход")).toBeTruthy();
  });
});

describe("Plan, money place by place (task Б25)", () => {
  const withItems = (items = ownItemsFixture()) => ({
    today: jest.fn(async () => todayWithItems(items)),
    cash: jest.fn(async () => ({ started: true, start: "2026-11-01", balance: 3_025_000 })),
    manualBalances: jest.fn(async () => [balanceFixture({ amount: 12_600 })]),
  });

  it("shows own money as one figure and, in «Счета», the places that add up to it", async () => {
    await renderWith(<Plan />, fakeApi(withItems()));
    expect(await screen.findByText("₴20,362")).toBeTruthy();
    // Places with money first, the card in credit last.
    expect(inOrder(/^(Белая карта|Наличные|Binance|Чёрная карта)$/)).toEqual(["Белая карта", "Наличные", "Binance", "Чёрная карта"]);
    expect(screen.getByText("₴14,313")).toBeTruthy();
    expect(screen.getByText("₴30,250")).toBeTruthy();
    expect(screen.getByText("₴5,799")).toBeTruthy();
    expect(screen.getByText("$126")).toBeTruthy();
    for (const old of ["Свои", "Кредитные", "в том числе ФОП", "₴30,000", "свои деньги — сумма строк ниже"]) expect(screen.queryByText(old)).toBeNull();
    // Cash and Binance are in the list once, not again as rows of their own.
    expect(screen.getAllByRole("button", { name: "Наличные" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Binance" })).toHaveLength(1);
  });

  it("puts a spent credit limit on its card with a real minus sign and says it in words", async () => {
    await renderWith(<Plan />, fakeApi(withItems()));
    expect(await screen.findByText("−₴30,000")).toBeTruthy();
    expect(screen.getByText("кредитный лимит потрачен весь")).toBeTruthy();
  });

  it("says how much of the credit limit a partly used card stands for", async () => {
    const items = [
      { kind: "black" as const, name: "Чёрная карта", own: -2_000_000, creditLimit: 3_000_000 },
      { kind: "white" as const, name: "Белая карта", own: 2_500_000 },
    ];
    await renderWith(<Plan />, fakeApi(withItems(items)));
    expect(await screen.findByText("−₴20,000")).toBeTruthy();
    expect(screen.getByText("потрачено из кредитного лимита ₴30,000")).toBeTruthy();
    expect(screen.getByText("₴5,000")).toBeTruthy();
  });

  it("rounds the places so they add up to the big figure to the hryvnia", async () => {
    const items = [
      { kind: "white" as const, name: "Белая карта", own: 1_431_350 },
      { kind: "fop" as const, name: "Счёт ФОП", own: 300_050 },
      { kind: "black" as const, name: "Чёрная карта", own: -3_000_000, creditLimit: 3_000_000 },
    ];
    await renderWith(<Plan />, fakeApi(withItems(items)));
    expect(await screen.findByText("−₴12,686")).toBeTruthy();
    // Each rounded alone they would be ₴14,314 + ₴3,001 − ₴30,000 = −₴12,685.
    expect(screen.getByText("₴14,314")).toBeTruthy();
    expect(screen.getByText("₴3,000")).toBeTruthy();
    expect(screen.getByText("−₴30,000")).toBeTruthy();
  });

  it("shows no accounts while «Сегодня» is loading", async () => {
    await renderWith(<Plan />, fakeApi({ ...withItems(), today: jest.fn(() => new Promise<never>(() => undefined)) }));
    await waitFor(() => expect(screen.getByText("Разделы")).toBeTruthy());
    await act(async () => new Promise<void>((r) => setTimeout(r, 50)));
    expect(screen.queryByText("Счета")).toBeNull();
    expect(screen.queryByRole("button", { name: "Наличные" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Binance" })).toBeNull();
  });

  it("shows the FOP account as its own place", async () => {
    await renderWith(<Plan />, fakeApi(withItems([{ kind: "fop", name: "Счёт ФОП", own: 412_500 }])));
    expect(await screen.findByText("Счёт ФОП")).toBeTruthy();
    expect(screen.getAllByText("₴4,125")).toHaveLength(2);
  });

  it("opens the cash window from the cash place", async () => {
    await renderWith(<Plan />, fakeApi(withItems()));
    // Wait for «Сегодня»: the place in the list is the row to press, not one that goes away on load.
    await screen.findByText("₴20,362");
    await fireEvent.press(screen.getByRole("button", { name: "Наличные" }));
    expect(await screen.findByText("Пересчитайте наличные и введите, сколько на самом деле.")).toBeTruthy();
  });

  it("opens the Binance window from the Binance place", async () => {
    await renderWith(<Plan />, fakeApi(withItems()));
    await screen.findByText("₴20,362");
    await fireEvent.press(screen.getByRole("button", { name: "Binance" }));
    expect(await screen.findByText("Баланс Binance")).toBeTruthy();
  });

  it("on a server without «Отложено» keeps an unset Binance and an unstarted wallet as rows of «Счета»", async () => {
    await renderWith(<Plan />, fakeApi({ today: jest.fn(async () => todayWithItems([{ kind: "white", name: "Белая карта", own: 500_000 }])) }));
    expect((await screen.findByRole("button", { name: "Binance" })).props.accessibilityHint).toBe("не задан");
    expect((await screen.findByRole("button", { name: "Наличные" })).props.accessibilityHint).toBe("не начат");
    expect(screen.getAllByText("₴5,000")).toHaveLength(2);
  });

  it("on a server without «Отложено» keeps a started wallet and Binance at zero as rows of «Счета» that open their windows", async () => {
    const items: OwnMoneyItemDto[] = [
      { kind: "white", name: "Белая карта", own: 500_000 },
      { kind: "cash", name: "Наличные", own: 0 },
      { kind: "binance", name: "Binance", own: 0, currency: "USD", amount: 0 },
    ];
    await renderWith(<Plan />, fakeApi({ ...withItems(items), cash: jest.fn(async () => ({ started: true, start: "2026-11-01", balance: 0 })) }));
    expect((await screen.findByRole("button", { name: "Наличные" })).props.accessibilityHint).toBe("₴0");
    expect(screen.getByRole("button", { name: "Binance" }).props.accessibilityHint).toBe("₴0, $0");
    await fireEvent.press(screen.getByRole("button", { name: "Наличные" }));
    expect(await screen.findByText("Пересчитайте наличные и введите, сколько на самом деле.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Закрыть" }));
    await waitFor(() => expect(screen.queryByText("Пересчитайте наличные и введите, сколько на самом деле.")).toBeNull());
    await fireEvent.press(screen.getByRole("button", { name: "Binance" }));
    expect(await screen.findByText("Баланс Binance")).toBeTruthy();
  });
});

describe("Plan, own and set-aside accounts (Д2б, variant А)", () => {
  const items = (): OwnMoneyItemDto[] => [
    { kind: "white", name: "Белая карта", own: 1_431_300, id: 2, source: "account", countsAsOwn: true },
    { kind: "other", name: "Детская карта", own: 210_000, id: 5, source: "account", countsAsOwn: true },
    { kind: "cash", name: "Наличные", own: 3_025_000, source: "cash", countsAsOwn: true },
    { kind: "binance", name: "Binance", own: 579_900, currency: "USD", amount: 12_600, id: 7, source: "manual", countsAsOwn: true },
    // A card switched off while in debt: its debt stays in own money.
    { kind: "black", name: "Чёрная карта", own: -3_000_000, creditLimit: 3_000_000, id: 1, source: "account", countsAsOwn: false },
  ];
  const setAside = (): OwnMoneyItemDto[] => [
    { kind: "manual", name: "SOL", own: 4_145_625, currency: "USD", amount: 100_500, id: 9, source: "manual", countsAsOwn: false },
    { kind: "manual", name: "Депозит Приват", own: 5_000_000, currency: "UAH", amount: 5_000_000, id: 10, source: "manual", countsAsOwn: false },
  ];
  const newer = (aside: OwnMoneyItemDto[] = setAside(), own: OwnMoneyItemDto[] = items()) => {
    const today = todayWithItems(own);
    return {
      today: jest.fn(async () => ({ ...today, accounts: { ...today.accounts, setAside: aside } })),
      cash: jest.fn(async () => ({ started: true, start: "2026-11-01", balance: 3_025_000 })),
      manualBalances: jest.fn(async () => [balanceFixture({ amount: 12_600 })]),
    };
  };
  const openAside = async () => {
    await fireEvent.press(await screen.findByRole("button", { name: "Отложено" }));
    await screen.findByText("Добавить счёт");
  };

  it("shows «Отложено» as one row of «Счета», with its total, and no set-aside places or «Добавить счёт» on the screen", async () => {
    await renderWith(<Plan />, fakeApi(newer()));
    const row = await screen.findByRole("button", { name: "Отложено" });
    expect(row.props.accessibilityHint).toBe("₴91,456, не входит в свои деньги");
    expect(screen.getByText("не входит в свои деньги")).toBeTruthy();
    expect(screen.getByText("₴91,456")).toBeTruthy();
    // The last row of «Счета».
    expect(inOrder(/^(Белая карта|Чёрная карта|Отложено|Разделы)$/)).toEqual(["Белая карта", "Чёрная карта", "Отложено", "Разделы"]);
    expect(screen.queryByText("SOL")).toBeNull();
    expect(screen.queryByText("Депозит Приват")).toBeNull();
    expect(screen.queryByRole("button", { name: "Добавить счёт" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Добавить в отложенное" })).toBeNull();
  });

  it("opens the set-aside places from «Отложено», with «Добавить счёт» inside", async () => {
    await renderWith(<Plan />, fakeApi(newer()));
    await openAside();
    expect(screen.getByRole("button", { name: "SOL" }).props.accessibilityHint).toBe("$1,005");
    expect(screen.getByRole("button", { name: "Депозит Приват" }).props.accessibilityHint).toBe("₴50,000");
    expect(screen.getByRole("button", { name: "Добавить счёт" })).toBeTruthy();
  });

  it("moves a place with nothing on it out of «Счета» into «Отложено»", async () => {
    const empty: OwnMoneyItemDto = { kind: "manual", name: "Конверт", own: 0, currency: "UAH", amount: 0, id: 11, source: "manual", countsAsOwn: true };
    await renderWith(<Plan />, fakeApi(newer(setAside(), [...items(), empty])));
    await screen.findByText("Белая карта");
    expect(screen.queryByText("Конверт")).toBeNull();
    await openAside();
    expect(screen.getByRole("button", { name: "Конверт" }).props.accessibilityHint).toBe("₴0");
    await fireEvent.press(screen.getByRole("button", { name: "Конверт" }));
    expect((await screen.findByLabelText("Остаток, ₴")).props.value).toBe("0");
  });

  it("puts the places at ₴0 under «Сейчас пусто» below the set-aside ones, with one quiet line at the end (ЯМ5)", async () => {
    const empty: OwnMoneyItemDto = { kind: "manual", name: "Конверт", own: 0, currency: "UAH", amount: 0, id: 11, source: "manual", countsAsOwn: true };
    await renderWith(<Plan />, fakeApi(newer(setAside(), [...items(), empty])));
    await openAside();
    const header = screen.getByText("Сейчас пусто");
    expect(StyleSheet.flatten(header.props.style).color).toBe(tokens.color.list.secondary);
    expect(inOrder(/^(SOL|Депозит Приват|Сейчас пусто|Конверт|Добавить счёт)$/)).toEqual(["SOL", "Депозит Приват", "Сейчас пусто", "Конверт", "Добавить счёт"]);
    const line = screen.getByText("Пустые счета вернутся в «Счета», когда на них появятся деньги.");
    expect(StyleSheet.flatten(line.props.style).color).toBe(tokens.color.list.secondary);
    expect(inOrder(/^(Добавить счёт|Пустые счета вернутся.*)$/)).toEqual(["Добавить счёт", "Пустые счета вернутся в «Счета», когда на них появятся деньги."]);
  });

  it("with no place at ₴0 has neither «Сейчас пусто» nor the line (ЯМ5)", async () => {
    await renderWith(<Plan />, fakeApi(newer()));
    await openAside();
    expect(screen.queryByText("Сейчас пусто")).toBeNull();
    expect(screen.queryByText(/^Пустые счета/)).toBeNull();
  });

  it("an unstarted wallet and an unset Binance stand under «Сейчас пусто», still «не начат» and «не задан» (ЯМ5)", async () => {
    const own = items().filter((i) => i.kind !== "binance" && i.kind !== "cash");
    await renderWith(<Plan />, fakeApi({ ...newer(setAside(), own), manualBalances: jest.fn(async () => []), cash: jest.fn(async () => ({ started: false, start: null, balance: 0 })) }));
    await openAside();
    await waitFor(() => expect(screen.getByRole("button", { name: "Наличные" }).props.accessibilityHint).toBe("не начат"));
    expect(inOrder(/^(Депозит Приват|Сейчас пусто|Наличные|Binance|Добавить счёт)$/)).toEqual(["Депозит Приват", "Сейчас пусто", "Наличные", "Binance", "Добавить счёт"]);
  });

  it("keeps an unset Binance and an unstarted wallet in «Отложено», not in «Счета»", async () => {
    const own = items().filter((i) => i.kind !== "binance" && i.kind !== "cash");
    await renderWith(<Plan />, fakeApi({ ...newer(setAside(), own), manualBalances: jest.fn(async () => []), cash: jest.fn(async () => ({ started: false, start: null, balance: 0 })) }));
    await screen.findByText("Белая карта");
    expect(screen.queryByRole("button", { name: "Binance" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Наличные" })).toBeNull();
    await openAside();
    expect(screen.getByRole("button", { name: "Binance" }).props.accessibilityHint).toBe("не задан");
    expect(screen.getByRole("button", { name: "Наличные" }).props.accessibilityHint).toBe("не начат");
  });

  it("shows a switched-off card in debt among own money, and its window has the switch off", async () => {
    await renderWith(<Plan />, fakeApi(newer()));
    await fireEvent.press(await screen.findByRole("button", { name: "Чёрная карта" }));
    expect(await screen.findByText("приходит из monobank")).toBeTruthy();
    expect(screen.getByLabelText("Входит в свои деньги").props.value).toBe(false);
  });

  it("opens a card's window from its row, and switching it off refreshes «Сегодня»", async () => {
    const api = fakeApi(newer());
    await renderWith(<Plan />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Детская карта" }));
    expect(await screen.findByText("monobank")).toBeTruthy();
    expect(screen.getByLabelText("Название").props.value).toBe("Детская карта");
    // The row under the window and the window itself show the same amount.
    expect(screen.getAllByText("₴2,100")).toHaveLength(2);
    await fireEvent(screen.getByLabelText("Входит в свои деньги"), "valueChange", false);
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.patchAccount).toHaveBeenCalledWith(5, { countsAsOwn: false }));
    await waitFor(() => expect(api.today.mock.calls.length).toBeGreaterThan(1));
  });

  it("opens a set-aside account kept by hand in the account window", async () => {
    await renderWith(<Plan />, fakeApi(newer()));
    await openAside();
    await fireEvent.press(screen.getByRole("button", { name: "Депозит Приват" }));
    expect((await screen.findByLabelText("Остаток, ₴")).props.value).toBe("50000");
    expect(screen.getByLabelText("Входит в свои деньги").props.value).toBe(false);
  });

  it("keeps Binance's own window", async () => {
    await renderWith(<Plan />, fakeApi(newer()));
    await fireEvent.press(await screen.findByRole("button", { name: "Binance" }));
    expect(await screen.findByText("Баланс Binance")).toBeTruthy();
  });

  it("adds an account from «Отложено»: set aside unless switched on, and refreshes «Сегодня»", async () => {
    const api = fakeApi(newer());
    await renderWith(<Plan />, api);
    await openAside();
    await fireEvent.press(screen.getByRole("button", { name: "Добавить счёт" }));
    expect(await screen.findByText("Новый счёт")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Название"), "Конверт");
    await fireEvent.changeText(screen.getByLabelText("Остаток"), "3000");
    const add = screen.getAllByRole("button", { name: "Добавить счёт" });
    await fireEvent.press(add[add.length - 1]!);
    await waitFor(() => expect(api.createManualBalance).toHaveBeenCalledWith({ name: "Конверт", amount: 300_000, currency: "UAH", counts_as_own: false }));
    await waitFor(() => expect(api.today.mock.calls.length).toBeGreaterThan(1));
  });

  it("with nothing set aside «Отложено» stays one row, with no total, and still adds an account", async () => {
    await renderWith(<Plan />, fakeApi(newer([])));
    const row = await screen.findByRole("button", { name: "Отложено" });
    expect(row.props.accessibilityHint).toBe("не входит в свои деньги");
    await openAside();
    expect(screen.getByRole("button", { name: "Добавить счёт" })).toBeTruthy();
  });

  it("shows a switched-off Binance once, in «Отложено», opening its own window", async () => {
    const binance: OwnMoneyItemDto = { kind: "binance", name: "Binance", own: 579_900, currency: "USD", amount: 12_600, id: 7, source: "manual", countsAsOwn: false };
    await renderWith(<Plan />, fakeApi(newer([binance], items().filter((i) => i.kind !== "binance"))));
    await screen.findByText("Белая карта");
    expect(screen.queryByRole("button", { name: "Binance" })).toBeNull();
    await openAside();
    expect(screen.getByRole("button", { name: "Binance" }).props.accessibilityHint).toBe("$126");
    expect(screen.getAllByRole("button", { name: "Binance" })).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: "Binance" }));
    expect(await screen.findByText("Баланс Binance")).toBeTruthy();
  });

  it("«Карта monobank» at ₴0 in «Отложено» has a chevron and opens its window (Я6)", async () => {
    const card: OwnMoneyItemDto = { kind: "other", name: "Карта monobank", own: 0, id: 12, source: "account", countsAsOwn: false };
    await renderWith(<Plan />, fakeApi(newer([card])));
    await openAside();
    const row = screen.getByRole("button", { name: "Карта monobank" });
    expect(within(row).getByTestId("row-chevron")).toBeTruthy();
    await fireEvent.press(row);
    expect(await screen.findByText("приходит из monobank")).toBeTruthy();
  });

  it("a place has a chevron exactly when its row opens something (Я6)", async () => {
    await renderWith(<Plan />, fakeApi(newer()));
    await openAside();
    for (const row of screen.getAllByTestId("plan-row")) {
      const opens = row.props.accessibilityRole === "button";
      expect(within(row).queryAllByTestId("row-chevron")).toHaveLength(opens ? 1 : 0);
    }
  });

  it("an older server's card opens nothing and has no chevron (Я6)", async () => {
    await renderWith(<Plan />, fakeApi({ today: jest.fn(async () => todayWithItems()) }));
    await screen.findByText("Белая карта");
    const rows = screen.getAllByTestId("plan-row").filter((r) => within(r).queryByText("Белая карта"));
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).queryByTestId("row-chevron")).toBeNull();
  });

  it("an older server's cards open nothing, and «Отложено» lists the set-aside balances as before", async () => {
    await renderWith(<Plan />, fakeApi({ manualBalances: jest.fn(async () => [balanceFixture()]), today: jest.fn(async () => todayWithItems()) }));
    expect(await screen.findByText("Белая карта")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Белая карта" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Чёрная карта" })).toBeNull();
    await fireEvent.press(await screen.findByRole("button", { name: "Отложено" }));
    expect(await screen.findByRole("button", { name: "Добавить в отложенное" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Добавить счёт" })).toBeNull();
    // Its places at zero stay in «Счета»: nothing here says they come back there.
    expect(screen.queryByText("Сейчас пусто")).toBeNull();
    expect(screen.queryByText(/^Пустые счета/)).toBeNull();
  });
});

describe("Plan, money", () => {
  it("shows own money in the figure and the credit money as a row, when an older server sends no places", async () => {
    await renderWith(<Plan />, fakeApi());
    expect(screen.getByText("План")).toBeTruthy();
    expect(await screen.findByText("₴10,325")).toBeTruthy();
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

  it("shows what is open now, the open and repaid loans, and servicing only at the end of the history (ЯМ4)", async () => {
    await open(fakeApi({ loanHistory: jest.fn(async () => history()) }));
    expect(await screen.findByText("Открыто сейчас")).toBeTruthy();
    expect(screen.getByText("₴5,000")).toBeTruthy();
    for (const t of ["Взято", "Возвращено", "На обслуживание", "₴20,000", "₴15,000"]) expect(screen.queryByText(t)).toBeNull();
    expect(screen.queryByText(/На обслуживание ушло/)).toBeNull();
    expect(screen.getByText("Открытые")).toBeTruthy();
    expect(screen.getByText("Друг")).toBeTruthy();
    expect(screen.getByText("До начала учёта")).toBeTruthy();
    // Repaid loans wait folded under a count (Б57).
    expect(screen.queryByText("Кредит До завтра")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Погашенные, 1" }));
    expect(screen.getByText("Погашенные")).toBeTruthy();
    expect(screen.getByText("₴5,000 от 10 окт, погашен 20 окт, ещё ₴200 на обслуживание")).toBeTruthy();
    expect(screen.getByText("На обслуживание ушло ₴1,200 за всё время.")).toBeTruthy();
  });

  it("counts the open loans, the old ones included, on the right of «Займы»", async () => {
    await renderWith(<Plan />, fakeApi({ loanHistory: jest.fn(async () => history()) }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Займы" }).props.accessibilityHint).toBe("2"));
  });

  it("only a loan entered by hand can be deleted; only an unpaid one can be repaid", async () => {
    await open(fakeApi({ loanHistory: jest.fn(async () => history()) }));
    await screen.findByText("Открыто сейчас");
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
    await fireEvent.press(await screen.findByRole("button", { name: "Погашенные, 1" }));
    expect(await screen.findByText("₴5,000 от 1 ноя, погашен, дата неизвестна")).toBeTruthy();
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

  it("the list offers a retry when the history does not load, and says when there are no loans", async () => {
    const loanHistory = jest.fn(async (): Promise<ReturnType<typeof history>> => {
      throw new NetworkError();
    });
    await renderWith(<LoansSheet onClose={noop} />, fakeApi({ loanHistory }));
    loanHistory.mockImplementation(async () => loanHistoryFixture());
    await fireEvent.press(await screen.findByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Займов пока нет.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Новый займ" })).toBeTruthy();
  });
});

describe("Plan, settings", () => {
  it("opens settings from the gear in the corner and closes them", async () => {
    await renderWith(<Plan />, fakeApi());
    expect(screen.queryByText("Сколько тратить в месяц")).toBeNull();
    await fireEvent.press(await screen.findByRole("button", { name: "Настройки" }));
    expect(await screen.findByText("Сколько тратить в месяц")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Закрыть" }));
    await waitFor(() => expect(screen.queryByText("Сколько тратить в месяц")).toBeNull());
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
    await fireEvent.changeText(screen.getByLabelText("Название"), "Основная работа");
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "100 000");
    await fireEvent.changeText(screen.getByLabelText("С какого числа"), "20");
    await fireEvent.changeText(screen.getByLabelText("По какое число"), "25");
    await press("Сохранить доход");
    await waitFor(() =>
      expect(api.createExpectedIncome).toHaveBeenCalledWith({
        name: "Основная работа", amount: 10_000_000, currency: "UAH", schedule: "monthly", window_start_day: 20, window_end_day: 25, second_day: null,
        pays_fop_tax: false, crypto: false, account: null,
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Сумма")).toBeNull());
  });

  it("refuses days that do not make a window", async () => {
    const api = fakeApi();
    await renderWith(<Plan />, api);
    await press("Доходы");
    await press("Новый доход");
    await fireEvent.changeText(screen.getByLabelText("Название"), "Основная работа");
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "100");
    await fireEvent.changeText(screen.getByLabelText("С какого числа"), "25");
    await fireEvent.changeText(screen.getByLabelText("По какое число"), "20");
    await press("Сохранить доход");
    expect(await screen.findByText("Проверьте название, сумму и числа.")).toBeTruthy();
    expect(api.createExpectedIncome).not.toHaveBeenCalled();
  });

  it("changes the amount, in the income's own currency, and moves the next date", async () => {
    const api = fakeApi(withIncome());
    await renderWith(<Plan />, api);
    await press("Доходы");
    expect(await screen.findByText("$800 · 1–5 числа")).toBeTruthy();
    expect(screen.queryByText(/Следующий —/)).toBeNull();
    await press("USDC");
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
    await press("USDC");
    await press("Сохранить доход");
    await waitFor(() => expect(api.patchExpectedIncome).toHaveBeenCalled());
    expect(api.setIncomeDate).not.toHaveBeenCalled();
  });

  it("deletes only after asking", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
    const api = fakeApi(withIncome());
    await renderWith(<Plan />, api);
    await press("Доходы");
    await press("USDC");
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
    expect(screen.getByText("₴500, срок 10 дек")).toBeTruthy();
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
    await fireEvent.press(screen.getByRole("button", { name: "$" }));
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

  it("has no «Изменить / Удалить» under the rows: a row is a button with a chevron that opens its form (ЯМ5)", async () => {
    await renderWith(<Plan />, fakeApi(withBoth()));
    await press("Платежи");
    const row = await screen.findByRole("button", { name: "Изменить: Квартира" });
    expect(row.props.accessibilityHint).toBe("₴17,000, каждый месяц, 26 числа");
    expect(within(row).getByTestId("row-chevron")).toBeTruthy();
    expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(tokens.touchMin);
    expect(screen.queryByText("Изменить")).toBeNull();
    expect(screen.queryByText("Удалить")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Удалить/ })).toBeNull();
    await fireEvent.press(row);
    expect((await screen.findByLabelText("Название")).props.value).toBe("Квартира");
    expect(screen.getByRole("button", { name: "Сохранить платёж" })).toBeTruthy();
  });

  it("deletes each by its own kind from its form, quietly, after the same question", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
    const api = fakeApi(withBoth());
    await renderWith(<Plan />, api);
    await press("Платежи");
    await press("Изменить: Квартира");
    const remove = await screen.findByRole("button", { name: "Удалить платёж" });
    // Quiet grey, as in Я6: red is only for going over the limit and for errors.
    expect(StyleSheet.flatten(within(remove).getByText("Удалить платёж").props.style).color).toBe(tokens.color.fg.muted);
    await fireEvent.press(remove);
    expect(alert.mock.calls[0]![0]).toBe("Удалить: Квартира?");
    expect(alert.mock.calls[0]![1]).toBe("Неоплаченные платежи исчезнут из плана, оплаченные останутся.");
    expect(alert.mock.calls[0]![2]!.map((b) => b.text)).toEqual(["Оставить", "Удалить"]);
    expect(api.deleteRecurring).not.toHaveBeenCalled();
    await act(async () => alert.mock.calls[0]![2]!.find((b) => b.style === "destructive")!.onPress!());
    await waitFor(() => expect(api.deleteRecurring).toHaveBeenCalledWith(3));
    await waitFor(() => expect(screen.queryByLabelText("Какого числа")).toBeNull());
    await press("Изменить: Страховка");
    await press("Удалить платёж");
    expect(alert.mock.calls[1]![0]).toBe("Удалить: Страховка?");
    expect(alert.mock.calls[1]![1]).toBe("Платёж исчезнет из плана.");
    await act(async () => alert.mock.calls[1]![2]!.find((b) => b.style === "destructive")!.onPress!());
    await waitFor(() => expect(api.deletePayment).toHaveBeenCalledWith(11));
    alert.mockRestore();
  });

  it("offers no «Удалить платёж» in the form of a new payment", async () => {
    await renderWith(<Plan />, fakeApi());
    await press("Платежи");
    await press("Новый платёж");
    await screen.findByLabelText("Название");
    expect(screen.queryByRole("button", { name: "Удалить платёж" })).toBeNull();
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
    expect(await screen.findByText("₴2,000 в месяц, осталось платежей: 2, следующий 2 ноя")).toBeTruthy();
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
    await waitFor(() => expect(screen.queryByLabelText("Платёж в месяц")).toBeNull());
    expect(screen.queryByRole("button", { name: /^Удалить/ })).toBeNull();
    const row = screen.getByRole("button", { name: "Изменить: Телефон" });
    expect(within(row).getByTestId("row-chevron")).toBeTruthy();
    await fireEvent.press(row);
    const remove = await screen.findByRole("button", { name: "Удалить рассрочку" });
    expect(StyleSheet.flatten(within(remove).getByText("Удалить рассрочку").props.style).color).toBe(tokens.color.fg.muted);
    await fireEvent.press(remove);
    expect(alert.mock.calls[0]![0]).toBe("Удалить: Телефон?");
    expect(alert.mock.calls[0]![1]).toBe("Оставшиеся платежи исчезнут из плана, оплаченные останутся.");
    await act(async () => alert.mock.calls[0]![2]!.find((b) => b.style === "destructive")!.onPress!());
    await waitFor(() => expect(api.deleteInstallment).toHaveBeenCalledWith("Телефон"));
    await waitFor(() => expect(screen.queryByLabelText("Платёж в месяц")).toBeNull());
    alert.mockRestore();
  });
});

describe("Plan, calendar", () => {
  it("does not offer days outside the allowed range", async () => {
    const today = kyivDate();
    const api = fakeApi(withOpenLoan());
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
    await fireEvent.press(await screen.findByRole("button", { name: "Изменить: Подушка" }));
    await fireEvent.changeText(screen.getByLabelText("Накоплено, $"), "0");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить цель" }));
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
    await fireEvent.press(await screen.findByRole("button", { name: "Изменить: Подушка" }));
    await fireEvent.changeText(screen.getByLabelText("Накоплено, $"), "abc");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить цель" }));
    expect(await screen.findByText("Проверьте сумму.")).toBeTruthy();
    expect(patchGoal).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText("Накоплено, $"), "100");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить цель" }));
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(screen.getByLabelText("Накоплено, $")).toBeTruthy();
  });

  it("deletes only after confirmation", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
    const api = fakeApi(withGoal());
    await renderWith(<Plan />, api);
    await press("Цели");
    await fireEvent.press(await screen.findByRole("button", { name: "Изменить: Подушка" }));
    const remove = await screen.findByRole("button", { name: "Удалить цель" });
    expect(StyleSheet.flatten(within(remove).getByText("Удалить цель").props.style).color).toBe(tokens.color.fg.muted);
    await fireEvent.press(remove);
    expect(api.deleteGoal).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]![2] as { text: string; style?: string; onPress?: () => void }[];
    expect(buttons.find((b) => b.style === "cancel")).toBeTruthy();
    buttons.find((b) => b.style === "destructive")!.onPress!();
    await waitFor(() => expect(api.deleteGoal).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByLabelText("Накоплено, $")).toBeNull());
    alert.mockRestore();
  });

  it("has no «Изменить накопленное / Удалить» under a goal: the row opens its form, with the saved amount filled in (ЯМ5)", async () => {
    await renderWith(<Plan />, fakeApi(withGoal()));
    await press("Цели");
    const row = await screen.findByRole("button", { name: "Изменить: Подушка" });
    expect(within(row).getByTestId("row-chevron")).toBeTruthy();
    expect(within(row).getByLabelText("Прогресс: 10%")).toBeTruthy();
    expect(screen.queryByText("Изменить накопленное")).toBeNull();
    expect(screen.queryByText("Удалить")).toBeNull();
    expect(screen.queryByLabelText("Накоплено, $")).toBeNull();
    await fireEvent.press(row);
    expect((await screen.findByLabelText("Накоплено, $")).props.value).toBe("500");
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
    expect(await screen.findByText("$2,700, ₴111,375")).toBeTruthy();
  });

  it("saves a new value, zero included, and refreshes the balance and Today", async () => {
    const api = fakeApi(withBalance());
    const client = makeClient();
    client.setQueryData(TODAY_KEY, todayFixture());
    await renderWith(<Plan />, api, client);
    await press("Binance");
    await screen.findByText(/\$2,700, ₴/);
    await type("2 500,50");
    await waitFor(() => expect(api.patchManualBalance).toHaveBeenCalledWith(7, { amount: 250_050 }));
    expect(await screen.findByText("Баланс сохранён.")).toBeTruthy();
    await waitFor(() => expect(api.manualBalances.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(api.today.mock.calls.length).toBeGreaterThan(1));
    await type("0");
    await waitFor(() => expect(api.patchManualBalance).toHaveBeenLastCalledWith(7, { amount: 0 }));
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
    await screen.findByText(/\$2,700, ₴/);
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

describe("Plan, set aside (an older server)", () => {
  const solana = () => balanceFixture({ id: 9, name: "Solana", amount: 75_000, counts_as_own: false });
  const withSolana = () => ({ manualBalances: jest.fn(async () => [balanceFixture(), solana()]) });
  const openAside = async () => {
    await fireEvent.press(await screen.findByRole("button", { name: "Отложено" }));
    await screen.findByRole("button", { name: "Добавить в отложенное" });
  };

  it("lists money set aside inside «Отложено», in dollars, and keeps Binance in «Счета»", async () => {
    await renderWith(<Plan />, fakeApi(withSolana()));
    await waitFor(() => expect(screen.getByRole("button", { name: "Binance" }).props.accessibilityHint).toBe("$2,700"));
    expect(screen.queryByText("Solana")).toBeNull();
    await openAside();
    expect(screen.getByRole("button", { name: "Solana" }).props.accessibilityHint).toBe("$750");
  });

  it("an amount in another currency is shown in that currency", async () => {
    const deposit = balanceFixture({ id: 10, name: "Депозит", amount: 50_000, currency: "EUR", counts_as_own: false });
    await renderWith(<Plan />, fakeApi({ manualBalances: jest.fn(async () => [solana(), deposit]) }));
    await openAside();
    expect((await screen.findByRole("button", { name: "Депозит" })).props.accessibilityHint).toBe("€500");
  });

  it("with nothing set aside «Отложено» still adds one", async () => {
    const api = fakeApi({ manualBalances: jest.fn(async () => [balanceFixture()]) });
    await renderWith(<Plan />, api);
    await openAside();
    await fireEvent.press(screen.getByRole("button", { name: "Добавить в отложенное" }));
    expect(await screen.findByLabelText("Сколько стоит сейчас, $")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Название"), "Solana");
    await fireEvent.changeText(screen.getByLabelText("Сколько стоит сейчас, $"), "750");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.createManualBalance).toHaveBeenCalledWith({ name: "Solana", amount: 75_000, currency: "USD", counts_as_own: false }));
  });

  it("adds another from «Отложено», and refreshes the balances and Today after", async () => {
    const api = fakeApi(withSolana());
    await renderWith(<Plan />, api);
    await openAside();
    await fireEvent.press(screen.getByRole("button", { name: "Добавить в отложенное" }));
    await fireEvent.changeText(await screen.findByLabelText("Название"), "Депозит");
    await fireEvent.changeText(screen.getByLabelText("Сколько стоит сейчас, $"), "1 000");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.createManualBalance).toHaveBeenCalledWith({ name: "Депозит", amount: 100_000, currency: "USD", counts_as_own: false }));
    await waitFor(() => expect(api.manualBalances.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(api.today.mock.calls.length).toBeGreaterThan(1));
  });

  it("opens one to change its name and price", async () => {
    const api = fakeApi(withSolana());
    await renderWith(<Plan />, api);
    await openAside();
    await fireEvent.press(screen.getByRole("button", { name: "Solana" }));
    expect((await screen.findByLabelText("Название")).props.value).toBe("Solana");
    await fireEvent.changeText(screen.getByLabelText("Сколько стоит сейчас, $"), "820");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.patchManualBalance).toHaveBeenCalledWith(9, { name: "Solana", amount: 82_000 }));
    expect(api.createManualBalance).not.toHaveBeenCalled();
  });
});

describe("Plan, tax payments", () => {
  const payments = () =>
    jest.fn(async () => [
      taxFixture({ id: 1, name: "Налог за 2 кв.", amount: 900_000, due_on: "2026-08-20", paid_at: "2026-08-19T09:00:00.000Z" }),
      taxFixture({ id: 2 }),
      taxFixture({ id: 3, kind: "obligation", name: "Интернет" }),
    ]);

  it("lists tax payments with sum, due date and a paid mark", async () => {
    await renderWith(<Plan />, fakeApi({ payments: payments() }));
    await press("Налоги");
    expect(await screen.findByText("Налог за 3 кв.")).toBeTruthy();
    expect(screen.getByText("₴12,000")).toBeTruthy();
    expect(screen.getByText("срок 20 ноя")).toBeTruthy();
    expect(screen.getByText("Налог за 2 кв.")).toBeTruthy();
    expect(screen.getByText("₴9,000")).toBeTruthy();
    expect(screen.getByText("Оплачен")).toBeTruthy();
    expect(screen.queryByText("Интернет")).toBeNull();
    expect(screen.queryByText("Налогов к оплате нет.")).toBeNull();
  });

  it("says no tax is left to pay when every tax payment is paid (Я5)", async () => {
    const paid = jest.fn(async () => [taxFixture({ id: 1, name: "Налог за 2 кв.", amount: 900_000, due_on: "2026-08-20", paid_at: "2026-08-19T09:00:00.000Z" })]);
    await renderWith(<Plan />, fakeApi({ payments: paid }));
    await press("Налоги");
    expect(await screen.findByText("Налогов к оплате нет.")).toBeTruthy();
    expect(screen.getByText("Оплачен")).toBeTruthy();
  });

  it("says no tax is left to pay when there are no tax payments at all (Я5)", async () => {
    await renderWith(<Plan />, fakeApi({ payments: jest.fn(async () => []) }));
    await press("Налоги");
    expect(await screen.findByText("Налогов к оплате нет.")).toBeTruthy();
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
  it("creates a loan and Today is counted again, without a loan row there", async () => {
    const badCase = { id: "loan:1", text: "Взят займ ₴5,000 (02.11): столько не хватало." };
    let created = false;
    const api = fakeApi({
      ...withOpenLoan(),
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
    const before = api.today.mock.calls.length;
    await fireEvent.press(screen.getByRole("button", { name: "Добавить займ" }));
    await waitFor(() => expect(api.createLoan).toHaveBeenCalledWith({ amount: 500_000, received_on: day, note: "до зарплаты" }));
    await waitFor(() => expect(api.today.mock.calls.length).toBeGreaterThan(before));
    expect(screen.queryByText(badCase.text)).toBeNull();
    await waitFor(() => expect(screen.queryByLabelText("Сумма займа")).toBeNull());
  });

  it("rejects a bad amount or date before sending, and reports a failed save", async () => {
    const createLoan = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(<Plan />, fakeApi({ ...withOpenLoan(), createLoan }));
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

