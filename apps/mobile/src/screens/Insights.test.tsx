import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Pressable, StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import type { CategoryDto, InsightsMonthDto } from "@hale/contracts";
import { Insights } from "./Insights";
import { fakeApi, insightsFixture, renderWith } from "../testing";
import { ApiError } from "../api/client";
import { useEditTransaction } from "../api/queries";
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

const tab = (name: string) => screen.getByRole("tab", { name });
const texts = () => screen.getAllByText(/./).map((t) => t.props.children as unknown);

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
      const c = (StyleSheet.flatten(t.props.style) as { color?: string }).color;
      expect([tokens.color.status.danger, tokens.color.money.expense]).not.toContain(c);
    }
  });

  describe("payments outside the limit (В2а)", () => {
    it("a row «Платежи вне лимита» in a second list under the categories; not a button, no chevron", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ otherPayments: 1_870_500 })) }));
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
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("an older server without «Итоги»: one calm line instead of the screen", async () => {
    await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => null) }));
    expect(await screen.findByText("Итоги появятся после обновления сервера.")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
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
    expect(await screen.findByText("Декабрь 2026")).toBeTruthy();
    expect(insights).toHaveBeenLastCalledWith("2026-12");
  });

  describe("the switch «Категории · Места · Подписки»", () => {
    const full = () => fakeApi({ insights: jest.fn(async () => insightsFixture({ places, subscriptions, otherPayments: 1_870_500, wanted: 360_000 })) });

    it("three segments, «Категории» chosen by default", async () => {
      await renderWith(<Insights now={now} />, full());
      await screen.findByText("₴18,220");
      expect(screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel as string)).toEqual(["Категории", "Места", "Подписки"]);
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
      expect(screen.queryByText("Желаемое")).toBeNull();
      expect(screen.queryByText("Платежи вне лимита")).toBeNull();

      await fireEvent.press(tab("Подписки"));
      expect(screen.queryAllByTestId("place-row")).toHaveLength(0);
      expect(screen.getByText("ChatGPT")).toBeTruthy();
      expect(screen.queryByText("Платежи вне лимита")).toBeNull();

      await fireEvent.press(tab("Категории"));
      expect(rows()).toHaveLength(9);
      expect(screen.getByText("Платежи вне лимита")).toBeTruthy();
      expect(screen.getByText("Желаемое")).toBeTruthy();
    });

    it("the chosen segment stands out without colour: a raised fill, no blue, no red", async () => {
      await renderWith(<Insights now={now} />, full());
      await screen.findByText("₴18,220");
      const on = StyleSheet.flatten(tab("Категории").props.style) as { backgroundColor?: string };
      const off = StyleSheet.flatten(tab("Места").props.style) as { backgroundColor?: string };
      expect(on.backgroundColor).toBe(tokens.color.surface.overlay);
      expect(off.backgroundColor).toBeUndefined();
    });

    it("a segment with nothing in it is not offered", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places })) }));
      await screen.findByText("₴18,220");
      expect(screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel as string)).toEqual(["Категории", "Места"]);
    });

    it("an older server with neither places nor subscriptions: no switch, only the categories", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture()) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByRole("tab")).toBeNull();
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
        const c = (StyleSheet.flatten(t.props.style) as { color?: string }).color;
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
      expect(screen.queryByRole("tab", { name: "Места" })).toBeNull();
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
        "Megogo: ₴199, последний раз 4 августа",
      ]);
      const t = texts();
      expect(t.indexOf("₴1,886 в месяц · 6 подписок")).toBeLessThan(t.indexOf("ChatGPT"));
      expect(t.indexOf("Давно не списывались")).toBeGreaterThan(t.indexOf("iCloud+"));
      // On the screen itself, not in a sheet: no «Закрыть».
      expect(screen.queryByRole("button", { name: "Закрыть" })).toBeNull();
    });

    it("rows are not buttons and have no chevron for now", async () => {
      await open(subscriptions);
      for (const r of [...screen.getAllByTestId("subscription-row"), ...screen.getAllByTestId("subscription-missed-row")]) {
        expect(r.props.accessibilityRole).toBeUndefined();
        expect(r.props.onPress).toBeUndefined();
      }
      expect(screen.queryAllByTestId("row-chevron")).toHaveLength(0);
    });

    it("no «Не показывать такое» here: that is the observation's", async () => {
      await open(subscriptions);
      expect(screen.queryByText("Не показывать такое")).toBeNull();
    });

    it("a solid card, not glass, with no red", async () => {
      await open(subscriptions);
      const card = StyleSheet.flatten(screen.getAllByTestId("subscriptions-card")[0]!.props.style) as { backgroundColor?: string };
      expect(card.backgroundColor).toBe(tokens.color.card.fill);
      for (const t of screen.getAllByText(/./)) {
        const c = (StyleSheet.flatten(t.props.style) as { color?: string }).color;
        expect([tokens.color.status.danger, tokens.color.money.expense]).not.toContain(c);
      }
    });

    it("no segment from an older server's answer without the field", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places })) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByRole("tab", { name: "Подписки" })).toBeNull();
    });

    it("no segment when none were found", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places, subscriptions: { monthly: 0, items: [] } })) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByRole("tab", { name: "Подписки" })).toBeNull();
    });

    it("no segment when every one found has stopped being charged", async () => {
      const gone = { monthly: 0, items: [sub("Megogo", 19_900, { missed: 2 })] };
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places, subscriptions: gone })) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByRole("tab", { name: "Подписки" })).toBeNull();
      expect(screen.queryByText(/Megogo/)).toBeNull();
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
    const NAME = "Желаемое: ₴3,600";

    it("a row in the second list with only the server's «желаемое» and a chevron; no derived «нужное»", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ wanted: 360_000, previousWanted: 300_000, otherPayments: 1_870_500 })) }));
      const row = await screen.findByRole("button", { name: NAME });
      expect(screen.getByText("Желаемое")).toBeTruthy();
      expect(screen.getByText("₴3,600")).toBeTruthy();
      expect(screen.queryByText(/Нужное/)).toBeNull();
      expect(screen.queryByText(/₴14,620/)).toBeNull();
      // «Потрачено» stays as it was, and the old line under it is gone.
      expect(screen.getByText("₴18,220")).toBeTruthy();
      expect(screen.queryByText(/Из них на желаемое/)).toBeNull();
      const t = texts();
      expect(t.indexOf("Желаемое")).toBeGreaterThan(t.indexOf("Связь"));
      expect(t.indexOf("Желаемое")).toBeLessThan(t.indexOf("Платежи вне лимита"));
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
      expect(screen.queryByText(/желаемое/i)).toBeNull();
    });

    it("no row when nothing went on «желаемое»", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ wanted: 0 })) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByText(/желаемое/i)).toBeNull();
    });

    it("no row when «желаемое» is more than all that was spent (refunds on «нужное»)", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ spent: 100_000, wanted: 150_000 })) }));
      await screen.findByText("₴1,000");
      expect(screen.queryByText(/желаемое/i)).toBeNull();
    });

    it("the row shows when «желаемое» is all that was spent", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ spent: 100_000, wanted: 100_000 })) }));
      expect(await screen.findByRole("button", { name: "Желаемое: ₴1,000" })).toBeTruthy();
    });
  });
});
