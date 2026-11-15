import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { CalendarDto, GoalDto, LoanHistoryDto, LoanRowDto, ManualBalanceDto, OwnMoneyItemDto, ScheduledPaymentDto, SettingsDto, TodayDto, TransactionDto } from "@hale/contracts";
import { ApiProvider } from "./api/context";
import type { Api } from "./api/client";
import { dateLabel, kyivDate } from "./format";

/** Anonymised normal-mode response: ₴10,325 own money, a ₴30,000 credit limit, rent in four days. */
export function todayFixture(over: Partial<TodayDto> = {}): TodayDto {
  return {
    date: "2026-11-02",
    state: {
      mode: "normal",
      daysLeft: 18,
      free: 1800000,
      dailyLimit: 100000,
      leftToday: 72000,
      level: 0.72,
      needsIncomeDate: false,
      bridge: null,
    },
    usdRate: 41.25,
    rateStale: false,
    accounts: { own: 1032500, credit: 3000000, fop: 0, binance: 0, cash: 0 },
    upcoming: [{ id: "1", name: "Квартплата", amount: 1700000, dueOn: "2026-11-06", kind: "obligation", currency: "UAH" }],
    questions: [],
    badCases: [],
    runOutOn: null,
    syncedAt: new Date(2026, 10, 2, 9, 5).toISOString(),
    syncStale: false,
    limitVisual: "mercury",
    goals: [],
    streak: 0,
    runway: {
      endOn: "2026-11-07",
      incomeOn: "2026-11-07",
      reserve: 1328000,
      zeroOn: null,
      points: [
        { date: "2026-11-02", balance: 3500000 },
        { date: "2026-11-03", balance: 3428000 },
        { date: "2026-11-04", balance: 3328000 },
        { date: "2026-11-05", balance: 3228000 },
        { date: "2026-11-06", balance: 3128000 },
        { date: "2026-11-07", balance: 1328000 },
      ],
      events: [{ id: "1", date: "2026-11-06", name: "Квартплата", amount: 1700000 }],
    },
    ...over,
  };
}

export function goalFixture(over: Partial<GoalDto> = {}): GoalDto {
  return { id: 1, name: "Подушка", target_cents: 500_000, saved_cents: 50_000, sort: 0, ...over };
}

/** Anonymised card purchase in hryvnias. */
export function txFixture(over: Partial<TransactionDto> = {}): TransactionDto {
  return {
    id: 1,
    occurredAt: "2026-11-02T08:30:00.000Z",
    localDate: "2026-11-02",
    description: "Кофейня",
    amount: -8500,
    amountUah: -8500,
    fxRate: null,
    currency: "UAH",
    type: "spend",
    category: "cafe",
    hold: false,
    needsLabel: false,
    recipientLabel: null,
    counterKey: "0123456789abcdef",
    counterName: null,
    accountKind: "black",
    manual: false,
    cashOut: null,
    paymentName: null,
    ...over,
  };
}

export function settingsFixture(over: Partial<SettingsDto> = {}): SettingsDto {
  return { lifestyle_cap: 10_000_000, food_floor: 45_000, tax_rate_bp: 600, esv_quarter: 0, limit_visual: "mercury", ...over };
}

export function taxFixture(over: Partial<ScheduledPaymentDto> = {}): ScheduledPaymentDto {
  return { id: 1, kind: "tax", name: "Налог за 3 кв.", amount: 1_200_000, currency: "UAH", due_on: "2026-11-20", paid_at: null, recurring_id: null, tax_quarter: "2026-Q3", is_estimate: false, ...over };
}

/**
 * Own money place by place, as a newer server sends it (task Б25): the white card, the wallet, Binance
 * and the black card with its whole credit limit spent. They add up to ₴20,362.
 */
export function ownItemsFixture(): OwnMoneyItemDto[] {
  return [
    { kind: "black", name: "Чёрная карта", own: -3_000_000, creditLimit: 3_000_000 },
    { kind: "white", name: "Белая карта", own: 1_431_300 },
    { kind: "cash", name: "Наличные", own: 3_025_000 },
    { kind: "binance", name: "Binance", own: 579_900, currency: "USD", amount: 12_600 },
  ];
}

/** A Today response whose money comes with its places; `own` is their sum, as the server makes it. */
export function todayWithItems(items: OwnMoneyItemDto[] = ownItemsFixture()): TodayDto {
  const own = items.reduce((s, i) => s + i.own, 0);
  return todayFixture({ accounts: { own, credit: 3_000_000, fop: 0, binance: 0, cash: 0, items } });
}

export function balanceFixture(over: Partial<ManualBalanceDto> = {}): ManualBalanceDto {
  return { id: 7, name: "Binance", amount: 270_000, currency: "USD", counts_as_own: true, ...over };
}

export function calendarFixture(over: Partial<CalendarDto> = {}): CalendarDto {
  return { month: "2026-11", today: "2026-11-05", streak: 0, days: [], ...over };
}

export function loanFixture(over: Partial<LoanRowDto> = {}): LoanRowDto {
  return { id: 7, amount: 500_000, remaining: 500_000, receivedOn: "2026-11-01", repaidOn: null, repaidDateKnown: true, repaidAmount: 0, serviceCost: 0, title: "Друг", manual: true, ...over };
}

export function loanHistoryFixture(over: Partial<LoanHistoryDto> = {}): LoanHistoryDto {
  return { stats: { borrowed: 0, repaid: 0, serviceCost: 0, stillOpen: 0 }, open: [], old: [], repaid: [], ...over };
}

/** Opens a date field's calendar and picks the date, walking to its month. */
export async function pickDate(field: string, iso: string): Promise<void> {
  await fireEvent.press(screen.getByRole("button", { name: new RegExp(`^${field}:`) }));
  const step = iso < kyivDate() ? "Предыдущий месяц" : "Следующий месяц";
  for (let i = 0; i < 48 && !screen.queryByRole("button", { name: dateLabel(iso) }); i++) {
    await fireEvent.press(screen.getByRole("button", { name: step }));
  }
  await fireEvent.press(screen.getByRole("button", { name: dateLabel(iso) }));
}

export function fakeApi(over: Partial<Api> = {}): { [K in keyof Api]: jest.Mock } {
  return {
    login: jest.fn(async () => "token"),
    today: jest.fn(async () => todayFixture()),
    previewBridge: jest.fn(async (dailyAmount: number) => ({ dailyAmount, creditNeeded: 0, shortfall: 0 })),
    chooseBridge: jest.fn(async () => todayFixture()),
    cancelBridge: jest.fn(async () => todayFixture()),
    confirmIncome: jest.fn(async () => undefined),
    setIncomeDate: jest.fn(async () => undefined),
    matchUsdc: jest.fn(async () => undefined),
    dismissUsdcMatch: jest.fn(async () => undefined),
    manualBalances: jest.fn(async () => []),
    createManualBalance: jest.fn(async () => balanceFixture()),
    patchManualBalance: jest.fn(async () => balanceFixture()),
    deleteManualBalance: jest.fn(async () => undefined),
    transactions: jest.fn(async () => ({ items: [txFixture()], nextCursor: null, dayTotals: { "2026-11-02": -8500 } })),
    editTransaction: jest.fn(async () => ({ transaction: txFixture(), updated: 1 })),
    labelRecipient: jest.fn(async () => ({ updated: 1 })),
    recipient: jest.fn(async () => ({ name: "Иван", count: 5, total: 100_000, lastOn: "2026-11-02", label: null })),
    settings: jest.fn(async () => settingsFixture()),
    patchSettings: jest.fn(async () => settingsFixture()),
    previewSettings: jest.fn(async () => ({ dailyLimit: 90000, leftForGoalsMonthly: 1500000, rateStale: false })),
    payments: jest.fn(async () => []),
    createPayment: jest.fn(async () => taxFixture()),
    markPaid: jest.fn(async () => undefined),
    createLoan: jest.fn(async () => undefined),
    deleteLoan: jest.fn(async () => undefined),
    repayLoan: jest.fn(async () => undefined),
    loanHistory: jest.fn(async () => loanHistoryFixture()),
    repayOldLoans: jest.fn(async () => undefined),
    calendar: jest.fn(async (month: string) => calendarFixture({ month })),
    expectedIncomes: jest.fn(async () => []),
    createExpectedIncome: jest.fn(async () => undefined),
    patchExpectedIncome: jest.fn(async () => undefined),
    deleteExpectedIncome: jest.fn(async () => undefined),
    incomeEvents: jest.fn(async () => []),
    recurring: jest.fn(async () => []),
    createRecurring: jest.fn(async () => undefined),
    patchRecurring: jest.fn(async () => undefined),
    deleteRecurring: jest.fn(async () => undefined),
    patchPayment: jest.fn(async () => undefined),
    deletePayment: jest.fn(async () => undefined),
    createInstallment: jest.fn(async () => undefined),
    patchInstallment: jest.fn(async () => undefined),
    deleteInstallment: jest.fn(async () => undefined),
    registerPushToken: jest.fn(async () => undefined),
    goals: jest.fn(async () => []),
    createGoal: jest.fn(async () => goalFixture()),
    patchGoal: jest.fn(async () => goalFixture()),
    deleteGoal: jest.fn(async () => undefined),
    cash: jest.fn(async () => ({ started: false, start: null, balance: 0 })),
    startCash: jest.fn(async () => ({ started: true, start: kyivDate(), balance: 0 })),
    addCashOperation: jest.fn(async () => txFixture({ manual: true, accountKind: "cash" })),
    patchCashOperation: jest.fn(async () => txFixture({ manual: true, accountKind: "cash" })),
    deleteCashOperation: jest.fn(async () => undefined),
    countCash: jest.fn(async () => ({ started: true, start: kyivDate(), balance: 0 })),
    depositFromWallet: jest.fn(async () => undefined),
    payFromWallet: jest.fn(async () => ({ started: true, start: kyivDate(), balance: 0 })),
    paymentCandidates: jest.fn(async () => []),
    payWith: jest.fn(async () => undefined),
    dismissPaymentMatch: jest.fn(async () => undefined),
    answerCashCard: jest.fn(async () => ({ started: true, start: kyivDate(), balance: 0 })),
    setCardCash: jest.fn(async () => ({ started: true, start: kyivDate(), balance: 0 })),
    similarCount: jest.fn(async () => 1),
    rules: jest.fn(async () => []),
    deleteRule: jest.fn(async () => undefined),
    ...over,
  } as never;
}

export function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
}

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

export async function renderWith(ui: ReactElement, api: Api, client: QueryClient = makeClient()) {
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <ApiProvider api={api}>{ui}</ApiProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  return { ...view, client };
}

/** Opens a part of Plan by its row, unfolding "Ещё" first when an empty part is folded away there. */
export async function openPlanPart(name: string | RegExp): Promise<void> {
  // Wait until the row has its data (a loading row has no detail yet) or has been folded into "Ещё".
  const folded = () =>
    typeof name === "string" &&
    screen.queryAllByRole("button", { name: /^Ещё/ }).some((b) => String(b.props.accessibilityLabel).toLowerCase().includes(name.toLowerCase()));
  // A part that fails to load never gets a detail: then go on with the row as it is.
  await waitFor(
    () => {
      const row = screen.queryByRole("button", { name });
      if (!(row && row.props.accessibilityHint !== undefined) && !folded()) throw new Error(`no ${String(name)} yet`);
    },
    { timeout: 700 },
  ).catch(() => undefined);
  if (!screen.queryByRole("button", { name }) && typeof name === "string") {
    const more = screen.queryAllByRole("button", { name: /^Ещё/ }).find((b) => String(b.props.accessibilityLabel).toLowerCase().includes(name.toLowerCase()));
    if (more) await fireEvent.press(more);
  }
  await fireEvent.press(await screen.findByRole("button", { name }));
}
