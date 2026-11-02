import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Settings } from "./Settings";
import { Today } from "./Today";
import { fakeApi, makeClient, renderWith, settingsFixture, taxFixture, todayFixture } from "../testing";
import { NetworkError } from "../api/client";
import { TODAY_KEY } from "../api/queries";

jest.mock("../metal", () => {
  const { View } = require("react-native");
  return { LimitVisual: ({ mode, level }: { mode: string; level: number }) => <View testID="limit-visual" accessibilityHint={`${mode}:${level}`} /> };
});
jest.mock("@react-native-community/slider", () => {
  const React = require("react");
  return { __esModule: true, default: (props: object) => React.createElement("Slider", props) };
});

const HIDDEN = { includeHiddenElements: true };
const visualOf = () => screen.getByTestId("limit-visual", HIDDEN).props.accessibilityHint as string;
const noop = () => undefined;

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
        cap === 15_000_000 ? { dailyLimit: 90000, leftForGoalsMonthly: 1500000 } : { dailyLimit: 50000, leftForGoalsMonthly: 0 },
      ),
    });
    await renderWith(<Settings />, api);
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
    await renderWith(<Settings />, api);
    const slider = await screen.findByLabelText("Потолок трат в месяц");
    await fireEvent(slider, "valueChange", 150000);
    await fireEvent(slider, "slidingComplete", 150000);
    await waitFor(() => expect(api.patchSettings).toHaveBeenCalledWith({ lifestyle_cap: 15_000_000 }));
  });

  it("puts the value back and says so when saving fails", async () => {
    const patchSettings = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(<Settings />, fakeApi({ patchSettings }));
    const slider = await screen.findByLabelText("Потолок трат в месяц");
    await fireEvent(slider, "valueChange", 150000);
    await fireEvent(slider, "slidingComplete", 150000);
    expect(await screen.findByText("Не удалось сохранить. Значение возвращено.")).toBeTruthy();
    expect(screen.getByLabelText("Потолок трат в месяц").props.value).toBe(100000);
  });
});

describe("Settings, limit visual", () => {
  it("switching to the ring changes Today at once, before the server answers", async () => {
    let finish: () => void = noop;
    const patchSettings = jest.fn(() => new Promise<ReturnType<typeof settingsFixture>>((r) => (finish = () => r(settingsFixture({ limit_visual: "ring" })))));
    await renderWith(
      <>
        <Today onOpenActivity={noop} />
        <Settings />
      </>,
      fakeApi({ patchSettings }),
    );
    await waitFor(() => expect(visualOf()).toBe("mercury:0.72"));
    await fireEvent.press(await screen.findByRole("radio", { name: "Кольцо" }));
    await waitFor(() => expect(visualOf()).toBe("ring:0.72"));
    expect(patchSettings).toHaveBeenCalledWith({ limit_visual: "ring" });
    await act(async () => finish());
  });

  it("reverts and shows text when the switch cannot be saved", async () => {
    const patchSettings = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(
      <>
        <Today onOpenActivity={noop} />
        <Settings />
      </>,
      fakeApi({ patchSettings }),
    );
    await waitFor(() => expect(visualOf()).toBe("mercury:0.72"));
    await fireEvent.press(await screen.findByRole("radio", { name: "Кольцо" }));
    expect(await screen.findByText("Не удалось сохранить. Значение возвращено.")).toBeTruthy();
    expect(visualOf()).toBe("mercury:0.72");
    expect(screen.getByRole("radio", { name: "Ртуть" }).props.accessibilityState.selected).toBe(true);
  });
});

describe("Settings, tax payments", () => {
  const payments = () =>
    jest.fn(async () => [
      taxFixture({ id: 1, name: "Налог за 2 кв.", amount: 900_000, due_on: "2026-08-20", paid_at: "2026-08-19T09:00:00.000Z" }),
      taxFixture({ id: 2 }),
      taxFixture({ id: 3, kind: "obligation", name: "Квартплата" }),
    ]);

  it("lists tax payments with sum, due date and a paid mark", async () => {
    await renderWith(<Settings />, fakeApi({ payments: payments() }));
    expect(await screen.findByText("Налог за 3 кв.")).toBeTruthy();
    expect(screen.getByText("₴12,000")).toBeTruthy();
    expect(screen.getByText("срок 20.11")).toBeTruthy();
    expect(screen.getByText("Налог за 2 кв.")).toBeTruthy();
    expect(screen.getByText("₴9,000")).toBeTruthy();
    expect(screen.getByText("Оплачен")).toBeTruthy();
    expect(screen.queryByText("Квартплата")).toBeNull();
  });

  it("marks a payment as paid with one tap and reloads the list", async () => {
    const api = fakeApi({ payments: payments() });
    await renderWith(<Settings />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Отметить оплаченным" }));
    await waitFor(() => expect(api.markPaid).toHaveBeenCalledWith(2));
    await waitFor(() => expect(api.payments.mock.calls.length).toBeGreaterThan(1));
  });

  it("adds a payment for a new quarter", async () => {
    const api = fakeApi({ payments: payments() });
    await renderWith(<Settings />, api);
    await fireEvent.changeText(await screen.findByLabelText("Название платежа"), "Налог за 4 кв.");
    await fireEvent.changeText(screen.getByLabelText("Сумма платежа"), "15 000,50");
    await fireEvent.changeText(screen.getByLabelText("Срок оплаты, ГГГГ-ММ-ДД"), "2027-02-20");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить платёж" }));
    await waitFor(() =>
      expect(api.createPayment).toHaveBeenCalledWith({ kind: "tax", name: "Налог за 4 кв.", amount: 1_500_050, currency: "UAH", due_on: "2027-02-20" }),
    );
    await waitFor(() => expect(screen.getByLabelText("Название платежа").props.value).toBe(""));
  });

  it("does not send an incomplete payment", async () => {
    const api = fakeApi({ payments: payments() });
    await renderWith(<Settings />, api);
    await fireEvent.changeText(await screen.findByLabelText("Название платежа"), "Налог");
    await fireEvent.changeText(screen.getByLabelText("Сумма платежа"), "abc");
    await fireEvent.changeText(screen.getByLabelText("Срок оплаты, ГГГГ-ММ-ДД"), "2027-02-20");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить платёж" }));
    expect(await screen.findByText("Проверьте название, сумму и срок.")).toBeTruthy();
    expect(api.createPayment).not.toHaveBeenCalled();
  });

  it("says so when a payment cannot be saved", async () => {
    const createPayment = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(<Settings />, fakeApi({ payments: payments(), createPayment }));
    await fireEvent.changeText(await screen.findByLabelText("Название платежа"), "Налог");
    await fireEvent.changeText(screen.getByLabelText("Сумма платежа"), "100");
    await fireEvent.changeText(screen.getByLabelText("Срок оплаты, ГГГГ-ММ-ДД"), "2027-02-20");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить платёж" }));
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(screen.getByLabelText("Название платежа").props.value).toBe("Налог");
  });
});

describe("Settings, manual loan", () => {
  it("creates a loan and Today then shows the bad case", async () => {
    const badCase = { id: "loan:1", text: "Взят займ ₴5,000 (02.11): столько не хватало." };
    let created = false;
    const api = fakeApi({
      today: jest.fn(async () => todayFixture({ badCases: created ? [badCase] : [] })),
      createLoan: jest.fn(async () => {
        created = true;
      }),
    });
    await renderWith(
      <>
        <Today onOpenActivity={noop} />
        <Settings />
      </>,
      api,
    );
    await screen.findByText("Сегодня можно");
    expect(screen.queryByText(badCase.text)).toBeNull();
    await fireEvent.changeText(await screen.findByLabelText("Сумма займа"), "5000");
    await fireEvent.changeText(screen.getByLabelText("Дата займа, ГГГГ-ММ-ДД"), "2026-11-02");
    await fireEvent.changeText(screen.getByLabelText("Заметка к займу"), "до зарплаты");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить займ" }));
    await waitFor(() => expect(api.createLoan).toHaveBeenCalledWith({ amount: 500_000, received_on: "2026-11-02", note: "до зарплаты" }));
    expect(await screen.findByText(badCase.text)).toBeTruthy();
    expect(screen.getByText("Займ добавлен.")).toBeTruthy();
  });

  it("rejects a bad amount or date before sending, and reports a failed save", async () => {
    const createLoan = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(<Settings />, fakeApi({ createLoan }));
    await fireEvent.changeText(await screen.findByLabelText("Сумма займа"), "0");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить займ" }));
    expect(await screen.findByText("Проверьте сумму и дату.")).toBeTruthy();
    expect(createLoan).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText("Сумма займа"), "100");
    await fireEvent.changeText(screen.getByLabelText("Дата займа, ГГГГ-ММ-ДД"), "2026-11-02");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить займ" }));
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
  });
});

describe("Settings, refetch of Today", () => {
  it("is refreshed after the cap is saved", async () => {
    const client = makeClient();
    client.setQueryData(TODAY_KEY, todayFixture());
    const api = fakeApi();
    await renderWith(<Settings />, api, client);
    const slider = await screen.findByLabelText("Потолок трат в месяц");
    await fireEvent(slider, "slidingComplete", 120000);
    await waitFor(() => expect(client.getQueryState(TODAY_KEY)?.isInvalidated).toBe(true));
  });
});
