import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import type { InsightsMonthDto } from "@hale/contracts";
import { SubscriptionsSheet, subscriptionsText, swipeRest } from "./SubscriptionsSheet";
import { fakeApi, renderWith } from "../testing";

type Subscriptions = NonNullable<InsightsMonthDto["subscriptions"]>;
type Item = Subscriptions["items"][number];

const item = (name: string, amount: number, over: Partial<Item> = {}): Item => ({
  key: "00000000000000a1",
  name,
  amount,
  lastDate: "2026-10-28",
  raisedBy: 0,
  missed: 0,
  ...over,
});

const subscriptions: Subscriptions = {
  monthly: 188_600,
  items: [
    item("ChatGPT", 83_000),
    item("Netflix", 34_900, { raisedBy: 5_000, lastDate: "2026-10-12" }),
    item("Київстар", 25_000),
    item("Spotify", 19_900),
    item("YouTube Premium", 15_900),
    item("iCloud+", 9_900),
    item("Megogo", 19_900, { missed: 2, lastDate: "2026-08-04" }),
  ],
};

const rowLabels = (id: string) => screen.queryAllByTestId(id).map((r) => r.props.accessibilityLabel as string);

describe("the subscriptions sheet (В4)", () => {
  it("the total a month and the count of active subscriptions under the title", async () => {
    await renderWith(<SubscriptionsSheet subscriptions={subscriptions} onClose={() => undefined} />, fakeApi());
    expect(await screen.findByText("Подписки")).toBeTruthy();
    expect(screen.getByText("₴1,886 в месяц · 6 подписок")).toBeTruthy();
  });

  it("the count declines in Russian", () => {
    expect(subscriptionsText(1)).toBe("1 подписка");
    expect(subscriptionsText(3)).toBe("3 подписки");
    expect(subscriptionsText(5)).toBe("5 подписок");
    expect(subscriptionsText(11)).toBe("11 подписок");
    expect(subscriptionsText(21)).toBe("21 подписка");
  });

  it("lists the active ones with their sums, a raised one with a quiet note naming the month", async () => {
    await renderWith(<SubscriptionsSheet subscriptions={subscriptions} onClose={() => undefined} />, fakeApi());
    await screen.findByText("ChatGPT");
    expect(rowLabels("subscription-row")).toEqual([
      "ChatGPT: ₴830",
      "Netflix: ₴349, подорожала на ₴50 в октябре",
      "Київстар: ₴250",
      "Spotify: ₴199",
      "YouTube Premium: ₴159",
      "iCloud+: ₴99",
    ]);
    expect(screen.getByText("подорожала на ₴50 в октябре")).toBeTruthy();
  });

  it("the ones not charged for a while go apart, with the last date in Russian", async () => {
    await renderWith(<SubscriptionsSheet subscriptions={subscriptions} onClose={() => undefined} />, fakeApi());
    await screen.findByText("Давно не списывались");
    expect(rowLabels("subscription-missed-row")).toEqual(["Megogo: ₴199, последний раз 4 авг"]);
    expect(screen.getByText("последний раз 4 авг")).toBeTruthy();
    const texts = screen.getAllByText(/./).map((t) => t.props.children as unknown);
    expect(texts.indexOf("Megogo")).toBeGreaterThan(texts.indexOf("Давно не списывались"));
    expect(texts.indexOf("Давно не списывались")).toBeGreaterThan(texts.indexOf("iCloud+"));
  });

  it("no section for the missed ones when there are none", async () => {
    const active = { monthly: 83_000, items: [item("ChatGPT", 83_000)] };
    await renderWith(<SubscriptionsSheet subscriptions={active} onClose={() => undefined} />, fakeApi());
    await screen.findByText("ChatGPT");
    expect(screen.getByText("₴830 в месяц · 1 подписка")).toBeTruthy();
    expect(screen.queryByText("Давно не списывались")).toBeNull();
  });

  it("says how they were found", async () => {
    await renderWith(<SubscriptionsSheet subscriptions={subscriptions} onClose={() => undefined} />, fakeApi());
    expect(await screen.findByText("Нашли по повторам: тот же магазин, близкая сумма, примерно раз в месяц.")).toBeTruthy();
  });

  it("two subscriptions at one place both show", async () => {
    const twice = {
      monthly: 40_000,
      items: [item("Apple", 20_000, { lastDate: "2026-10-03" }), item("Apple", 20_000, { lastDate: "2026-10-18" })],
    };
    await renderWith(<SubscriptionsSheet subscriptions={twice} onClose={() => undefined} />, fakeApi());
    await screen.findByText("₴400 в месяц · 2 подписки");
    // One name twice: the date of the last charge tells them apart (Я8).
    expect(rowLabels("subscription-row")).toEqual(["Apple: ₴200, последнее списание 3 окт", "Apple: ₴200, последнее списание 18 окт"]);
  });

  it("a name only once has no date under it; a raised one keeps its note under the date", async () => {
    const mixed = {
      monthly: 60_000,
      items: [
        item("Apple", 20_000, { lastDate: "2026-10-03", raisedBy: 1_000 }),
        item("Apple", 20_000, { lastDate: "2026-10-18" }),
        item("Spotify", 20_000),
        item("Apple", 20_000, { missed: 2, lastDate: "2026-08-04" }),
      ],
    };
    await renderWith(<SubscriptionsSheet subscriptions={mixed} onClose={() => undefined} />, fakeApi());
    await screen.findByText("Spotify");
    expect(rowLabels("subscription-row")).toEqual([
      "Apple: ₴200, последнее списание 3 окт, подорожала на ₴10 в октябре",
      "Apple: ₴200, последнее списание 18 окт",
      "Spotify: ₴200",
    ]);
    expect(rowLabels("subscription-missed-row")).toEqual(["Apple: ₴200, последний раз 4 авг"]);
  });

  it("rows lead nowhere without a way to the operations", async () => {
    await renderWith(<SubscriptionsSheet subscriptions={subscriptions} onClose={() => undefined} />, fakeApi());
    await screen.findByText("ChatGPT");
    expect(screen.queryByRole("button", { name: /ChatGPT/ })).toBeNull();
    expect(screen.queryAllByTestId("row-chevron")).toHaveLength(0);
  });

  it("with a way to the operations, a row closes the sheet and opens its place's (Я8)", async () => {
    const onClose = jest.fn();
    const onOpenPlace = jest.fn();
    await renderWith(<SubscriptionsSheet subscriptions={subscriptions} onClose={onClose} onOpenPlace={onOpenPlace} />, fakeApi());
    expect(await screen.findAllByTestId("row-chevron")).toHaveLength(7);
    await fireEvent.press(screen.getByRole("button", { name: "Spotify: ₴199" }));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenPlace).toHaveBeenCalledWith("00000000000000a1", "Spotify");
  });

  it("closes with «Закрыть»", async () => {
    const onClose = jest.fn();
    await renderWith(<SubscriptionsSheet subscriptions={subscriptions} onClose={onClose} />, fakeApi());
    await fireEvent.press(await screen.findByRole("button", { name: "Закрыть" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("offers «Не показывать такое» only when opened from the phrase of the day (В7)", async () => {
    const onDismiss = jest.fn();
    const { unmount } = await renderWith(<SubscriptionsSheet subscriptions={subscriptions} onClose={() => undefined} />, fakeApi());
    await screen.findByText("Подписки");
    expect(screen.queryByRole("button", { name: "Не показывать такое" })).toBeNull();
    await unmount();
    await renderWith(<SubscriptionsSheet subscriptions={subscriptions} onClose={() => undefined} onDismiss={onDismiss} />, fakeApi());
    await fireEvent.press(await screen.findByRole("button", { name: "Не показывать такое" }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("the sheet of «Сегодня» has no swipe «Не подписка» (ЯМ6 is on «Итоги» only)", async () => {
    await renderWith(<SubscriptionsSheet subscriptions={subscriptions} onClose={() => undefined} />, fakeApi());
    await screen.findByText("Подписки");
    expect(screen.queryAllByTestId("subscription-swipe")).toHaveLength(0);
    expect(screen.queryAllByText("Не подписка", { includeHiddenElements: true })).toHaveLength(0);
  });
});

describe("swipeRest: where a row swiped left comes to rest (ЯМ6)", () => {
  it("goes back from a short swipe, stays open on the button past half of it, marks at once past most of the row", () => {
    expect(swipeRest(0, 358)).toBe("closed");
    expect(swipeRest(-59, 358)).toBe("closed");
    expect(swipeRest(-60, 358)).toBe("open");
    expect(swipeRest(-200, 358)).toBe("open");
    expect(swipeRest(-215, 358)).toBe("full");
    expect(swipeRest(-358, 358)).toBe("full");
  });

  it("a narrow row needs the button and a little more for a full swipe; an unmeasured one never marks at once", () => {
    expect(swipeRest(-183, 200)).toBe("open");
    expect(swipeRest(-184, 200)).toBe("full");
    expect(swipeRest(-1_000, 0)).toBe("open");
  });
});
