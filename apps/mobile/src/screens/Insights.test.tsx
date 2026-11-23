import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { Pressable, StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import type { CategoryDto, InsightsMonthDto } from "@hale/contracts";
import { Insights } from "./Insights";
import { fakeApi, insightsFixture, makeClient, renderWith } from "../testing";
import { ApiError } from "../api/client";
import { OBSERVATION_KEY, TRANSACTION_FILTERS_KEY, useEditTransaction } from "../api/queries";
import { visitsText } from "../components/PlacesCard";

const now = () => new Date("2026-11-16T10:00:00Z");
const rows = () => screen.getAllByTestId("insights-row").map((r) => r.props.accessibilityLabel as string);
const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style) as { width?: string; backgroundColor?: string };

type Place = NonNullable<InsightsMonthDto["places"]>[number];
const place = (name: string, spent: number, visits: number, isNew = false): Place => ({
  key: `${name.length.toString(16).padStart(2, "0")}${"0".repeat(12)}${visits.toString(16).padStart(2, "0")}`,
  name,
  spent,
  visits,
  isNew,
});
const places = [
  place("Сільпо", 748_000, 1),
  place("АТБ", 421_500, 2),
  place("Aroma Kava", 224_000, 5),
  place("Uklon", 196_000, 11),
  place("Сушия", 138_000, 21, true),
];
type Subscriptions = NonNullable<InsightsMonthDto["subscriptions"]>;
type Sub = Subscriptions["items"][number];
const sub = (name: string, amount: number, over: Partial<Sub> = {}): Sub => ({
  key: "00000000000000b2",
  name,
  amount,
  lastDate: "2026-11-05",
  raisedBy: 0,
  missed: 0,
  ...over,
});
const subscriptions: Subscriptions = {
  monthly: 188_600,
  items: [
    sub("ChatGPT", 83_000),
    sub("Netflix", 34_900, { raisedBy: 5_000 }),
    sub("Київстар", 25_000),
    sub("Spotify", 19_900),
    sub("YouTube Premium", 15_900),
    sub("iCloud+", 9_900),
    sub("Megogo", 19_900, { missed: 2, lastDate: "2026-08-04" }),
  ],
};
const withSubs = (s: Subscriptions | undefined) => fakeApi({ insights: jest.fn(async () => insightsFixture({ subscriptions: s })) });
const placeRows = () => screen.getAllByTestId("place-row").map((r) => r.props.accessibilityLabel as string);

/** A whole past month against the whole month before it. */
const october = (): InsightsMonthDto =>
  insightsFixture({
    month: "2026-10",
    through: "2026-10-31",
    previous: { from: "2026-09-01", to: "2026-09-30" },
    spent: 3_100_000,
    previousSpent: 2_950_000,
    categories: [{ category: "groceries", spent: 3_100_000, previousSpent: 2_950_000, count: 30 }],
  });

// The native segmented control; its segments are buttons, as VoiceOver reads them (the mock in jest.setup).
const tab = (name: string) => screen.getByRole("button", { name });
const segments = () => within(screen.getByTestId("insights-switch")).getAllByRole("button").map((t) => t.props.accessibilityLabel as string);
const texts = () => screen.getAllByText(/./).map((t) => t.props.children as unknown);
/** A client that has seen a page of «Операции» from a server naming the filters of Я8. */
const knowing = (filters: string[] = ["other", "place"]) => {
  const client = makeClient();
  client.setQueryData(TRANSACTION_FILTERS_KEY, filters);
  return client;
};

describe("Insights", () => {
  it("shows the month's spending against the same days of the month before", async () => {
    const insights = jest.fn(async () => insightsFixture());
    await renderWith(<Insights now={now} />, fakeApi({ insights }));
    expect(await screen.findByText("₴18,220")).toBeTruthy();
    expect(screen.getByText("Итоги")).toBeTruthy();
    expect(screen.getByText("Ноябрь, 1–16")).toBeTruthy();
    expect(screen.getByText("потрачено · в октябре за те же дни ₴18,040")).toBeTruthy();
    // The current month is asked for without a month: the server knows the Kyiv day.
    expect(insights).toHaveBeenCalledWith(undefined);
  });

  it("the month line sits under the title, with its arrows on either side", async () => {
    await renderWith(<Insights now={now} />, fakeApi());
    await screen.findByText("₴18,220");
    const t = texts();
    expect(t.indexOf("Ноябрь, 1–16")).toBeGreaterThan(t.indexOf("Итоги"));
    expect(t.indexOf("‹")).toBeLessThan(t.indexOf("Ноябрь, 1–16"));
    expect(t.indexOf("›")).toBeGreaterThan(t.indexOf("Ноябрь, 1–16"));
    expect(t.indexOf("₴18,220")).toBeGreaterThan(t.indexOf("Ноябрь, 1–16"));
  });

  it("each month arrow is a full touch target, 44 by 44", async () => {
    await renderWith(<Insights now={now} />, fakeApi());
    await screen.findByText("₴18,220");
    for (const name of ["Предыдущий месяц", "Следующий месяц"]) {
      const s = StyleSheet.flatten(screen.getByRole("button", { name }).props.style) as { minWidth?: number; minHeight?: number };
      expect(s.minWidth).toBeGreaterThanOrEqual(tokens.touchMin);
      expect(s.minHeight).toBeGreaterThanOrEqual(tokens.touchMin);
    }
  });

  it("lists every category in the server's order, with no fold", async () => {
    await renderWith(<Insights now={now} />, fakeApi());
    await screen.findByText("₴18,220");
    expect(rows()).toEqual([
      "Продукты: ₴8,800",
      "Кафе и рестораны: ₴3,200",
      "Транспорт: ₴2,150",
      "Подписки: ₴1,640",
      "Досуг: ₴1,380",
      "Здоровье: ₴600",
      "Коммунальные: ₴400",
      "Связь: ₴300",
      "Возвраты: −₴250",
    ]);
    expect(screen.queryByText(/^Ещё/)).toBeNull();
  });

  it("a category spent on only in the month before has no row", async () => {
    await renderWith(<Insights now={now} />, fakeApi());
    await screen.findByText("₴18,220");
    expect(screen.queryByText("Покупки")).toBeNull();
  });

  it("each category row has an icon and a chevron", async () => {
    await renderWith(<Insights now={now} />, fakeApi());
    await screen.findByText("₴18,220");
    expect(screen.getByTestId("insights-icon-groceries")).toBeTruthy();
    expect(screen.getAllByTestId("row-chevron")).toHaveLength(9);
  });

  it("one sage bar per row, the share of this month's largest category; no bar for the month before", async () => {
    await renderWith(<Insights now={now} />, fakeApi());
    await screen.findByText("₴18,220");
    expect(flat("bar-now-groceries").width).toBe("100%");
    expect(flat("bar-now-cafe").width).toBe(`${(320_000 / 880_000) * 100}%`);
    expect(flat("bar-now-groceries").backgroundColor).toBe(tokens.color.accent.signal);
    expect(screen.queryByTestId("bar-before-groceries")).toBeNull();
    expect(screen.queryAllByTestId(/^bar-before-/)).toHaveLength(0);
  });

  it("a refund below zero shows its sum with a minus and no bar going backwards; nothing is red", async () => {
    const insights = jest.fn(async () =>
      insightsFixture({
        spent: -15_000,
        previousSpent: 10_000,
        categories: [
          { category: "groceries", spent: 10_000, previousSpent: 10_000, count: 1 },
          { category: "cafe", spent: 0, previousSpent: 0, count: 2 },
          { category: "refund", spent: -25_000, previousSpent: 0, count: 1 },
        ],
      }),
    );
    await renderWith(<Insights now={now} />, fakeApi({ insights }));
    expect(await screen.findByText("−₴150")).toBeTruthy();
    expect(rows()).toEqual(["Продукты: ₴100", "Кафе и рестораны: ₴0", "Возвраты: −₴250"]);
    expect(screen.getByText("−₴250")).toBeTruthy();
    expect(screen.queryByTestId("bar-now-refund")).toBeNull();
    expect(screen.queryByTestId("bar-now-cafe")).toBeNull();
    for (const t of screen.getAllByText(/./)) {
      const c = ((StyleSheet.flatten(t.props.style) ?? {}) as { color?: string }).color;
      expect([tokens.color.status.danger, tokens.color.money.expense]).not.toContain(c);
    }
  });

  describe("payments outside the limit (В2а)", () => {
    it("a row «Платежи вне лимита» in a second list under the categories; not a button while the server has no such filter", async () => {
      await renderWith(<Insights now={now} onOpenOther={jest.fn()} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ otherPayments: 1_870_500 })) }));
      const row = await screen.findByTestId("other-payments-row");
      expect(screen.getByText("Платежи вне лимита")).toBeTruthy();
      expect(screen.getByText("₴18,705")).toBeTruthy();
      expect(row.props.accessibilityLabel).toBe("Платежи вне лимита: ₴18,705");
      expect(row.props.accessibilityRole).toBeUndefined();
      expect(row.props.onPress).toBeUndefined();
      expect(screen.queryByRole("button", { name: /Платежи/ })).toBeNull();
      // «Потрачено» stays the limit's.
      expect(screen.getByText("₴18,220")).toBeTruthy();
      expect(texts().indexOf("Платежи вне лимита")).toBeGreaterThan(texts().indexOf("Связь"));
      // Still one chevron per category, none on this row.
      expect(screen.getAllByTestId("row-chevron")).toHaveLength(9);
      expect(screen.queryByText(/Ещё платежи/)).toBeNull();
    });

    it("a button with a chevron once the server takes the filter (Я8): leads to these payments over the month's days", async () => {
      const onOpenOther = jest.fn();
      await renderWith(
        <Insights now={now} onOpenOther={onOpenOther} />,
        fakeApi({ insights: jest.fn(async () => insightsFixture({ otherPayments: 1_870_500 })) }),
        knowing(),
      );
      const row = await screen.findByRole("button", { name: "Платежи вне лимита: ₴18,705" });
      expect(screen.getAllByTestId("row-chevron")).toHaveLength(10);
      await fireEvent.press(row);
      expect(onOpenOther).toHaveBeenCalledWith("2026-11-01", "2026-11-16");
    });

    it("not a button when the server names only the place filter", async () => {
      await renderWith(
        <Insights now={now} onOpenOther={jest.fn()} />,
        fakeApi({ insights: jest.fn(async () => insightsFixture({ otherPayments: 1_870_500 })) }),
        knowing(["place"]),
      );
      await screen.findByTestId("other-payments-row");
      expect(screen.queryByRole("button", { name: /Платежи/ })).toBeNull();
    });

    it("no row when there were no such payments", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ otherPayments: 0 })) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByText("Платежи вне лимита")).toBeNull();
    });

    it("no row from an older server's answer without the field", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture()) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByText("Платежи вне лимита")).toBeNull();
    });

    it("the row shows in a month with no spending from the limit too", async () => {
      await renderWith(
        <Insights now={now} />,
        fakeApi({ insights: jest.fn(async () => insightsFixture({ spent: 0, previousSpent: 0, categories: [], otherPayments: 795_000 })) }),
      );
      expect(await screen.findByText("Трат пока нет.")).toBeTruthy();
      expect(screen.getByTestId("other-payments-row").props.accessibilityLabel).toBe("Платежи вне лимита: ₴7,950");
    });
  });

  it("a quiet line for a month with no spending yet", async () => {
    await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ spent: 0, previousSpent: 0, categories: [] })) }));
    expect(await screen.findByText("Трат пока нет.")).toBeTruthy();
    expect(screen.getByText("потрачено")).toBeTruthy();
    // Nothing to switch between.
    expect(screen.queryByTestId("insights-switch")).toBeNull();
  });

  it("an older server without «Итоги»: one calm line instead of the screen", async () => {
    await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => null) }));
    expect(await screen.findByText("Итоги появятся после обновления сервера.")).toBeTruthy();
    expect(screen.queryByTestId("insights-switch")).toBeNull();
    expect(screen.queryByRole("button", { name: "Предыдущий месяц" })).toBeNull();
  });

  it("another failure: the usual words and a retry", async () => {
    const insights = jest.fn().mockRejectedValueOnce(new ApiError(500)).mockResolvedValue(insightsFixture());
    await renderWith(<Insights now={now} />, fakeApi({ insights }));
    expect(await screen.findByText("Не получилось загрузить итоги. Проверьте связь и попробуйте ещё раз.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("₴18,220")).toBeTruthy();
  });

  it("a category leads to its operations over the month's days", async () => {
    const onOpenCategory = jest.fn();
    const categories = [
      { category: "groceries", spent: 880_000, previousSpent: 900_000, count: 12 },
      { category: "uncategorized", spent: 10_000, previousSpent: 0, count: 1 },
    ];
    await renderWith(<Insights now={now} onOpenCategory={onOpenCategory} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ categories })) }));
    await fireEvent.press(await screen.findByRole("button", { name: "Продукты: ₴8,800" }));
    expect(onOpenCategory).toHaveBeenLastCalledWith("groceries", "2026-11-01", "2026-11-16");
    await fireEvent.press(screen.getByRole("button", { name: "Без категории: ₴100" }));
    expect(onOpenCategory).toHaveBeenLastCalledWith("uncategorized", "2026-11-01", "2026-11-16");
  });

  it("goes back to earlier months and forward again, never past the current one", async () => {
    const onOpenCategory = jest.fn();
    const insights = jest.fn(async (month?: string) => (month === "2026-10" ? october() : insightsFixture()));
    await renderWith(<Insights now={now} onOpenCategory={onOpenCategory} />, fakeApi({ insights }));
    await screen.findByText("₴18,220");
    const next = screen.getByRole("button", { name: "Следующий месяц" });
    expect(next.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(next);

    await fireEvent.press(screen.getByRole("button", { name: "Предыдущий месяц" }));
    expect(await screen.findByText("потрачено · в сентябре ₴29,500")).toBeTruthy();
    expect(screen.getAllByText("₴31,000")).toHaveLength(2); // the month and its one category
    expect(insights).toHaveBeenLastCalledWith("2026-10");
    expect(screen.getByText("Октябрь")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Продукты: ₴31,000" }));
    expect(onOpenCategory).toHaveBeenLastCalledWith("groceries", "2026-10-01", "2026-10-31");

    expect(screen.getByRole("button", { name: "Следующий месяц" }).props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(screen.getByRole("button", { name: "Следующий месяц" }));
    expect(await screen.findByText("₴18,220")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Следующий месяц" }).props.accessibilityState.disabled).toBe(true);
    const asked = insights.mock.calls.map(([m]) => m);
    expect(asked.every((m) => m === undefined || m < "2026-11")).toBe(true);
  });

  it("a category or type changed on an operation is counted again", async () => {
    function Edit() {
      const edit = useEditTransaction();
      return <Pressable accessibilityRole="button" accessibilityLabel="Сменить" onPress={() => edit.mutate({ id: 1, patch: { category: "cafe", applyToSimilar: false } })} />;
    }
    const insights = jest.fn(async () => insightsFixture());
    await renderWith(
      <>
        <Insights now={now} />
        <Edit />
      </>,
      fakeApi({ insights }),
    );
    await screen.findByText("₴18,220");
    expect(insights).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("button", { name: "Сменить" }));
    await waitFor(() => expect(insights).toHaveBeenCalledTimes(2));
  });

  it("a month of another year carries its year", async () => {
    const january = () => new Date("2027-01-05T10:00:00Z");
    const insights = jest.fn(async (month?: string) =>
      month === "2026-12"
        ? insightsFixture({ month: "2026-12", through: "2026-12-31", previous: { from: "2026-11-01", to: "2026-11-30" } })
        : insightsFixture({ month: "2027-01", through: "2027-01-05", previous: { from: "2026-12-01", to: "2026-12-05" } }),
    );
    await renderWith(<Insights now={january} />, fakeApi({ insights }));
    expect(await screen.findByText("потрачено · в декабре за те же дни ₴18,040")).toBeTruthy();
    expect(screen.getByText("Январь, 1–5")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Предыдущий месяц" }));
    // December's own data, not the subtitle the loading state shows too.
    expect(await screen.findByText("потрачено · в ноябре ₴18,040")).toBeTruthy();
    expect(screen.getByText("Декабрь 2026")).toBeTruthy();
    expect(insights).toHaveBeenLastCalledWith("2026-12");
  });

  describe("the switch «Категории · Места · Подписки»", () => {
    const full = () => fakeApi({ insights: jest.fn(async () => insightsFixture({ places, subscriptions, otherPayments: 1_870_500, wanted: 360_000 })) });

    it("three segments, «Категории» chosen by default", async () => {
      await renderWith(<Insights now={now} />, full());
      await screen.findByText("₴18,220");
      expect(segments()).toEqual(["Категории", "Места", "Подписки"]);
      expect(tab("Категории").props.accessibilityState.selected).toBe(true);
      expect(tab("Места").props.accessibilityState.selected).toBe(false);
      expect(rows()).toHaveLength(9);
      expect(screen.queryByTestId("place-row")).toBeNull();
      expect(screen.queryByText("ChatGPT")).toBeNull();
      // Above the list, under the month's sum.
      expect(texts().indexOf("Места")).toBeGreaterThan(texts().indexOf("₴18,220"));
      expect(texts().indexOf("Места")).toBeLessThan(texts().indexOf("Продукты"));
    });

    it("switches to the places and the subscriptions, and back; the second list is only under the categories", async () => {
      await renderWith(<Insights now={now} />, full());
      await screen.findByText("₴18,220");
      await fireEvent.press(tab("Места"));
      expect(tab("Места").props.accessibilityState.selected).toBe(true);
      expect(screen.queryAllByTestId("insights-row")).toHaveLength(0);
      expect(placeRows()).toHaveLength(5);
      expect(screen.queryByText("Для себя")).toBeNull();
      expect(screen.queryByText("Платежи вне лимита")).toBeNull();

      await fireEvent.press(tab("Подписки"));
      expect(screen.queryAllByTestId("place-row")).toHaveLength(0);
      expect(screen.getByText("ChatGPT")).toBeTruthy();
      expect(screen.queryByText("Платежи вне лимита")).toBeNull();

      await fireEvent.press(tab("Категории"));
      expect(rows()).toHaveLength(9);
      expect(screen.getByText("Платежи вне лимита")).toBeTruthy();
      expect(screen.getByText("Для себя")).toBeTruthy();
    });

    it("the chosen segment stands out without colour: the native control, dark, with no tint (no blue, no red)", async () => {
      await renderWith(<Insights now={now} />, full());
      await screen.findByText("₴18,220");
      // The mock reports the appearance and any tint the screen sets.
      expect(screen.getByTestId("insights-switch").props.accessibilityHint).toBe("dark");
    });

    it("a segment with nothing in it is not offered", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places })) }));
      await screen.findByText("₴18,220");
      expect(segments()).toEqual(["Категории", "Места"]);
    });

    it("an older server with neither places nor subscriptions: no switch, only the categories", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture()) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByTestId("insights-switch")).toBeNull();
      expect(rows()).toHaveLength(9);
    });

    it("a month without the chosen list goes back to the categories", async () => {
      const insights = jest.fn(async (month?: string) => (month === "2026-10" ? october() : insightsFixture({ places })));
      await renderWith(<Insights now={now} />, fakeApi({ insights }));
      await screen.findByText("₴18,220");
      await fireEvent.press(tab("Места"));
      await fireEvent.press(screen.getByRole("button", { name: "Предыдущий месяц" }));
      expect(await screen.findByRole("button", { name: "Продукты: ₴31,000" })).toBeTruthy();
      expect(screen.queryByTestId("place-row")).toBeNull();
    });
  });

  describe("places of the month (В3)", () => {
    const open = async (api = fakeApi({ insights: jest.fn(async () => insightsFixture({ places })) })) => {
      await renderWith(<Insights now={now} />, api);
      await screen.findByText("₴18,220");
      await fireEvent.press(tab("Места"));
    };

    it("rows: name, visits declined in Russian as a second line, sum", async () => {
      await open();
      expect(placeRows()).toEqual([
        "Сільпо, 1 раз: ₴7,480",
        "АТБ, 2 раза: ₴4,215",
        "Aroma Kava, 5 раз: ₴2,240",
        "Uklon, 11 раз: ₴1,960",
        "Сушия, новое, 21 раз: ₴1,380",
      ]);
      expect(screen.getByText("Сільпо")).toBeTruthy();
      expect(screen.getByText("1 раз")).toBeTruthy();
      expect(screen.getByText("2 раза")).toBeTruthy();
      expect(screen.getByText("21 раз")).toBeTruthy();
      expect(screen.getByText("₴7,480")).toBeTruthy();
      expect(screen.getAllByTestId("place-icon")).toHaveLength(5);
    });

    it("visits decline like the rest of the app's counts", () => {
      expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(visitsText)).toEqual([
        "1 раз",
        "2 раза",
        "4 раза",
        "5 раз",
        "11 раз",
        "12 раз",
        "14 раз",
        "21 раз",
        "22 раза",
        "25 раз",
        "101 раз",
        "111 раз",
      ]);
    });

    it("the tag «новое» only on a new place, grey, no colour", async () => {
      await open();
      const tags = screen.getAllByText("новое");
      expect(tags).toHaveLength(1);
      expect((StyleSheet.flatten(tags[0]!.props.style) as { color?: string }).color).toBe(tokens.color.fg.muted);
      expect(placeRows().filter((r) => r.includes("новое"))).toEqual(["Сушия, новое, 21 раз: ₴1,380"]);
      for (const t of screen.getAllByText(/./)) {
        const c = ((StyleSheet.flatten(t.props.style) ?? {}) as { color?: string }).color;
        expect([tokens.color.status.danger, tokens.color.money.expense]).not.toContain(c);
      }
    });

    it("rows are not buttons, have no chevron and lead nowhere: «Операции» has no place filter yet", async () => {
      const onOpenCategory = jest.fn();
      await renderWith(<Insights now={now} onOpenCategory={onOpenCategory} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places })) }));
      await screen.findByText("₴18,220");
      await fireEvent.press(tab("Места"));
      for (const r of screen.getAllByTestId("place-row")) {
        expect(r.props.accessibilityRole).toBeUndefined();
        expect(r.props.onPress).toBeUndefined();
      }
      expect(screen.queryByRole("button", { name: /Сільпо|АТБ|Aroma|Uklon|Сушия/ })).toBeNull();
      expect(screen.queryAllByTestId("row-chevron")).toHaveLength(0);
      await fireEvent.press(screen.getByText("Сільпо"));
      expect(onOpenCategory).not.toHaveBeenCalled();
    });

    it("a solid card, not glass", async () => {
      await open();
      const card = StyleSheet.flatten(screen.getByTestId("places-card").props.style) as { backgroundColor?: string };
      expect(card.backgroundColor).toBe(tokens.color.card.fill);
    });

    it("no segment from an older server's answer without the field, nor when there were no places", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places: [], subscriptions })) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByRole("button", { name: "Места" })).toBeNull();
      expect(screen.queryByTestId("places-card")).toBeNull();
    });

    it("the places change with the month", async () => {
      const insights = jest.fn(async (month?: string) =>
        month === "2026-10" ? { ...october(), places: [place("Novus", 310_000, 22)] } : insightsFixture({ places }),
      );
      await open(fakeApi({ insights }));
      await fireEvent.press(screen.getByRole("button", { name: "Предыдущий месяц" }));
      expect(await screen.findByText("Novus")).toBeTruthy();
      expect(placeRows()).toEqual(["Novus, 22 раза: ₴3,100"]);
      expect(screen.queryByText("Сільпо")).toBeNull();
    });
  });

  describe("subscriptions of the month (В4), in place of the sheet", () => {
    const open = async (s: Subscriptions) => {
      await renderWith(<Insights now={now} />, withSubs(s));
      await screen.findByText("₴18,220");
      await fireEvent.press(tab("Подписки"));
    };

    it("the total a month first, then the charged ones, then apart the ones not charged for a while", async () => {
      await open(subscriptions);
      expect(screen.getByText("₴1,886 в месяц · 6 подписок")).toBeTruthy();
      expect(screen.getAllByTestId("subscription-row").map((r) => r.props.accessibilityLabel as string)).toEqual([
        "ChatGPT: ₴830",
        "Netflix: ₴349, подорожала на ₴50 в ноябре",
        "Київстар: ₴250",
        "Spotify: ₴199",
        "YouTube Premium: ₴159",
        "iCloud+: ₴99",
      ]);
      expect(screen.getByText("Давно не списывались")).toBeTruthy();
      expect(screen.getAllByTestId("subscription-missed-row").map((r) => r.props.accessibilityLabel as string)).toEqual([
        "Megogo: ₴199, последний раз 4 авг",
      ]);
      const t = texts();
      expect(t.indexOf("₴1,886 в месяц · 6 подписок")).toBeLessThan(t.indexOf("ChatGPT"));
      expect(t.indexOf("Давно не списывались")).toBeGreaterThan(t.indexOf("iCloud+"));
      // On the screen itself, not in a sheet: no «Закрыть».
      expect(screen.queryByRole("button", { name: "Закрыть" })).toBeNull();
    });

    it("rows are not buttons and have no chevron while the server has no place filter", async () => {
      await renderWith(<Insights now={now} onOpenPlace={jest.fn()} />, withSubs(subscriptions));
      await screen.findByText("₴18,220");
      await fireEvent.press(tab("Подписки"));
      for (const r of [...screen.getAllByTestId("subscription-row"), ...screen.getAllByTestId("subscription-missed-row")]) {
        expect(r.props.accessibilityRole).toBeUndefined();
        expect(r.props.onPress).toBeUndefined();
      }
      expect(screen.queryAllByTestId("row-chevron")).toHaveLength(0);
    });

    it("once the server takes the place filter, a row is a button to that place's operations (Я8)", async () => {
      const onOpenPlace = jest.fn();
      await renderWith(<Insights now={now} onOpenPlace={onOpenPlace} />, withSubs(subscriptions), knowing());
      await screen.findByText("₴18,220");
      await fireEvent.press(tab("Подписки"));
      const rows = [...screen.getAllByTestId("subscription-row"), ...screen.getAllByTestId("subscription-missed-row")];
      for (const r of rows) expect(r.props.accessibilityRole).toBe("button");
      expect(screen.getAllByTestId("row-chevron")).toHaveLength(7);
      await fireEvent.press(screen.getByRole("button", { name: "Netflix: ₴349, подорожала на ₴50 в ноябре" }));
      expect(onOpenPlace).toHaveBeenCalledWith("00000000000000b2", "Netflix");
      await fireEvent.press(screen.getByRole("button", { name: "Megogo: ₴199, последний раз 4 авг" }));
      expect(onOpenPlace).toHaveBeenLastCalledWith("00000000000000b2", "Megogo");
    });

    it("several subscriptions under one name differ by their last charge (Я8)", async () => {
      const apple = {
        monthly: 63_700,
        items: [
          sub("Apple", 49_900, { key: "00000000000000a1", lastDate: "2026-11-12" }),
          sub("Apple", 9_900, { key: "00000000000000a1", lastDate: "2026-11-03" }),
          sub("Apple", 3_900, { key: "00000000000000a1", lastDate: "2026-11-08" }),
          sub("Spotify", 19_900),
        ],
      };
      await open(apple);
      expect(screen.getAllByTestId("subscription-row").map((r) => r.props.accessibilityLabel as string)).toEqual([
        "Apple: ₴499, последнее списание 12 ноя",
        "Apple: ₴99, последнее списание 3 ноя",
        "Apple: ₴39, последнее списание 8 ноя",
        "Spotify: ₴199",
      ]);
      expect(screen.getByText("последнее списание 12 ноя")).toBeTruthy();
    });

    it("no «Не показывать такое» here: that is the observation's", async () => {
      await open(subscriptions);
      expect(screen.queryByText("Не показывать такое")).toBeNull();
    });

    it("a solid card, not glass, with no red", async () => {
      await open(subscriptions);
      for (const id of ["subscriptions-active-card", "subscriptions-missed-card"]) {
        const card = StyleSheet.flatten(screen.getByTestId(id).props.style) as { backgroundColor?: string };
        expect(card.backgroundColor).toBe(tokens.color.card.fill);
      }
      for (const t of screen.getAllByText(/./)) {
        const c = ((StyleSheet.flatten(t.props.style) ?? {}) as { color?: string }).color;
        expect([tokens.color.status.danger, tokens.color.money.expense]).not.toContain(c);
      }
    });

    it("no segment from an older server's answer without the field", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places })) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByRole("button", { name: "Подписки" })).toBeNull();
    });

    it("no segment when none were found", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places, subscriptions: { monthly: 0, items: [] } })) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByRole("button", { name: "Подписки" })).toBeNull();
    });

    it("no segment when every one found has stopped being charged", async () => {
      const gone = { monthly: 0, items: [sub("Megogo", 19_900, { missed: 2 })] };
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places, subscriptions: gone })) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByRole("button", { name: "Подписки" })).toBeNull();
      expect(screen.queryByText(/Megogo/)).toBeNull();
    });
  });

  describe("«Не подписка» (ЯМ6)", () => {
    const ROZETKA = "00000000000000c3";
    const found = (): Sub[] => [
      sub("Netflix", 44_900, { key: "00000000000000a1" }),
      sub("Spotify", 19_900, { key: "00000000000000a2" }),
      sub("Rozetka", 129_900, { key: ROZETKA, lastDate: "2026-11-14" }),
      sub("Rozetka", 49_900, { key: ROZETKA, lastDate: "2026-11-02" }),
      sub("Apple", 37_900, { key: "00000000000000a4" }),
    ];
    /** A server that remembers the marks and answers without the marked places, its total a month summed again. */
    const remembering = (canMark: boolean | "absent" = true) => {
      const marked = new Set<string>();
      const month = () => {
        const items = found().filter((i) => !marked.has(i.key));
        return insightsFixture({ subscriptions: { monthly: items.reduce((s, i) => s + i.amount, 0), items }, ...(canMark === "absent" ? {} : { canMarkNotSubscription: canMark }) });
      };
      return fakeApi({
        insights: jest.fn(async () => month()),
        markNotSubscription: jest.fn(async (key: string) => void marked.add(key)),
        unmarkNotSubscription: jest.fn(async (key: string) => void marked.delete(key)),
      });
    };
    const open = async (api: ReturnType<typeof fakeApi>, client = makeClient(), onOpenPlace?: jest.Mock) => {
      await renderWith(<Insights now={now} onOpenPlace={onOpenPlace} />, api, client);
      await screen.findByText("₴18,220");
      await fireEvent.press(tab("Подписки"));
      await screen.findByText("₴2,825 в месяц · 5 подписок");
    };
    const names = () => screen.getAllByTestId("subscription-row").map((r) => r.props.accessibilityLabel as string);
    const row = (name: string) => screen.getAllByTestId("subscription-row").find((r) => (r.props.accessibilityLabel as string).startsWith(name))!;
    const swipe = (n: number) => screen.getAllByTestId("subscription-swipe")[n]!;
    /** A finger from the right of the row to `toX`, the row being 358 points wide. */
    const drag = async (target: ReturnType<typeof swipe>, toX: number) => {
      await fireEvent(target, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 358, height: 52 } } });
      await fireEvent(target, "touchStart", { nativeEvent: { pageX: 300, pageY: 400 } });
      expect(target.props.onMoveShouldSetResponderCapture({ nativeEvent: { pageX: 290, pageY: 401 } })).toBe(true);
      await fireEvent(target, "responderGrant", { nativeEvent: { pageX: 290, pageY: 401 } });
      await fireEvent(target, "responderMove", { nativeEvent: { pageX: toX, pageY: 402 } });
      await fireEvent(target, "responderRelease", { nativeEvent: { pageX: toX, pageY: 402 } });
    };

    it("an older server, or one that does not say it remembers: no swipe and no VoiceOver action", async () => {
      for (const canMark of ["absent", false] as const) {
        const { unmount } = await renderWith(<Insights now={now} />, remembering(canMark));
        await screen.findByText("₴18,220");
        await fireEvent.press(tab("Подписки"));
        expect(screen.queryAllByTestId("subscription-swipe")).toHaveLength(0);
        expect(screen.queryAllByText("Не подписка", { includeHiddenElements: true })).toHaveLength(0);
        for (const r of screen.getAllByTestId("subscription-row")) expect(r.props.accessibilityActions).toBeUndefined();
        await unmount();
      }
    });

    it("a swipe left shows a calm grey «Не подписка»; it marks the place and every row of it leaves, the total summed again", async () => {
      const api = remembering();
      await open(api);
      // Closed, the button is hidden from VoiceOver: the row's own action does it there.
      expect(screen.queryByRole("button", { name: "Не подписка" })).toBeNull();
      await drag(swipe(2), 180);
      const button = await screen.findByRole("button", { name: "Не подписка" });
      const fill = StyleSheet.flatten(screen.getByTestId("not-subscription-button").props.style) as { backgroundColor?: string };
      expect(fill.backgroundColor).toBe(tokens.color.surface.overlay);
      const text = StyleSheet.flatten(screen.getAllByText("Не подписка")[0]!.props.style) as { color?: string };
      expect([tokens.color.status.danger, tokens.color.money.expense]).not.toContain(text.color);
      expect(api.markNotSubscription).not.toHaveBeenCalled();
      await fireEvent.press(button);
      expect(api.markNotSubscription).toHaveBeenCalledWith(ROZETKA);
      expect(await screen.findByText("₴1,027 в месяц · 3 подписки")).toBeTruthy();
      expect(names()).toEqual(["Netflix: ₴449", "Spotify: ₴199", "Apple: ₴379"]);
      expect(screen.getByText("Убрали из подписок")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Вернуть" })).toBeTruthy();
    });

    it("a full swipe marks at once, with no second tap", async () => {
      const api = remembering();
      await open(api);
      await drag(swipe(0), 20);
      await waitFor(() => expect(api.markNotSubscription).toHaveBeenCalledWith("00000000000000a1"));
      expect(await screen.findByText("Убрали из подписок")).toBeTruthy();
      await waitFor(() => expect(names()).not.toContain("Netflix: ₴449"));
    });

    it("a short swipe goes back and marks nothing", async () => {
      const api = remembering();
      await open(api);
      await drag(swipe(1), 270);
      expect(screen.queryByRole("button", { name: "Не подписка" })).toBeNull();
      expect(api.markNotSubscription).not.toHaveBeenCalled();
    });

    it("VoiceOver: the row's action «Не подписка» does what the swipe does", async () => {
      const api = remembering();
      await open(api);
      const r = row("Spotify");
      expect(r.props.accessibilityActions).toEqual([{ name: "notSubscription", label: "Не подписка" }]);
      await fireEvent(r, "accessibilityAction", { nativeEvent: { actionName: "notSubscription" } });
      expect(api.markNotSubscription).toHaveBeenCalledWith("00000000000000a2");
      expect(await screen.findByText("Убрали из подписок")).toBeTruthy();
    });

    it("«Вернуть» takes the mark back and the rows return as they were", async () => {
      const api = remembering();
      await open(api);
      await fireEvent(row("Rozetka"), "accessibilityAction", { nativeEvent: { actionName: "notSubscription" } });
      await screen.findByText("₴1,027 в месяц · 3 подписки");
      await fireEvent.press(screen.getByRole("button", { name: "Вернуть" }));
      expect(api.unmarkNotSubscription).toHaveBeenCalledWith(ROZETKA);
      expect(await screen.findByText("₴2,825 в месяц · 5 подписок")).toBeTruthy();
      expect(names()).toEqual([
        "Netflix: ₴449",
        "Spotify: ₴199",
        "Rozetka: ₴1,299, последнее списание 14 ноя",
        "Rozetka: ₴499, последнее списание 2 ноя",
        "Apple: ₴379",
      ]);
      expect(screen.queryByText("Убрали из подписок")).toBeNull();
    });

    it("the floating line leaves by itself after 5 seconds", async () => {
      jest.useFakeTimers();
      try {
        const api = remembering();
        await open(api);
        await fireEvent(row("Apple"), "accessibilityAction", { nativeEvent: { actionName: "notSubscription" } });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(0);
        });
        expect(screen.getByText("Убрали из подписок")).toBeTruthy();
        await act(async () => {
          await jest.advanceTimersByTimeAsync(4_900);
        });
        expect(screen.getByText("Убрали из подписок")).toBeTruthy();
        await act(async () => {
          await jest.advanceTimersByTimeAsync(200);
        });
        expect(screen.queryByText("Убрали из подписок")).toBeNull();
        expect(api.unmarkNotSubscription).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("a tap on the row still opens the place's operations (Я8)", async () => {
      const onOpenPlace = jest.fn();
      await open(remembering(), knowing(), onOpenPlace);
      await fireEvent.press(row("Netflix"));
      expect(onOpenPlace).toHaveBeenCalledWith("00000000000000a1", "Netflix");
    });

    it("the last subscription marked: the segment goes, the line with «Вернуть» stays", async () => {
      const api = fakeApi({
        insights: jest.fn()
          .mockResolvedValueOnce(insightsFixture({ subscriptions: { monthly: 19_900, items: [sub("Spotify", 19_900)] }, canMarkNotSubscription: true }))
          .mockResolvedValue(insightsFixture({ subscriptions: { monthly: 0, items: [] }, canMarkNotSubscription: true })),
      });
      await renderWith(<Insights now={now} />, api);
      await screen.findByText("₴18,220");
      await fireEvent.press(tab("Подписки"));
      await fireEvent(row("Spotify"), "accessibilityAction", { nativeEvent: { actionName: "notSubscription" } });
      await waitFor(() => expect(screen.queryByRole("button", { name: "Подписки" })).toBeNull());
      expect(screen.getByRole("button", { name: "Вернуть" })).toBeTruthy();
    });

    it("the mark refreshes «Итоги» and the observation of «Сегодня»", async () => {
      const client = makeClient();
      client.setQueryData(OBSERVATION_KEY, { kind: "subscriptions", category: null, text: "x" });
      const api = remembering();
      await open(api, client);
      await fireEvent(row("Netflix"), "accessibilityAction", { nativeEvent: { actionName: "notSubscription" } });
      await waitFor(() => expect(client.getQueryState(OBSERVATION_KEY)?.isInvalidated).toBe(true));
      await waitFor(() => expect(api.insights.mock.calls.length).toBeGreaterThan(1));
    });

    it("when the server refuses, the row stays and a calm line says so, with no «Вернуть»", async () => {
      const api = remembering();
      api.markNotSubscription.mockRejectedValueOnce(new ApiError(500));
      await open(api);
      await fireEvent(row("Netflix"), "accessibilityAction", { nativeEvent: { actionName: "notSubscription" } });
      expect(await screen.findByText("Не получилось убрать из подписок. Попробуйте ещё раз.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Вернуть" })).toBeNull();
      expect(names()).toContain("Netflix: ₴449");
    });
  });

  describe("own categories (В5)", () => {
    const LIST: CategoryDto[] = [
      { key: "groceries", name: "Еда", icon: "cart", system: false },
      { key: "uncategorized", name: "Без категории", icon: "circle", system: true },
    ];
    const month = () => insightsFixture({ categories: [{ category: "groceries", spent: 880_000, previousSpent: 900_000, count: 12 }] });

    it("names the categories as the server does", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => month()), categories: jest.fn(async () => LIST) }));
      expect(await screen.findByRole("button", { name: "Еда: ₴8,800" })).toBeTruthy();
    });

    it("an older server keeps today's names and has no «Править»", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => month()), categories: jest.fn(async () => null) }));
      expect(await screen.findByRole("button", { name: "Продукты: ₴8,800" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Править" })).toBeNull();
      expect(screen.queryByText("Изменить категории")).toBeNull();
    });

    it("«Править» in the corner, above the title, opens «Категории»", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => month()), categories: jest.fn(async () => LIST) }));
      await screen.findByRole("button", { name: "Еда: ₴8,800" });
      const edit = await screen.findByRole("button", { name: "Править" });
      expect(texts().indexOf("Править")).toBeLessThan(texts().indexOf("Итоги"));
      expect(screen.queryByText("Изменить категории")).toBeNull();
      await fireEvent.press(edit);
      expect(await screen.findByText("Порядок — как в карточке операции")).toBeTruthy();
    });

    it("a renamed category is named anew in «Итоги»", async () => {
      let list = LIST;
      const insights = jest.fn(async () => month());
      const api = fakeApi({
        insights,
        categories: jest.fn(async () => list),
        patchCategory: jest.fn(async () => ((list = [{ ...LIST[0]!, name: "Супермаркет" }, LIST[1]!]), list[0]!)),
      });
      await renderWith(<Insights now={now} />, api);
      await screen.findByRole("button", { name: "Еда: ₴8,800" });
      await fireEvent.press(await screen.findByRole("button", { name: "Править" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Еда" }));
      await fireEvent.changeText(await screen.findByLabelText("Название"), "Супермаркет");
      await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
      await waitFor(() => expect(api.patchCategory).toHaveBeenCalledWith("groceries", { name: "Супермаркет" }));
      expect(await screen.findByRole("button", { name: "Супермаркет: ₴8,800" })).toBeTruthy();
      expect(insights.mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe("«Желаемое» (В6)", () => {
    const NAME = "Для себя: ₴3,600";

    it("a row in the second list with only the server's «желаемое» and a chevron; no derived «нужное»", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ wanted: 360_000, previousWanted: 300_000, otherPayments: 1_870_500 })) }));
      const row = await screen.findByRole("button", { name: NAME });
      expect(screen.getByText("Для себя")).toBeTruthy();
      expect(screen.getByText("₴3,600")).toBeTruthy();
      expect(screen.queryByText(/Нужное/)).toBeNull();
      expect(screen.queryByText(/₴14,620/)).toBeNull();
      // «Потрачено» stays as it was, and the old line under it is gone.
      expect(screen.getByText("₴18,220")).toBeTruthy();
      expect(screen.queryByText(/Из них на желаемое/)).toBeNull();
      const t = texts();
      expect(t.indexOf("Для себя")).toBeGreaterThan(t.indexOf("Связь"));
      expect(t.indexOf("Для себя")).toBeLessThan(t.indexOf("Платежи вне лимита"));
      // Nine categories and this row carry a chevron.
      expect(screen.getAllByTestId("row-chevron")).toHaveLength(10);
      expect((StyleSheet.flatten(row.props.style) as { minHeight?: number }).minHeight).toBeGreaterThanOrEqual(tokens.touchMin);
    });

    it("a tap leads to the operations of «желаемое» over the month's days", async () => {
      const onOpenWanted = jest.fn();
      await renderWith(<Insights now={now} onOpenWanted={onOpenWanted} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ wanted: 360_000 })) }));
      await fireEvent.press(await screen.findByRole("button", { name: NAME }));
      expect(onOpenWanted).toHaveBeenCalledWith("2026-11-01", "2026-11-16");
    });

    it("no row from an older server's answer without the field", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture()) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByText(/для себя/i)).toBeNull();
    });

    it("no row when nothing went on «желаемое»", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ wanted: 0 })) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByText(/для себя/i)).toBeNull();
    });

    it("no row when «желаемое» is more than all that was spent (refunds on «нужное»)", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ spent: 100_000, wanted: 150_000 })) }));
      await screen.findByText("₴1,000");
      expect(screen.queryByText(/для себя/i)).toBeNull();
    });

    it("the row shows when «желаемое» is all that was spent", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ spent: 100_000, wanted: 100_000 })) }));
      expect(await screen.findByRole("button", { name: "Для себя: ₴1,000" })).toBeTruthy();
    });
  });
});
