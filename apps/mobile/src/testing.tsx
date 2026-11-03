import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { render } from "@testing-library/react-native";
import type { ManualBalanceDto, ScheduledPaymentDto, SettingsDto, TodayDto, TransactionDto } from "@hale/contracts";
import { ApiProvider } from "./api/context";
import type { Api } from "./api/client";

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
    accounts: { own: 1032500, credit: 3000000, fop: 0, binance: 0 },
    upcoming: [{ id: "1", name: "Квартплата", amount: 1700000, dueOn: "2026-11-06", kind: "obligation" }],
    questions: [],
    badCases: [],
    runOutOn: null,
    syncedAt: new Date(2026, 10, 2, 9, 5).toISOString(),
    syncStale: false,
    limitVisual: "mercury",
    ...over,
  };
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
    counterKey: "0123456789abcdef",
    counterName: null,
    accountKind: "black",
    ...over,
  };
}

export function settingsFixture(over: Partial<SettingsDto> = {}): SettingsDto {
  return { lifestyle_cap: 10_000_000, food_floor: 45_000, tax_rate_bp: 600, esv_quarter: 0, limit_visual: "mercury", ...over };
}

export function taxFixture(over: Partial<ScheduledPaymentDto> = {}): ScheduledPaymentDto {
  return { id: 1, kind: "tax", name: "Налог за 3 кв.", amount: 1_200_000, currency: "UAH", due_on: "2026-11-20", paid_at: null, tax_quarter: "2026-Q3", is_estimate: false, ...over };
}

export function balanceFixture(over: Partial<ManualBalanceDto> = {}): ManualBalanceDto {
  return { id: 7, name: "Binance", amount: 270_000, currency: "USD", counts_as_own: true, ...over };
}

export function fakeApi(over: Partial<Api> = {}): { [K in keyof Api]: jest.Mock } {
  return {
    login: jest.fn(async () => "token"),
    today: jest.fn(async () => todayFixture()),
    previewBridge: jest.fn(async (dailyAmount: number) => ({ dailyAmount, creditNeeded: 0, shortfall: 0 })),
    chooseBridge: jest.fn(async () => todayFixture()),
    confirmIncome: jest.fn(async () => undefined),
    setIncomeDate: jest.fn(async () => undefined),
    matchUsdc: jest.fn(async () => undefined),
    dismissUsdcMatch: jest.fn(async () => undefined),
    manualBalances: jest.fn(async () => []),
    createManualBalance: jest.fn(async () => balanceFixture()),
    patchManualBalance: jest.fn(async () => balanceFixture()),
    transactions: jest.fn(async () => ({ items: [txFixture()], nextCursor: null })),
    editTransaction: jest.fn(async () => ({ transaction: txFixture(), updated: 1 })),
    labelRecipient: jest.fn(async () => ({ updated: 1 })),
    settings: jest.fn(async () => settingsFixture()),
    patchSettings: jest.fn(async () => settingsFixture()),
    previewSettings: jest.fn(async () => ({ dailyLimit: 90000, leftForGoalsMonthly: 1500000, rateStale: false })),
    payments: jest.fn(async () => []),
    createPayment: jest.fn(async () => taxFixture()),
    markPaid: jest.fn(async () => undefined),
    createLoan: jest.fn(async () => undefined),
    registerPushToken: jest.fn(async () => undefined),
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
