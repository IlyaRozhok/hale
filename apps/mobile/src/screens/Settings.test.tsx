import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Settings } from "./Settings";
import { Plan } from "./Plan";
import { fakeApi, makeClient, renderWith, taxFixture, todayFixture } from "../testing";
import { NetworkError } from "../api/client";
import { TODAY_KEY } from "../api/queries";

jest.mock("../metal", () => {
  const { View } = require("react-native");
  return {
    LimitVisual: ({ mode, level }: { mode: string; level: number }) => <View testID="limit-visual" accessibilityHint={`${mode}:${level}`} />,
    MetalBar: ({ level }: { level: number }) => <View testID="limit-visual" accessibilityHint={`bar:${level}`} />,
  };
});
jest.mock("@react-native-community/slider", () => {
  const React = require("react");
  return { __esModule: true, default: (props: object) => React.createElement("Slider", props) };
});

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
    const api = fakeApi({ payments: jest.fn(async () => [taxFixture({ id: 2 })]) });
    // Settings opens over the Plan screen, and both stay mounted while the sheet is up.
    await renderWith(
      <>
        <Settings onClose={noop} />
        <Plan />
      </>,
      api,
    );
    await waitFor(() => expect(api.previewSettings).toHaveBeenCalledTimes(1));
    await fireEvent.press(await screen.findByRole("button", { name: "Займы" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Новый займ" }));
    await fireEvent.changeText(await screen.findByLabelText("Сумма займа"), "100");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить займ" }));
    await waitFor(() => expect(api.previewSettings).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByLabelText("Сумма займа")).toBeNull());
    const closes = screen.getAllByRole("button", { name: "Закрыть" });
    await fireEvent.press(closes[closes.length - 1]!);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Новый займ" })).toBeNull());
    await fireEvent.press(await screen.findByRole("button", { name: "Налоги" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Отметить оплаченным" }));
    await waitFor(() => expect(api.previewSettings).toHaveBeenCalledTimes(3));
  });
});

describe("Settings, closing", () => {
  it("has a close control and only the lifestyle cap", async () => {
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
    await fireEvent(slider, "slidingComplete", 120000);
    await waitFor(() => expect(client.getQueryState(TODAY_KEY)?.isInvalidated).toBe(true));
  });
});
