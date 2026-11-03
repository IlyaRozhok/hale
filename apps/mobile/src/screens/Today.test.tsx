import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import type { BridgeStateDto, DailyStateDto } from "@hale/contracts";
import { Today } from "./Today";
import { fakeApi, makeClient, renderWith, todayFixture } from "../testing";
import { NetworkError } from "../api/client";

jest.mock("../metal", () => {
  const { View } = require("react-native");
  return { LimitVisual: ({ mode, level }: { mode: string; level: number }) => <View testID="limit-visual" accessibilityHint={`${mode}:${level}`} /> };
});
jest.mock("@react-native-community/slider", () => {
  const React = require("react");
  return { __esModule: true, default: (props: object) => React.createElement("Slider", props) };
});

const noop = () => undefined;
const bridgeState = (bridge: Partial<BridgeStateDto> = {}): DailyStateDto => ({
  mode: "bridge",
  daysLeft: 18,
  free: -1197000,
  dailyLimit: 45000,
  leftToday: 45000,
  level: 1,
  needsIncomeDate: false,
  bridge: { creditNeeded: 2007000, recommendedDaily: 45000, maxDailyWithinCredit: 56000, shortfall: 0, overPlan: false, confirmed: false, ...bridge },
});
const HIDDEN = { includeHiddenElements: true };
const levelOf = () => screen.getByTestId("limit-visual", HIDDEN).props.accessibilityHint as string;

describe("Today, normal mode", () => {
  it("shows the limit, accounts and upcoming payments, USD alongside", async () => {
    await renderWith(<Today onOpenActivity={noop} />, fakeApi());
    expect(await screen.findByText("Сегодня можно")).toBeTruthy();
    expect(screen.getByText("₴720")).toBeTruthy();
    expect(screen.getByText("из ₴1,000 на день")).toBeTruthy();
    expect(screen.getByText("Свои")).toBeTruthy();
    expect(screen.getByText("₴10,325")).toBeTruthy();
    expect(screen.getByText("$250")).toBeTruthy();
    expect(screen.getByText("Квартплата")).toBeTruthy();
    expect(screen.getByText("через 4 дня")).toBeTruthy();
    expect(screen.getByText("₴17,000")).toBeTruthy();
    expect(levelOf()).toBe("mercury:0.72");
  });

  it("labels credit money separately and does not add it to own money", async () => {
    await renderWith(<Today onOpenActivity={noop} />, fakeApi());
    await screen.findByText("Кредитные");
    expect(screen.getByText("₴30,000")).toBeTruthy();
    expect(screen.queryByText("₴40,325")).toBeNull();
  });

  it("shows a negative remainder calmly, with the metal at zero", async () => {
    const state = { ...todayFixture().state, leftToday: -12000, level: 0 };
    await renderWith(<Today onOpenActivity={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ state })) }));
    const amount = await screen.findByText("−₴120");
    expect(StyleSheet.flatten(amount.props.style).color).toBe(tokens.color.fg.default);
    expect(levelOf()).toBe("mercury:0");
    expect(screen.queryByText(/превыш|перерасход|красн/i)).toBeNull();
  });

  it("always shows mercury, even if the server still has the ring saved", async () => {
    await renderWith(<Today onOpenActivity={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ limitVisual: "ring" })) }));
    await screen.findByText("Сегодня можно");
    expect(levelOf()).toBe("mercury:0.72");
  });

  it("shows calm bad-case cards", async () => {
    const badCases = [{ id: "loan:1", text: "Взят займ ₴5,000 (01.11): столько не хватало." }];
    await renderWith(<Today onOpenActivity={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ badCases })) }));
    expect(await screen.findByText(badCases[0]!.text)).toBeTruthy();
  });

  it("makes every button at least the minimum touch size", async () => {
    const questions = [
      { id: "usdc_arrived:12", kind: "usdc_arrived" as const, text: "Пришло на Binance?" },
      { id: "usdc_match:12:34", kind: "usdc_match" as const, text: "Это вывод с Binance?" },
      { id: "income_date:5", kind: "income_date" as const, text: "Когда ожидается следующий доход?" },
      { id: "recipient_label:0123456789abcdef", kind: "recipient_label" as const, text: "Кто это: Иван?" },
    ];
    await renderWith(<Today onOpenActivity={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ questions })) }));
    await screen.findByText("Пришло на Binance?");
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(3);
    for (const b of buttons) {
      expect(StyleSheet.flatten(b.props.style).minHeight).toBeGreaterThanOrEqual(tokens.touchMin);
    }
  });
});

describe("Today, questions", () => {
  it("a USDC arrival is confirmed with one tap and the card goes away", async () => {
    const questions = [{ id: "usdc_arrived:12", kind: "usdc_arrived" as const, text: "Пришло на Binance?" }];
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ questions })) });
    await renderWith(<Today onOpenActivity={noop} />, api);
    await fireEvent.press(await screen.findByText("Да, пришло"));
    await waitFor(() => expect(api.confirmIncome).toHaveBeenCalledWith(12));
    await waitFor(() => expect(screen.queryByText("Пришло на Binance?")).toBeNull());
  });

  it("an income date is set with one tap on a quick choice", async () => {
    const questions = [{ id: "income_date:5", kind: "income_date" as const, text: "Когда ожидается следующий доход?" }];
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ questions })) });
    await renderWith(<Today onOpenActivity={noop} />, api);
    await fireEvent.press(await screen.findByText("Через неделю"));
    await waitFor(() => expect(api.setIncomeDate).toHaveBeenCalledWith(5, "2026-11-09"));
    await waitFor(() => expect(screen.queryByText("Когда ожидается следующий доход?")).toBeNull());
  });

  const USDC_MATCH = { id: "usdc_match:12:34", kind: "usdc_match" as const, text: "Пришло ₴120 000 (05.11). Это вывод с Binance?" };

  it("a credit from Binance is matched with one tap against the event and the row, and the card goes away", async () => {
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ questions: [USDC_MATCH] })) });
    await renderWith(<Today onOpenActivity={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Да, вывод с Binance" }));
    await waitFor(() => expect(api.matchUsdc).toHaveBeenCalledWith(12, 34));
    expect(api.dismissUsdcMatch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(USDC_MATCH.text)).toBeNull());
  });

  it("answering no marks the row, not the balance", async () => {
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ questions: [USDC_MATCH] })) });
    await renderWith(<Today onOpenActivity={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Нет" }));
    await waitFor(() => expect(api.dismissUsdcMatch).toHaveBeenCalledWith(34));
    expect(api.matchUsdc).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(USDC_MATCH.text)).toBeNull());
  });

  it("refreshes Today after a match and brings the card back if the match fails", async () => {
    const today = jest.fn(async () => todayFixture({ questions: [USDC_MATCH] }));
    const ok = fakeApi({ today });
    const first = await renderWith(<Today onOpenActivity={noop} />, ok);
    await fireEvent.press(await screen.findByRole("button", { name: "Да, вывод с Binance" }));
    await waitFor(() => expect(today).toHaveBeenCalledTimes(2));
    await first.unmount();

    const failing = fakeApi({
      today: jest.fn(async () => todayFixture({ questions: [USDC_MATCH] })),
      matchUsdc: jest.fn(async () => {
        throw new NetworkError();
      }),
    });
    await renderWith(<Today onOpenActivity={noop} />, failing);
    await fireEvent.press(await screen.findByRole("button", { name: "Да, вывод с Binance" }));
    await waitFor(() => expect(failing.matchUsdc).toHaveBeenCalled());
    expect(await screen.findByText(USDC_MATCH.text)).toBeTruthy();
  });

  it("with no income event there is no route to Activity: a hint about the settings instead", async () => {
    const questions = [{ id: "income_date", kind: "income_date" as const, text: "Когда ожидается следующий доход?" }];
    const onOpenActivity = jest.fn();
    await renderWith(<Today onOpenActivity={onOpenActivity} />, fakeApi({ today: jest.fn(async () => todayFixture({ questions })) }));
    expect(await screen.findByText(/задаётся в настройках плана/)).toBeTruthy();
    await fireEvent.press(screen.getByText("Когда ожидается следующий доход?"));
    expect(onOpenActivity).not.toHaveBeenCalled();
    expect(screen.queryByText("Через неделю")).toBeNull();
    expect(screen.queryByRole("button", { name: /доход/ })).toBeNull();
  });

  it("a recipient question opens the label sheet for that recipient, and the card goes away once answered", async () => {
    const questions = [{ id: "recipient_label:0123456789abcdef", kind: "recipient_label" as const, text: "Кто это: Иван?" }];
    const onOpenActivity = jest.fn();
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ questions })) });
    await renderWith(<Today onOpenActivity={onOpenActivity} />, api);
    await fireEvent.press(await screen.findByText("Кто это: Иван?"));
    expect(await screen.findByText("Кто это?")).toBeTruthy();
    expect(screen.getAllByText("Кто это: Иван?")).toHaveLength(1); // the question is not repeated in the sheet
    expect(screen.getByText("Иван")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Разово" }));
    await waitFor(() => expect(api.labelRecipient).toHaveBeenCalledWith("0123456789abcdef", "one_off"));
    await waitFor(() => expect(screen.queryByText("Кто это: Иван?")).toBeNull());
    expect(onOpenActivity).not.toHaveBeenCalled();
  });

  it("brings the card back if the call fails", async () => {
    const questions = [{ id: "usdc_arrived:12", kind: "usdc_arrived" as const, text: "Пришло на Binance?" }];
    const api = fakeApi({
      today: jest.fn(async () => todayFixture({ questions })),
      confirmIncome: jest.fn(async () => {
        throw new NetworkError();
      }),
    });
    await renderWith(<Today onOpenActivity={noop} />, api);
    await fireEvent.press(await screen.findByText("Да, пришло"));
    await waitFor(() => expect(api.confirmIncome).toHaveBeenCalled());
    expect(await screen.findByText("Пришло на Binance?")).toBeTruthy();
  });
});

describe("Today, bridge", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const bridgeToday = (bridge: Partial<BridgeStateDto> = {}) => jest.fn(async () => todayFixture({ state: bridgeState(bridge) }));
  const tick = async (ms: number) => {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  };

  it("shows the plan and a slider", async () => {
    await renderWith(<Today onOpenActivity={noop} />, fakeApi({ today: bridgeToday() }));
    expect(await screen.findByText(/До зарплаты 18 дн/)).toBeTruthy();
    expect(screen.getByText("₴20,070")).toBeTruthy();
    expect(screen.getByLabelText("Сумма в день")).toBeTruthy();
    expect(screen.getByText("Подтвердить план")).toBeTruthy();
  });

  it("with no limit yet, asks to confirm the plan instead of saying the limit was used", async () => {
    await renderWith(<Today onOpenActivity={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ state: { ...bridgeState(), dailyLimit: 0, leftToday: 0 } })) }));
    expect(await screen.findByText("Лимит появится, когда вы подтвердите план ниже.")).toBeTruthy();
    expect(screen.queryByText(/использован/)).toBeNull();
    expect(screen.queryByText(/на день$/)).toBeNull();
  });

  it("sends one preview 300 ms after the slider stops and shows the new credit needed", async () => {
    const api = fakeApi({
      today: bridgeToday(),
      previewBridge: jest.fn(async (d: number) => ({ dailyAmount: d, creditNeeded: 2800000, shortfall: 0 })),
    });
    await renderWith(<Today onOpenActivity={noop} />, api);
    const slider = await screen.findByLabelText("Сумма в день");
    await fireEvent(slider, "valueChange", 50000);
    await tick(200);
    await fireEvent(slider, "valueChange", 60000);
    await tick(299);
    expect(api.previewBridge).not.toHaveBeenCalled();
    await tick(2);
    expect(api.previewBridge).toHaveBeenCalledTimes(1);
    expect(api.previewBridge).toHaveBeenCalledWith(60000);
    expect(await screen.findByText("₴28,000")).toBeTruthy();
  });

  it("with a shortfall shows how much is missing and no confirm button", async () => {
    const api = fakeApi({
      today: bridgeToday(),
      previewBridge: jest.fn(async (d: number) => ({ dailyAmount: d, creditNeeded: 3791600, shortfall: 791600 })),
    });
    await renderWith(<Today onOpenActivity={noop} />, api);
    await fireEvent(await screen.findByLabelText("Сумма в день"), "valueChange", 100000);
    await tick(310);
    expect(await screen.findByText(/Не хватает ₴7,916/)).toBeTruthy();
    expect(screen.queryByText("Подтвердить план")).toBeNull();
  });

  it("unmoved, the slider shows the server's exact amount and confirm sends it unrounded", async () => {
    const state = { ...bridgeState(), dailyLimit: 47300, leftToday: 47300 };
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ state })) });
    await renderWith(<Today onOpenActivity={noop} />, api);
    const slider = await screen.findByLabelText("Сумма в день");
    expect(slider.props.value).toBe(47300);
    expect(screen.getByText("₴473 · $11")).toBeTruthy();
    expect(screen.getByText("₴20,070")).toBeTruthy();
    await tick(400);
    expect(api.previewBridge).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Подтвердить план"));
    await tick(0);
    expect(api.chooseBridge).toHaveBeenCalledWith(47300);
  });

  it("a confirmed plan shows calm feedback and no button until the amount changes", async () => {
    const api = fakeApi({ today: bridgeToday({ confirmed: true }) });
    await renderWith(<Today onOpenActivity={noop} />, api);
    expect(await screen.findByText(/План подтверждён/)).toBeTruthy();
    expect(screen.queryByText("Подтвердить план")).toBeNull();
    await fireEvent(screen.getByLabelText("Сумма в день"), "valueChange", 60000);
    await tick(310);
    await waitFor(() => expect(api.previewBridge).toHaveBeenCalledWith(60000));
    await tick(50);
    expect(screen.getByText("Подтвердить план")).toBeTruthy();
  });

  it("a failed preview says so, offers retry and keeps confirm disabled", async () => {
    const previewBridge = jest.fn(async () => {
      throw new NetworkError();
    });
    const api = fakeApi({ today: bridgeToday(), previewBridge });
    await renderWith(<Today onOpenActivity={noop} />, api);
    await fireEvent(await screen.findByLabelText("Сумма в день"), "valueChange", 60000);
    await tick(310);
    expect(await screen.findByText("Не удалось пересчитать")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Подтвердить план" }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByText("Повторить"));
    await tick(50);
    expect(previewBridge).toHaveBeenCalledTimes(2);
  });

  it("describes the slider value for assistive tech", async () => {
    await renderWith(<Today onOpenActivity={noop} />, fakeApi({ today: bridgeToday() }));
    const slider = await screen.findByLabelText("Сумма в день");
    expect(slider.props.accessibilityValue).toEqual({ text: "₴450 в день" });
  });

  it("confirms the chosen amount", async () => {
    const api = fakeApi({ today: bridgeToday() });
    await renderWith(<Today onOpenActivity={noop} />, api);
    await fireEvent(await screen.findByLabelText("Сумма в день"), "valueChange", 50000);
    await tick(310);
    await waitFor(() => expect(api.previewBridge).toHaveBeenCalledWith(50000));
    await tick(50);
    await fireEvent.press(screen.getByText("Подтвердить план"));
    await tick(0);
    expect(api.chooseBridge).toHaveBeenCalledWith(50000);
  });
});

describe("Today, accessibility and old data", () => {
  it("hides the metal from assistive tech and labels the amount as one phrase", async () => {
    await renderWith(<Today onOpenActivity={noop} />, fakeApi());
    await screen.findByText("Сегодня можно");
    let node = screen.getByTestId("limit-visual", HIDDEN).parent;
    while (node && node.props.accessibilityElementsHidden !== true) node = node.parent;
    expect(node).toBeTruthy();
    expect(screen.getByLabelText("Сегодня можно ₴720, из ₴1,000 на день")).toBeTruthy();
  });

  it("announces a stale sync as an alert", async () => {
    const stale = todayFixture({ syncStale: true });
    await renderWith(<Today onOpenActivity={noop} />, fakeApi({ today: jest.fn(async () => stale) }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("marks figures from an earlier day instead of presenting them as today's", async () => {
    const client = makeClient();
    client.setQueryData(["today"], todayFixture({ date: "2026-11-01" }));
    const api = fakeApi({ today: jest.fn(() => new Promise<never>(() => undefined)) });
    const now = () => new Date("2026-11-02T10:00:00Z");
    await renderWith(<Today onOpenActivity={noop} now={now} />, api, client);
    expect(await screen.findByText("Показаны данные за 01.11, не за сегодня.")).toBeTruthy();
  });

  it("shows no earlier-day note for today's data", async () => {
    const now = () => new Date("2026-11-02T10:00:00Z");
    await renderWith(<Today onOpenActivity={noop} now={now} />, fakeApi());
    await screen.findByText("Сегодня можно");
    expect(screen.queryByText(/не за сегодня/)).toBeNull();
  });
});

describe("Today, loading and offline", () => {
  it("shows a skeleton on first load", async () => {
    const api = fakeApi({ today: jest.fn(() => new Promise(() => undefined)) });
    await renderWith(<Today onOpenActivity={noop} />, api);
    expect(screen.getByTestId("today-skeleton")).toBeTruthy();
  });

  it("shows a calm retry card when the first load fails", async () => {
    const api = fakeApi({
      today: jest.fn(async () => {
        throw new NetworkError();
      }),
    });
    await renderWith(<Today onOpenActivity={noop} />, api);
    expect(await screen.findByText(/Не получилось загрузить данные/)).toBeTruthy();
    expect(screen.getByText("Повторить")).toBeTruthy();
  });

  it("offline with cached data keeps the last numbers and notes when they are from", async () => {
    const cached = todayFixture();
    const client = makeClient();
    client.setQueryData(["today"], cached, { updatedAt: new Date(2026, 10, 2, 8, 30).getTime() });
    const api = fakeApi({
      today: jest.fn(async () => {
        throw new NetworkError();
      }),
    });
    await renderWith(<Today onOpenActivity={noop} />, api, client);
    expect(await screen.findByText(/Нет связи/)).toBeTruthy();
    expect(screen.getByText(/08:30/)).toBeTruthy();
    expect(screen.getByText("₴720")).toBeTruthy();
    expect(levelOf()).toBe("mercury:0.72");
  });

  it("a stale bank sync keeps the limit and shows when it last updated", async () => {
    const stale = todayFixture({ syncStale: true, syncedAt: new Date(2026, 10, 1, 21, 10).toISOString() });
    await renderWith(<Today onOpenActivity={noop} />, fakeApi({ today: jest.fn(async () => stale) }));
    expect(await screen.findByText(/01\.11 21:10/)).toBeTruthy();
    expect(screen.getByText("₴720")).toBeTruthy();
    expect(levelOf()).toBe("mercury:0.72");
  });

  it("a stale sync with no sync yet says so", async () => {
    const stale = todayFixture({ syncStale: true, syncedAt: null });
    await renderWith(<Today onOpenActivity={noop} />, fakeApi({ today: jest.fn(async () => stale) }));
    expect(await screen.findByText(/Синхронизации с банком ещё не было/)).toBeTruthy();
    expect(screen.getByText("₴720")).toBeTruthy();
  });
});
