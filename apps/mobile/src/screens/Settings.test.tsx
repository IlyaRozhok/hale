import { Alert, StyleSheet } from "react-native";
import type { LedgerCheckDto, LedgerCheckIssueDto } from "@hale/contracts";
import { tokens } from "@hale/tokens";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { SessionProvider } from "../session";
import { Settings } from "./Settings";
import { Plan } from "./Plan";
import { fakeApi, loanFixture, loanHistoryFixture, makeClient, openPlanPart, renderWith, taxFixture, todayFixture } from "../testing";
import { NetworkError } from "../api/client";
import { TODAY_KEY } from "../api/queries";

jest.mock("../metal", () => {
  const { View } = require("react-native");
  return {
    LimitBar: ({ level, state }: { level: number; state: string }) => <View testID="limit-visual" accessibilityHint={`bar:${state}:${level}`} />,
  };
});
jest.mock("@react-native-community/slider", () => {
  const React = require("react");
  return { __esModule: true, default: (props: object) => React.createElement("Slider", props) };
});

const noop = () => undefined;
const pressAlert = (alert: jest.SpyInstance, label: string) => {
  const buttons = alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  buttons.find((b) => b.text === label)!.onPress?.();
};

describe("Settings, lifestyle cap", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const settle = async (ms: number) => {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  };

  it("previews the consequence from the server 300 ms after the slider stops", async () => {
    const api = fakeApi({
      previewSettings: jest.fn(async (cap: number) =>
        cap === 15_000_000 ? { dailyLimit: 90000, leftForGoalsMonthly: 1500000, rateStale: false } : { dailyLimit: 50000, leftForGoalsMonthly: 0, rateStale: false },
      ),
    });
    await renderWith(<Settings onClose={noop} />, api);
    const slider = await screen.findByLabelText("Потолок трат в месяц");
    expect(slider.props.value).toBe(100000);
    expect(await screen.findByText("₴500")).toBeTruthy(); // the current cap's consequence is shown from the start
    await fireEvent(slider, "valueChange", 140000);
    await settle(200);
    await fireEvent(slider, "valueChange", 150000);
    await settle(299);
    expect(api.previewSettings).not.toHaveBeenCalledWith(15_000_000);
    await settle(2);
    expect(api.previewSettings).toHaveBeenCalledTimes(2); // the current cap, then one request for 150,000 (never 140,000)
    expect(api.previewSettings).toHaveBeenLastCalledWith(15_000_000);
    expect(await screen.findByText("₴900")).toBeTruthy(); // daily limit under this cap, as the server said
    expect(screen.getByText("₴15,000")).toBeTruthy(); // left for goals each month
  });

  it("saves the cap when the slider is released", async () => {
    const api = fakeApi();
    await renderWith(<Settings onClose={noop} />, api);
    const slider = await screen.findByLabelText("Потолок трат в месяц");
    await fireEvent(slider, "valueChange", 150000);
    await fireEvent(slider, "slidingComplete", 150000);
    await waitFor(() => expect(api.patchSettings).toHaveBeenCalledWith({ lifestyle_cap: 15_000_000 }));
  });

  it("puts the value back and says so when saving fails", async () => {
    const patchSettings = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(<Settings onClose={noop} />, fakeApi({ patchSettings }));
    const slider = await screen.findByLabelText("Потолок трат в месяц");
    await fireEvent(slider, "valueChange", 150000);
    await fireEvent(slider, "slidingComplete", 150000);
    expect(await screen.findByText("Не удалось сохранить. Значение возвращено.")).toBeTruthy();
    expect(screen.getByLabelText("Потолок трат в месяц").props.value).toBe(100000);
  });
});

describe("Settings, preview accuracy", () => {
  it("warns that the figure may be inaccurate when a rate is missing", async () => {
    const previewSettings = jest.fn(async () => ({ dailyLimit: 90000, leftForGoalsMonthly: 0, rateStale: true }));
    await renderWith(<Settings onClose={noop} />, fakeApi({ previewSettings }));
    expect(await screen.findByText(/цифра может быть неточной/)).toBeTruthy();
  });

  it("recalculates the preview after a loan or a tax payment is saved", async () => {
    // An open loan, so that «Займы» is on «План» (variant А shows it only then).
    const loanHistory = jest.fn(async () => loanHistoryFixture({ stats: { borrowed: 500_000, repaid: 0, serviceCost: 0, stillOpen: 500_000 }, open: [loanFixture()] }));
    const api = fakeApi({ payments: jest.fn(async () => [taxFixture({ id: 2 })]), loanHistory });
    // Settings opens over the Plan screen, and both stay mounted while the sheet is up.
    await renderWith(
      <>
        <Settings onClose={noop} />
        <Plan />
      </>,
      api,
    );
    await waitFor(() => expect(api.previewSettings).toHaveBeenCalledTimes(1));
    await openPlanPart("Займы");
    await fireEvent.press(await screen.findByRole("button", { name: "Новый займ" }));
    await fireEvent.changeText(await screen.findByLabelText("Сумма займа"), "100");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить займ" }));
    await waitFor(() => expect(api.previewSettings).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByLabelText("Сумма займа")).toBeNull());
    const closes = screen.getAllByRole("button", { name: "Закрыть" });
    await fireEvent.press(closes[closes.length - 1]!);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Новый займ" })).toBeNull());
    await openPlanPart("Налоги");
    await fireEvent.press(await screen.findByRole("button", { name: "Отметить оплаченным" }));
    await waitFor(() => expect(api.previewSettings).toHaveBeenCalledTimes(3));
  });
});

describe("Settings, closing", () => {
  it("has a close control and no display or loan settings", async () => {
    const onClose = jest.fn();
    await renderWith(<Settings onClose={onClose} />, fakeApi());
    await screen.findByLabelText("Потолок трат в месяц");
    expect(screen.queryByText("Показ лимита")).toBeNull();
    expect(screen.queryByLabelText("Сумма займа")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Закрыть" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Settings, refetch of Today", () => {
  it("is refreshed after the cap is saved", async () => {
    const client = makeClient();
    client.setQueryData(TODAY_KEY, todayFixture());
    const api = fakeApi();
    await renderWith(<Settings onClose={noop} />, api, client);
    const slider = await screen.findByLabelText("Потолок трат в месяц");
    // Settings itself reads Today (the bank line), so an invalidated Today is fetched again at once.
    await waitFor(() => expect(api.today).toHaveBeenCalledTimes(1));
    await fireEvent(slider, "slidingComplete", 120000);
    await waitFor(() => expect(api.today).toHaveBeenCalledTimes(2));
  });
});

describe("Settings, bank connection", () => {
  it("says when the bank was last synced", async () => {
    const at = new Date();
    at.setHours(9, 5, 0, 0);
    await renderWith(<Settings onClose={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ syncedAt: at.toISOString() })) }));
    expect(await screen.findByText("Банк обновлялся сегодня 09:05")).toBeTruthy();
    expect(screen.queryByText("Синхронизации с банком ещё не было.")).toBeNull();
  });

  it("says so when there has been no sync yet", async () => {
    await renderWith(<Settings onClose={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ syncedAt: null })) }));
    expect(await screen.findByText("Синхронизации с банком ещё не было.")).toBeTruthy();
    expect(screen.queryByText(/Банк обновлялся/)).toBeNull();
  });

  it("shows no bank line until Today is loaded", async () => {
    await renderWith(<Settings onClose={noop} />, fakeApi({ today: jest.fn(() => new Promise<never>(() => undefined)) }));
    await screen.findByLabelText("Потолок трат в месяц");
    expect(screen.queryByText(/Банк обновлялся/)).toBeNull();
    expect(screen.queryByText(/Синхронизации с банком/)).toBeNull();
  });
});

describe("Settings, ledger check (Б11)", () => {
  const ranAt = "2026-11-12T03:00:00.000Z";
  const bank = (over: Partial<LedgerCheckIssueDto> = {}): LedgerCheckIssueDto => ({
    kind: "bank_balance",
    amount: -32_000,
    currency: "UAH",
    since: "2026-11-08",
    accountKind: "black",
    accountTitle: null,
    ...over,
  });
  const show = async (check: LedgerCheckDto | null) => {
    const view = await renderWith(<Settings onClose={noop} />, fakeApi({ ledgerCheck: jest.fn(async () => check) }));
    await screen.findByText(/Банк обновлялся/);
    return view;
  };

  it("says all is well when nothing differs", async () => {
    await show({ ranAt, issues: [] });
    expect(await screen.findByText("Сверка: всё сходится.")).toBeTruthy();
  });

  it("says what differs, where and since when, for one problem", async () => {
    await show({ ranAt, issues: [bank()] });
    expect(await screen.findByText("На чёрной карте не сходится ₴320 с 8 ноя.")).toBeTruthy();
    expect(screen.queryByText(/Ещё/)).toBeNull();
  });

  it("names the other kinds of problems in whole sentences", async () => {
    const one = async (issue: LedgerCheckIssueDto, text: string) => {
      const view = await show({ ranAt, issues: [issue] });
      expect(await screen.findByText(text)).toBeTruthy();
      await view.unmount();
    };
    await one(bank({ accountKind: "white", amount: 20_000 }), "На белой карте не сходится ₴200 с 8 ноя.");
    await one(bank({ accountKind: "fop" }), "На счёте ФОП не сходится ₴320 с 8 ноя.");
    await one(bank({ accountKind: "jar", accountTitle: "Отпуск" }), "В банке «Отпуск» не сходится ₴320 с 8 ноя.");
    await one(bank({ accountKind: "other", currency: "USD", amount: -1_050 }), "На одном из счетов не сходится $10.50 с 8 ноя.");
    await one({ kind: "own_transfers", amount: 0, currency: "UAH", since: "2026-11-03", count: 3 }, "У 3 переводов между своими счетами нет второй части, с 3 ноя.");
    await one({ kind: "own_transfers", amount: 0, currency: "UAH", since: "2026-11-03", count: 1 }, "У 1 перевода между своими счетами нет второй части, с 3 ноя.");
    await one({ kind: "categories", amount: 1_000, currency: "UAH", since: "2026-11-10" }, "С 10 ноя траты по категориям не сходятся с общей суммой на ₴10.");
    await one({ kind: "day_spent", amount: -50_000, currency: "UAH", since: "2026-11-06" }, "Потрачено за 6 ноя не везде одинаково: разница ₴500.");
    await one({ kind: "cash_wallet", amount: -10_000, currency: "UAH", since: "2026-11-09" }, "В кошельке наличных −₴100 с 9 ноя.");
  });

  it("shows the first problem and how many more there are", async () => {
    const cash = { kind: "cash_wallet", amount: -10_000, currency: "UAH", since: "2026-11-09" };
    let view = await show({ ranAt, issues: [bank(), cash] });
    expect(await screen.findByText("На чёрной карте не сходится ₴320 с 8 ноя. Ещё 1 расхождение.")).toBeTruthy();
    await view.unmount();
    view = await show({ ranAt, issues: [bank(), cash, cash] });
    expect(await screen.findByText("На чёрной карте не сходится ₴320 с 8 ноя. Ещё 2 расхождения.")).toBeTruthy();
    await view.unmount();
    await show({ ranAt, issues: [bank(), ...Array.from({ length: 5 }, () => cash)] });
    expect(await screen.findByText("На чёрной карте не сходится ₴320 с 8 ноя. Ещё 5 расхождений.")).toBeTruthy();
  });

  it("starts with a problem it can name when a newer server sends one it cannot", async () => {
    await show({ ranAt, issues: [{ kind: "something_new", amount: 1, currency: "UAH", since: null }, bank()] });
    expect(await screen.findByText("На чёрной карте не сходится ₴320 с 8 ноя. Ещё 1 расхождение.")).toBeTruthy();
  });

  it("shows nothing when the server has no result: the check is off, it never ran, or the server is older", async () => {
    await show(null);
    expect(screen.queryByText(/Сверка/)).toBeNull();
    expect(screen.queryByText(/не сходится/)).toBeNull();
  });

  it("shows nothing when the check cannot be loaded", async () => {
    await renderWith(<Settings onClose={noop} />, fakeApi({ ledgerCheck: jest.fn(async () => Promise.reject(new NetworkError())) }));
    await screen.findByText(/Банк обновлялся/);
    expect(screen.queryByText(/Сверка/)).toBeNull();
  });

  it("is plain muted text, no warning colour", async () => {
    await show({ ranAt, issues: [bank()] });
    const line = await screen.findByText("На чёрной карте не сходится ₴320 с 8 ноя.");
    expect(StyleSheet.flatten(line.props.style).color).toBe(tokens.color.fg.muted);
  });
});

describe("Settings, sign-out", () => {
  const open = async (signOut: () => void) => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await renderWith(
      <SessionProvider signOut={signOut}>
        <Settings onClose={noop} />
      </SessionProvider>,
      fakeApi(),
    );
    await fireEvent.press(await screen.findByRole("button", { name: "Выйти" }));
    return alert;
  };

  it("asks first and signs out only after «Выйти» is confirmed", async () => {
    const signOut = jest.fn();
    const alert = await open(signOut);
    expect(alert).toHaveBeenCalledWith("Выйти из Hale?", "Чтобы войти снова, понадобится пароль.", [
      { text: "Отмена", style: "cancel" },
      expect.objectContaining({ text: "Выйти" }),
    ]);
    expect(signOut).not.toHaveBeenCalled();
    await act(async () => pressAlert(alert, "Выйти"));
    expect(signOut).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it("«Отмена» leaves the session alone", async () => {
    const signOut = jest.fn();
    const alert = await open(signOut);
    await act(async () => pressAlert(alert, "Отмена"));
    expect(signOut).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it("renders without a session provider", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await renderWith(<Settings onClose={noop} />, fakeApi());
    await fireEvent.press(await screen.findByRole("button", { name: "Выйти" }));
    expect(() => pressAlert(alert, "Выйти")).not.toThrow();
    alert.mockRestore();
  });
});
