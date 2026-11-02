import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { render } from "@testing-library/react-native";
import type { TodayDto } from "@tablo/contracts";
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

export function fakeApi(over: Partial<Api> = {}): { [K in keyof Api]: jest.Mock } {
  return {
    login: jest.fn(async () => "token"),
    today: jest.fn(async () => todayFixture()),
    previewBridge: jest.fn(async (dailyAmount: number) => ({ dailyAmount, creditNeeded: 0, shortfall: 0 })),
    chooseBridge: jest.fn(async () => todayFixture()),
    confirmIncome: jest.fn(async () => undefined),
    setIncomeDate: jest.fn(async () => undefined),
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
