import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert, StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import type { BridgeStateDto, DailyStateDto } from "@hale/contracts";
import { Today } from "./Today";
import { calendarFixture, fakeApi, makeClient, pickDate, renderWith, todayFixture } from "../testing";
import { kyivDate, shiftDate } from "../format";
import { ApiError, NetworkError } from "../api/client";

jest.mock("../metal", () => {
  const { View } = require("react-native");
  return { LimitVisual: ({ mode, level }: { mode: string; level: number }) => <View testID="limit-visual" accessibilityHint={`${mode}:${level}`} /> };
});
jest.mock("@react-native-community/slider", () => {
  const React = require("react");
  return { __esModule: true, default: (props: object) => React.createElement("Slider", props) };
});

const noop = () => undefined;
const pressAlert = (alert: jest.SpyInstance, label: string) => {
  const buttons = alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  buttons.find((b) => b.text === label)!.onPress!();
};
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
const openQuestions = async () => fireEvent.press(await screen.findByText(/^Осталось разобрать: /));
const openBridge = async () => fireEvent.press(await screen.findByText(/план(а)? до зарплаты/i));
const HIDDEN = { includeHiddenElements: true };
const levelOf = () => screen.getByTestId("limit-visual", HIDDEN).props.accessibilityHint as string;

describe("Today, normal mode", () => {
  it("shows the date, the limit with days to income, USD and the next payment", async () => {
    const state = { ...todayFixture().state, daysLeft: 17 };
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ state })) }));
    expect(await screen.findByText("Сегодня можно")).toBeTruthy();
    expect(screen.getByText("Понедельник, 2 ноября")).toBeTruthy();
    expect(screen.getByText("₴720")).toBeTruthy();
    expect(screen.getByText("из ₴1,000 · до зарплаты 17 дн")).toBeTruthy();
    expect(screen.getByText("$17 сейчас")).toBeTruthy();
    expect(screen.getByText("Скоро платить")).toBeTruthy();
    expect(screen.getByText("Квартплата")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText("ноя")).toBeTruthy();
    expect(screen.getByText("₴17,000")).toBeTruthy();
    expect(levelOf()).toBe("mercury:0.72");
  });

  it("leaves out days to income while no income date is known", async () => {
    const state = { ...todayFixture().state, needsIncomeDate: true };
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ state })) }));
    expect(await screen.findByText("из ₴1,000 на день")).toBeTruthy();
  });

  it("keeps accounts off the home screen", async () => {
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi());
    await screen.findByText("Сегодня можно");
    expect(screen.queryByText("Свои")).toBeNull();
    expect(screen.queryByText("Кредитные")).toBeNull();
  });

  it("lists three upcoming payments and totals all of them", async () => {
    const upcoming = ["1", "2", "3", "4"].map((id, i) => ({ id, name: `Платёж ${id}`, amount: 100000 * (i + 1), dueOn: `2026-11-1${i}`, kind: "obligation", currency: "UAH" }));
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ upcoming })) }));
    expect(await screen.findByText("₴10,000")).toBeTruthy();
    expect(screen.getByText("Платёж 3")).toBeTruthy();
    expect(screen.queryByText("Платёж 4")).toBeNull();
  });

  it("hides the payments card when nothing is coming", async () => {
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ upcoming: [] })) }));
    await screen.findByText("Сегодня можно");
    expect(screen.queryByText("Скоро платить")).toBeNull();
  });

  it("shows goals as cards with amount and percent", async () => {
    const goals = [
      { id: 1, name: "Подушка", saved: 50000, target: 500000 },
      { id: 2, name: "Машина", saved: 0, target: 1000000 },
    ];
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ goals })) }));
    expect(await screen.findByText("Подушка")).toBeTruthy();
    expect(screen.getByText("$500")).toBeTruthy();
    expect(screen.getByText("10% из $5,000")).toBeTruthy();
    expect(screen.getByText("Машина")).toBeTruthy();
    expect(screen.getByText("0% из $10,000")).toBeTruthy();
    expect(screen.queryByText("Добавить цель")).toBeNull();
  });

  it("invites to add a goal when there are none, also with cached data from before goals existed", async () => {
    const onOpenPlan = jest.fn();
    const old = todayFixture();
    delete (old as Partial<typeof old>).goals;
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={onOpenPlan} />, fakeApi({ today: jest.fn(async () => old) }));
    await fireEvent.press(await screen.findByRole("button", { name: "Добавить цель" }));
    expect(onOpenPlan).toHaveBeenCalled();
  });

  it("has no settings button: settings live in Plan", async () => {
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi());
    await screen.findByText("Сегодня можно");
    expect(screen.queryByRole("button", { name: "Настройки" })).toBeNull();
  });

  it("states an overspent day calmly, in the ordinary colour", async () => {
    const state = { ...todayFixture().state, leftToday: -12000, level: 0 };
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ state })) }));
    const amount = await screen.findByText("₴120");
    expect(StyleSheet.flatten(amount.props.style).color).toBe(tokens.color.fg.default);
    expect(screen.queryByText(/превыш|перерасход|красн/i)).toBeNull();
  });

  it("always shows mercury, even if the server still has the ring saved", async () => {
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ limitVisual: "ring" })) }));
    await screen.findByText("Сегодня можно");
    expect(levelOf()).toBe("mercury:0.72");
  });

  describe("limit states", () => {
    const withState = (over: Partial<DailyStateDto>) => {
      const fixture = todayFixture();
      return fakeApi({ today: jest.fn(async () => ({ ...fixture, state: { ...fixture.state, ...over } })) });
    };

    it("spending with no limit yet is not called going over a limit", async () => {
      await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, withState({ dailyLimit: 0, leftToday: -60100, level: 0 }));
      expect(await screen.findByText("Сегодня можно")).toBeTruthy();
      expect(screen.queryByText("Сверх лимита")).toBeNull();
      expect(screen.getByText("₴0")).toBeTruthy();
      expect(screen.getByText("Потрачено ₴601")).toBeTruthy();
    });

    it("overspent: says how far over the limit, with no minus", async () => {
      await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, withState({ dailyLimit: 95000, leftToday: -60100, level: 0 }));
      expect(await screen.findByText("Сверх лимита")).toBeTruthy();
      expect(screen.getByText("₴601")).toBeTruthy();
      expect(screen.getByText("Завтра будет новый лимит.")).toBeTruthy();
      expect(screen.getByText(/Потрачено ₴1,551/)).toBeTruthy();
      expect(screen.queryByText("Сегодня можно")).toBeNull();
      expect(screen.queryByText(/−/)).toBeNull();
      expect(screen.getByLabelText("Сверх лимита ₴601, из ₴950 на день")).toBeTruthy();
    });

    it("exactly used up: the limit is used, nothing over it", async () => {
      await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, withState({ dailyLimit: 95000, leftToday: 0, level: 0 }));
      expect(await screen.findByText("Сегодня можно")).toBeTruthy();
      expect(screen.getByText("₴0")).toBeTruthy();
      expect(screen.getByText("Лимит на сегодня использован. Завтра будет новый.")).toBeTruthy();
    });

    it("draws the metal only while something is left", async () => {
      await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, withState({ dailyLimit: 95000, leftToday: 0, level: 0 }));
      await screen.findByText("Сегодня можно");
      expect(screen.queryByTestId("limit-visual", HIDDEN)).toBeNull();
    });

    it("shows what was spent today", async () => {
      await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, withState({ dailyLimit: 200000, leftToday: 124000, level: 0.62 }));
      expect(await screen.findByText(/Потрачено ₴760/)).toBeTruthy();
      expect(levelOf()).toBe("mercury:0.62");
    });
  });

  describe("refreshing", () => {
    const control = () => screen.getByTestId("today-scroll").props.refreshControl.props as { refreshing: boolean; onRefresh: () => void };

    it("a background refetch never shows the spinner", async () => {
      let finish: (v: ReturnType<typeof todayFixture>) => void = noop;
      const today = jest.fn(async () => todayFixture());
      const api = fakeApi({ today });
      const client = makeClient();
      await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api, client);
      await screen.findByText("Сегодня можно");
      today.mockImplementationOnce(() => new Promise((r) => (finish = r)));
      await act(async () => void client.refetchQueries({ queryKey: ["today"] }));
      expect(control().refreshing).toBe(false);
      await act(async () => finish(todayFixture()));
    });

    it("a pull shows it until the data arrives", async () => {
      let finish: (v: ReturnType<typeof todayFixture>) => void = noop;
      const today = jest.fn(async () => todayFixture());
      await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today }));
      await screen.findByText("Сегодня можно");
      today.mockImplementationOnce(() => new Promise((r) => (finish = r)));
      await act(async () => control().onRefresh());
      expect(control().refreshing).toBe(true);
      await act(async () => finish(todayFixture()));
      await waitFor(() => expect(control().refreshing).toBe(false));
    });
  });

  it("a loan from the bank can be repaid but offers no deletion", async () => {
    const badCases = [{ id: "loan:1", text: "Займ ₴5,000 от 01.11", repayLoan: { id: 1, remaining: 500_000 } }];
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ badCases })) }));
    expect(await screen.findByText(badCases[0]!.text)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Погасил: Займ ₴5,000 от 01.11" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Удалить/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Убрать/ })).toBeNull();
  });

  it("a bad case with no loan behind it has no actions", async () => {
    const badCases = [{ id: "bridge_over_plan:1", text: "Минус вышел за план моста на ₴100." }];
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ badCases })) }));
    expect(await screen.findByText(badCases[0]!.text)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Погасил|Удалить/ })).toBeNull();
  });

  it("deletes a mistaken loan entered by hand, after asking", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ badCases: [{ id: "loan:7", text: "Займ ₴10 от 03.11", removableLoanId: 7, repayLoan: { id: 7, remaining: 1000 } }] })) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Удалить: Займ ₴10 от 03.11" }));
    expect(api.deleteLoan).not.toHaveBeenCalled();
    await act(async () => pressAlert(alert, "Удалить"));
    await waitFor(() => expect(api.deleteLoan).toHaveBeenCalledWith(7));
    await waitFor(() => expect(api.today).toHaveBeenCalledTimes(2));
    alert.mockRestore();
  });

  it("repaying a loan asks for the amount and date, with what is owed filled in", async () => {
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ date: "2026-11-03", badCases: [{ id: "loan:7", text: "Займ ₴5,000 от 01.11", repayLoan: { id: 7, remaining: 500_000 } }] })) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Погасил: Займ ₴5,000 от 01.11" }));
    expect(screen.getByLabelText("Сумма").props.value).toBe("5000");
    const yesterday = shiftDate(kyivDate(), -1);
    await pickDate("Дата", yesterday);
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.repayLoan).toHaveBeenCalledWith(7, { amount: 500_000, date: yesterday }));
    await waitFor(() => expect(screen.queryByLabelText("Сумма")).toBeNull());
    await waitFor(() => expect(api.today).toHaveBeenCalledTimes(2));
  });

  it("says what a different repayment amount will do, and rejects a bad one", async () => {
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ badCases: [{ id: "loan:7", text: "Займ ₴5,000 от 01.11", repayLoan: { id: 7, remaining: 500_000 } }] })) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Погасил: Займ ₴5,000 от 01.11" }));
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "2000");
    expect(screen.getByText("Останется ₴3,000, займ будет открыт.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "5500");
    expect(screen.getByText("₴500 сверх займа уйдут в обслуживание.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "ноль");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    expect(screen.getByText("Проверьте сумму и дату.")).toBeTruthy();
    expect(api.repayLoan).not.toHaveBeenCalled();
  });

  it("the repayment form names the loan alone, without the note about the pace", async () => {
    const text = "Займ ₴5,000 от 01.11. При текущем темпе деньги закончатся 18.11.";
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ badCases: [{ id: "loan:7", text, repayLoan: { id: 7, remaining: 500_000 } }] })) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: `Погасил: ${text}` }));
    expect(screen.getByText("Займ ₴5,000 от 01.11")).toBeTruthy();
  });

  it("the repayment form's button works while the keyboard is up", async () => {
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ badCases: [{ id: "loan:7", text: "Займ ₴5,000 от 01.11", repayLoan: { id: 7, remaining: 500_000 } }] })) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Погасил: Займ ₴5,000 от 01.11" }));
    let node = screen.getByText("Сохранить").parent;
    while (node && node.props.keyboardShouldPersistTaps === undefined) node = node.parent;
    expect(node?.props.keyboardShouldPersistTaps).toBe("handled");
  });

  describe("the limit calendar", () => {
    const november = () => ({
      calendar: jest.fn(async (month: string) =>
        calendarFixture({
          month,
          today: "2026-11-05",
          streak: 2,
          days:
            month !== "2026-11"
              ? []
              : [
                  { date: "2026-11-01", limit: 100_000, spent: 80_000, status: "within" as const },
                  { date: "2026-11-02", limit: 100_000, spent: 120_000, status: "over" as const },
                  { date: "2026-11-03", limit: 100_000, spent: 160_000, status: "far_over" as const },
                  { date: "2026-11-04", limit: null, spent: 5_000, status: "no_limit" as const },
                  { date: "2026-11-05", limit: 100_000, spent: 10_000, status: "today" as const },
                ],
        }),
      ),
    });
    const flat = (name: string) => StyleSheet.flatten(screen.getByRole("button", { name: new RegExp(`^${name}`) }).props.style);
    const openIt = async (over = {}) => {
      const api = fakeApi({ today: jest.fn(async () => todayFixture({ date: "2026-11-05", streak: 2 })), ...november(), ...over });
      await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
      await fireEvent.press(await screen.findByRole("button", { name: "Серия: 2 дня в лимите" }));
      await screen.findByText("Ноябрь 2026");
      await screen.findByRole("button", { name: /^1 ноября/ });
      return api;
    };

    it("names the streak in the right word form", async () => {
      await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ streak: 5 })) }));
      expect(await screen.findByRole("button", { name: "Серия: 5 дней в лимите" })).toBeTruthy();
    });

    it("offers the calendar by name while there is no streak", async () => {
      await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi());
      expect(await screen.findByRole("button", { name: "Календарь лимитов" })).toBeTruthy();
    });

    it("colours days by status and says the status in words too", async () => {
      await openIt();
      expect(flat("1 ноября").backgroundColor).toBe(tokens.color.calendar.within);
      expect(flat("2 ноября").backgroundColor).toBe(tokens.color.calendar.over);
      expect(flat("3 ноября").backgroundColor).toBe(tokens.color.calendar.farOver);
      expect(flat("4 ноября").backgroundColor).toBeUndefined();
      expect(flat("5 ноября").backgroundColor).toBeUndefined();
      expect(screen.getByRole("button", { name: "1 ноября: в лимите" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "3 ноября: сильно сверх лимита" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "4 ноября: лимита не было" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "5 ноября: сегодня" })).toBeTruthy();
    });

    it("tells a day's figures when it is tapped", async () => {
      await openIt();
      await fireEvent.press(screen.getByRole("button", { name: "2 ноября: сверх лимита" }));
      expect(screen.getByText("2 ноября: потрачено ₴1,200 из ₴1,000")).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "4 ноября: лимита не было" }));
      expect(screen.getByText("4 ноября: потрачено ₴50, лимита не было")).toBeTruthy();
    });

    it("walks to the previous month and does not go past the current one", async () => {
      const api = await openIt();
      expect(screen.getByRole("button", { name: "Следующий месяц" }).props.accessibilityState.disabled).toBe(true);
      await fireEvent.press(screen.getByRole("button", { name: "Предыдущий месяц" }));
      expect(await screen.findByText("Октябрь 2026")).toBeTruthy();
      await waitFor(() => expect(api.calendar).toHaveBeenCalledWith("2026-10"));
      await fireEvent.press(screen.getByRole("button", { name: "Следующий месяц" }));
      expect(await screen.findByText("Ноябрь 2026")).toBeTruthy();
    });

    it("offers a retry when the month does not load", async () => {
      const calendar = jest.fn(async (): Promise<ReturnType<typeof calendarFixture>> => {
        throw new NetworkError();
      });
      const api = fakeApi({ today: jest.fn(async () => todayFixture({ streak: 2 })), calendar });
      await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
      await fireEvent.press(await screen.findByRole("button", { name: "Серия: 2 дня в лимите" }));
      expect(await screen.findByText("Не получилось загрузить месяц.", {}, { timeout: 4000 })).toBeTruthy();
      calendar.mockImplementation(november().calendar as never);
      await fireEvent.press(screen.getByRole("button", { name: "Повторить" }));
      expect(await screen.findByRole("button", { name: /^1 ноября/ })).toBeTruthy();
    });
  });

  describe("the repayment window", () => {
    const open = async () => {
      const api = fakeApi({ today: jest.fn(async () => todayFixture({ badCases: [{ id: "loan:7", text: "Займ ₴5,000 от 01.11", repayLoan: { id: 7, remaining: 500_000 } }] })) });
      await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
      await fireEvent.press(await screen.findByRole("button", { name: "Погасил: Займ ₴5,000 от 01.11" }));
      return screen.getByTestId("sheet-panel");
    };
    const touch = (y: number, timestamp: number) => ({ nativeEvent: { pageX: 100, pageY: y, timestamp, touches: [{}] } });
    const swipe = async (panel: ReturnType<typeof screen.getByTestId>, to: number, ms: number) => {
      await fireEvent(panel, "touchStart", touch(400, 0));
      await fireEvent(panel, "touchMove", touch(410, ms / 2));
      await fireEvent(panel, "touchMove", touch(to, ms));
      await fireEvent(panel, "touchEnd", touch(to, ms));
    };

    it("closes when swiped down far enough", async () => {
      await swipe(await open(), 600, 400);
      await waitFor(() => expect(screen.queryByLabelText("Сумма")).toBeNull());
    });

    it("stays open after a short, slow drag", async () => {
      await swipe(await open(), 450, 1000);
      await act(async () => new Promise<void>((r) => setTimeout(r, 300)));
      expect(screen.getByLabelText("Сумма")).toBeTruthy();
    });

    it("closes with the button too", async () => {
      await open();
      const closes = screen.getAllByRole("button", { name: "Закрыть" });
      await fireEvent.press(closes[closes.length - 1]!);
      await waitFor(() => expect(screen.queryByLabelText("Сумма")).toBeNull());
    });
  });

  it("says what is wrong when the repayment date does not fit the loan", async () => {
    const api = fakeApi({
      today: jest.fn(async () => todayFixture({ badCases: [{ id: "loan:7", text: "Займ ₴5,000 от 01.11", repayLoan: { id: 7, remaining: 500_000 } }] })),
      repayLoan: jest.fn(async () => {
        throw new ApiError(422);
      }),
    });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Погасил: Займ ₴5,000 от 01.11" }));
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    const text = await screen.findByText("Дата должна быть не раньше дня займа и не позже сегодня.");
    expect(StyleSheet.flatten(text.props.style).color).toBe(tokens.color.status.danger);
  });

  it("keeps the repayment form open when the save fails", async () => {
    const api = fakeApi({
      today: jest.fn(async () => todayFixture({ badCases: [{ id: "loan:7", text: "Займ ₴5,000 от 01.11", repayLoan: { id: 7, remaining: 500_000 } }] })),
      repayLoan: jest.fn(async () => {
        throw new Error("boom");
      }),
    });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Погасил: Займ ₴5,000 от 01.11" }));
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(screen.getByLabelText("Сумма")).toBeTruthy();
  });

  it("makes every button at least the minimum touch size", async () => {
    const questions = [
      { id: "usdc_arrived:12", kind: "usdc_arrived" as const, text: "Пришло на Binance?" },
      { id: "usdc_match:12:34", kind: "usdc_match" as const, text: "Это вывод с Binance?" },
      { id: "income_date:5", kind: "income_date" as const, text: "Когда ожидается следующий доход?" },
      { id: "recipient_label:0123456789abcdef", kind: "recipient_label" as const, text: "Кто это: Иван?" },
    ];
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ questions })) }));
    expect(await screen.findByText("Осталось разобрать: 4")).toBeTruthy();
    for (const b of screen.getAllByRole("button")) {
      expect(StyleSheet.flatten(b.props.style).minHeight).toBeGreaterThanOrEqual(tokens.touchMin);
    }
    await openQuestions();
    await screen.findByText("Пришло на Binance?");
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(3);
    for (const b of buttons) {
      expect(StyleSheet.flatten(b.props.style).minHeight).toBeGreaterThanOrEqual(tokens.touchMin);
    }
  });
});

describe("Today, questions", () => {
  it("a question that leads to Activity closes the sheet first", async () => {
    const onOpenActivity = jest.fn();
    const questions = [{ id: "usdc_arrived", kind: "usdc_arrived" as const, text: "Посмотреть операцию" }];
    await renderWith(<Today onOpenActivity={onOpenActivity} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ questions })) }));
    await openQuestions();
    await fireEvent.press(await screen.findByText("Посмотреть операцию"));
    expect(onOpenActivity).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("Посмотреть операцию")).toBeNull());
  });

  it("closing the recipient sheet returns to the question list", async () => {
    const questions = [{ id: "recipient_label:0123456789abcdef", kind: "recipient_label" as const, text: "Кто это: Иван?" }];
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ questions })) }));
    await openQuestions();
    await fireEvent.press(await screen.findByText("Кто это: Иван?"));
    expect(await screen.findByText("Что это за перевод?")).toBeTruthy();
    const closes = screen.getAllByRole("button", { name: "Закрыть" });
    await fireEvent.press(closes[closes.length - 1]!);
    await waitFor(() => expect(screen.queryByText("Что это за перевод?")).toBeNull());
    expect(screen.getByText("Кто это: Иван?")).toBeTruthy();
  });

  it("a USDC arrival is confirmed with one tap and the card goes away", async () => {
    const questions = [{ id: "usdc_arrived:12", kind: "usdc_arrived" as const, text: "Пришло на Binance?" }];
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ questions })) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await openQuestions();
    await fireEvent.press(await screen.findByText("Да, пришло"));
    await waitFor(() => expect(api.confirmIncome).toHaveBeenCalledWith(12));
    await waitFor(() => expect(screen.queryByText("Пришло на Binance?")).toBeNull());
  });

  it("an income date is set with one tap on a quick choice", async () => {
    const questions = [{ id: "income_date:5", kind: "income_date" as const, text: "Когда ожидается следующий доход?" }];
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ questions })) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await openQuestions();
    await fireEvent.press(await screen.findByText("Через неделю"));
    await waitFor(() => expect(api.setIncomeDate).toHaveBeenCalledWith(5, "2026-11-09"));
    await waitFor(() => expect(screen.queryByText("Когда ожидается следующий доход?")).toBeNull());
  });

  const USDC_MATCH = { id: "usdc_match:12:34", kind: "usdc_match" as const, text: "Пришло ₴120 000 (05.11). Это вывод с Binance?" };

  it("a credit from Binance is matched with one tap against the event and the row, and the card goes away", async () => {
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ questions: [USDC_MATCH] })) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await openQuestions();
    await fireEvent.press(await screen.findByRole("button", { name: "Да, вывод с Binance" }));
    await waitFor(() => expect(api.matchUsdc).toHaveBeenCalledWith(12, 34));
    expect(api.dismissUsdcMatch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(USDC_MATCH.text)).toBeNull());
  });

  it("answering no marks the row, not the balance", async () => {
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ questions: [USDC_MATCH] })) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await openQuestions();
    await fireEvent.press(await screen.findByRole("button", { name: "Нет" }));
    await waitFor(() => expect(api.dismissUsdcMatch).toHaveBeenCalledWith(34));
    expect(api.matchUsdc).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(USDC_MATCH.text)).toBeNull());
  });

  it("refreshes Today after a match and brings the card back if the match fails", async () => {
    const today = jest.fn(async () => todayFixture({ questions: [USDC_MATCH] }));
    const ok = fakeApi({ today });
    const first = await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, ok);
    await openQuestions();
    await fireEvent.press(await screen.findByRole("button", { name: "Да, вывод с Binance" }));
    await waitFor(() => expect(today).toHaveBeenCalledTimes(2));
    await first.unmount();

    const failing = fakeApi({
      today: jest.fn(async () => todayFixture({ questions: [USDC_MATCH] })),
      matchUsdc: jest.fn(async () => {
        throw new NetworkError();
      }),
    });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, failing);
    await openQuestions();
    await fireEvent.press(await screen.findByRole("button", { name: "Да, вывод с Binance" }));
    await waitFor(() => expect(failing.matchUsdc).toHaveBeenCalled());
    expect(await screen.findByText(USDC_MATCH.text)).toBeTruthy();
  });

  it("hides a date question with no income event, even from an older cached answer", async () => {
    const questions = [{ id: "income_date", kind: "income_date" as const, text: "Когда ожидается следующий доход?" }];
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ questions })) }));
    await screen.findByText("Сегодня можно");
    expect(screen.queryByText(/^Осталось разобрать/)).toBeNull();
  });

  it("names the person from the subject field, and copes with an older answer without one", async () => {
    const questions = [
      { id: "recipient_label:aaaa", kind: "recipient_label" as const, text: "Иван: 3 перевода, ₴2,500", subject: "Иван" },
      { id: "recipient_label:bbbb", kind: "recipient_label" as const, text: "Кто это: Ольга?" },
    ];
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ questions })) }));
    await openQuestions();
    await fireEvent.press(await screen.findByText("Иван: 3 перевода, ₴2,500"));
    expect(await screen.findByText("Иван")).toBeTruthy();
    const closes = screen.getAllByRole("button", { name: "Закрыть" });
    await fireEvent.press(closes[closes.length - 1]!);
    await fireEvent.press(await screen.findByText("Кто это: Ольга?"));
    expect(await screen.findByText("Ольга")).toBeTruthy();
  });

  it("a recipient question opens the label sheet for that recipient, and the card goes away once answered", async () => {
    const questions = [{ id: "recipient_label:0123456789abcdef", kind: "recipient_label" as const, text: "Кто это: Иван?" }];
    const onOpenActivity = jest.fn();
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ questions })) });
    await renderWith(<Today onOpenActivity={onOpenActivity} onOpenPlan={noop} />, api);
    await openQuestions();
    await fireEvent.press(await screen.findByText("Кто это: Иван?"));
    expect(await screen.findByText("Что это за перевод?")).toBeTruthy();
    expect(screen.getByText("Иван")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Разовая помощь или подарок" }));
    await waitFor(() => expect(api.labelRecipient).toHaveBeenCalledWith("0123456789abcdef", "one_off"));
    await waitFor(() => expect(screen.queryByText("Осталось разобрать: 1")).toBeNull());
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
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await openQuestions();
    await fireEvent.press(await screen.findByText("Да, пришло"));
    await waitFor(() => expect(api.confirmIncome).toHaveBeenCalled());
    expect(await screen.findByText("Пришло на Binance?")).toBeTruthy();
  });
});

describe("Today, decision rows", () => {
  it("shows no row when nothing needs a decision", async () => {
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi());
    await screen.findByText("Сегодня можно");
    expect(screen.queryByText(/Осталось разобрать/)).toBeNull();
    expect(screen.queryByText(/план[а]? до зарплаты/i)).toBeNull();
  });

  it("keeps questions and the plan out of the way until asked for", async () => {
    const questions = [{ id: "usdc_arrived:12", kind: "usdc_arrived" as const, text: "Пришло на Binance?" }];
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ questions, state: bridgeState() })) }));
    expect(await screen.findByText("Осталось разобрать: 1")).toBeTruthy();
    expect(screen.getByText("Нужен план до зарплаты")).toBeTruthy();
    expect(screen.queryByText("Пришло на Binance?")).toBeNull();
    expect(screen.queryByLabelText("Сумма в день")).toBeNull();
  });

  it("names the daily amount once a plan is confirmed", async () => {
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ state: bridgeState({ confirmed: true }) })) }));
    expect(await screen.findByText("План до зарплаты: ₴450 в день")).toBeTruthy();
  });

  it("keeps the other questions under a recipient's label sheet", async () => {
    const questions = [
      { id: "recipient_label:0123456789abcdef", kind: "recipient_label" as const, text: "Кто это: Иван?" },
      { id: "usdc_arrived:12", kind: "usdc_arrived" as const, text: "Пришло на Binance?" },
    ];
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ questions })) }));
    await openQuestions();
    await fireEvent.press(await screen.findByText("Кто это: Иван?"));
    expect(await screen.findByText("Что это за перевод?")).toBeTruthy();
    expect(screen.getByText("Пришло на Binance?")).toBeTruthy();
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
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: bridgeToday() }));
    await openBridge();
    expect(await screen.findByText(/До зарплаты 18 дн/)).toBeTruthy();
    expect(screen.getByText("₴20,070")).toBeTruthy();
    expect(screen.getByLabelText("Сумма в день")).toBeTruthy();
    expect(screen.getByText("Подтвердить план")).toBeTruthy();
  });

  it("with no limit yet, asks to confirm the plan instead of saying the limit was used", async () => {
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => todayFixture({ state: { ...bridgeState(), dailyLimit: 0, leftToday: 0 } })) }));
    await openBridge();
    expect(await screen.findByText("Лимит появится, когда вы подтвердите план.")).toBeTruthy();
    expect(screen.queryByText(/использован/)).toBeNull();
    expect(screen.queryByText(/на день$/)).toBeNull();
  });

  it("sends one preview 300 ms after the slider stops and shows the new credit needed", async () => {
    const api = fakeApi({
      today: bridgeToday(),
      previewBridge: jest.fn(async (d: number) => ({ dailyAmount: d, creditNeeded: 2800000, shortfall: 0 })),
    });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await openBridge();
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
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await openBridge();
    await fireEvent(await screen.findByLabelText("Сумма в день"), "valueChange", 100000);
    await tick(310);
    expect(await screen.findByText(/Не хватает ₴7,916/)).toBeTruthy();
    expect(screen.queryByText("Подтвердить план")).toBeNull();
  });

  it("unmoved, the slider shows the server's exact amount and confirm sends it unrounded", async () => {
    const state = { ...bridgeState(), dailyLimit: 47300, leftToday: 47300 };
    const api = fakeApi({ today: jest.fn(async () => todayFixture({ state })) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await openBridge();
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
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await openBridge();
    expect(await screen.findByText(/План подтверждён/)).toBeTruthy();
    expect(screen.queryByText("Подтвердить план")).toBeNull();
    await fireEvent(screen.getByLabelText("Сумма в день"), "valueChange", 60000);
    await tick(310);
    await waitFor(() => expect(api.previewBridge).toHaveBeenCalledWith(60000));
    await tick(50);
    expect(screen.getByText("Подтвердить ₴600 в день")).toBeTruthy();
  });

  it("a confirmed plan can be cancelled, after asking", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
    const api = fakeApi({ today: bridgeToday({ confirmed: true }) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await openBridge();
    await fireEvent.press(await screen.findByRole("button", { name: "Отменить план" }));
    expect(api.cancelBridge).not.toHaveBeenCalled();
    await act(async () => pressAlert(alert, "Отменить план"));
    await tick(0);
    expect(api.cancelBridge).toHaveBeenCalled();
    alert.mockRestore();
  });

  it("an unconfirmed plan has nothing to cancel", async () => {
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: bridgeToday() }));
    await openBridge();
    await screen.findByLabelText("Сумма в день");
    expect(screen.queryByRole("button", { name: "Отменить план" })).toBeNull();
  });

  it("a failed preview says so, offers retry and keeps confirm disabled", async () => {
    const previewBridge = jest.fn(async () => {
      throw new NetworkError();
    });
    const api = fakeApi({ today: bridgeToday(), previewBridge });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await openBridge();
    await fireEvent(await screen.findByLabelText("Сумма в день"), "valueChange", 60000);
    await tick(310);
    expect(await screen.findByText("Не удалось пересчитать")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Подтвердить план" }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByText("Повторить"));
    await tick(50);
    expect(previewBridge).toHaveBeenCalledTimes(2);
  });

  it("describes the slider value for assistive tech", async () => {
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: bridgeToday() }));
    await openBridge();
    const slider = await screen.findByLabelText("Сумма в день");
    expect(slider.props.accessibilityValue).toEqual({ text: "₴450 в день" });
  });

  it("confirms the chosen amount", async () => {
    const api = fakeApi({ today: bridgeToday() });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await openBridge();
    await fireEvent(await screen.findByLabelText("Сумма в день"), "valueChange", 50000);
    await tick(310);
    await waitFor(() => expect(api.previewBridge).toHaveBeenCalledWith(50000));
    await tick(50);
    await fireEvent.press(screen.getByText("Подтвердить план"));
    await tick(0);
    expect(api.chooseBridge).toHaveBeenCalledWith(50000);
    await tick(0);
    expect(screen.queryByLabelText("Сумма в день")).toBeNull();
  });
});

describe("Today, accessibility and old data", () => {
  it("hides the metal from assistive tech and labels the amount as one phrase", async () => {
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi());
    await screen.findByText("Сегодня можно");
    let node = screen.getByTestId("limit-visual", HIDDEN).parent;
    while (node && node.props.accessibilityElementsHidden !== true) node = node.parent;
    expect(node).toBeTruthy();
    expect(screen.getByLabelText("Сегодня можно ₴720, из ₴1,000 на день")).toBeTruthy();
  });

  it("announces a stale sync as an alert", async () => {
    const stale = todayFixture({ syncStale: true });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => stale) }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("marks figures from an earlier day instead of presenting them as today's", async () => {
    const client = makeClient();
    client.setQueryData(["today"], todayFixture({ date: "2026-11-01" }));
    const api = fakeApi({ today: jest.fn(() => new Promise<never>(() => undefined)) });
    const now = () => new Date("2026-11-02T10:00:00Z");
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} now={now} />, api, client);
    expect(await screen.findByText("Показаны данные за 01.11, не за сегодня.")).toBeTruthy();
  });

  it("a failed first load offers a retry", async () => {
    const api = fakeApi({ today: jest.fn(async () => { throw new Error("offline"); }) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await screen.findByText(/Не получилось загрузить данные/);
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
  });

  it("shows no earlier-day note for today's data", async () => {
    const now = () => new Date("2026-11-02T10:00:00Z");
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} now={now} />, fakeApi());
    await screen.findByText("Сегодня можно");
    expect(screen.queryByText(/не за сегодня/)).toBeNull();
  });
});

describe("Today, loading and offline", () => {
  it("shows a skeleton on first load", async () => {
    const api = fakeApi({ today: jest.fn(() => new Promise(() => undefined)) });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    expect(screen.getByTestId("today-skeleton")).toBeTruthy();
  });

  it("shows a calm retry card when the first load fails", async () => {
    const api = fakeApi({
      today: jest.fn(async () => {
        throw new NetworkError();
      }),
    });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
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
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api, client);
    expect(await screen.findByText(/Нет связи/)).toBeTruthy();
    expect(screen.getByText(/08:30/)).toBeTruthy();
    expect(screen.getByText("₴720")).toBeTruthy();
    expect(levelOf()).toBe("mercury:0.72");
  });

  it("a stale bank sync keeps the limit and shows when it last updated", async () => {
    const stale = todayFixture({ syncStale: true, syncedAt: new Date(2026, 10, 1, 21, 10).toISOString() });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => stale) }));
    expect(await screen.findByText(/01\.11 21:10/)).toBeTruthy();
    expect(screen.getByText("₴720")).toBeTruthy();
    expect(levelOf()).toBe("mercury:0.72");
  });

  it("a stale sync with no sync yet says so", async () => {
    const stale = todayFixture({ syncStale: true, syncedAt: null });
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, fakeApi({ today: jest.fn(async () => stale) }));
    expect(await screen.findByText(/Синхронизации с банком ещё не было/)).toBeTruthy();
    expect(screen.getByText("₴720")).toBeTruthy();
  });
});
