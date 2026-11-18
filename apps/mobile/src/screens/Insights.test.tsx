import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Pressable, StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import type { InsightsMonthDto } from "@hale/contracts";
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

describe("Insights", () => {
  it("shows the month's spending against the same days of the month before", async () => {
    const insights = jest.fn(async () => insightsFixture());
    await renderWith(<Insights now={now} />, fakeApi({ insights }));
    expect(await screen.findByText("₴18,220")).toBeTruthy();
    expect(screen.getByText("Итоги")).toBeTruthy();
    expect(screen.getByText("Ноябрь, 1–16")).toBeTruthy();
    expect(screen.getByText("потрачено · в октябре за те же дни ₴18,040")).toBeTruthy();
    expect(screen.getByText("Категории")).toBeTruthy();
    // The current month is asked for without a month: the server knows the Kyiv day.
    expect(insights).toHaveBeenCalledWith(undefined);
  });

  it("lists the five largest in the server's order, then one row for the rest, which unfolds in place", async () => {
    await renderWith(<Insights now={now} />, fakeApi());
    await screen.findByText("₴18,220");
    expect(rows()).toEqual(["Продукты: ₴8,800", "Кафе и рестораны: ₴3,200", "Транспорт: ₴2,150", "Подписки: ₴1,640", "Досуг: ₴1,380"]);
    expect(screen.queryByText("Здоровье")).toBeNull();
    const more = screen.getByRole("button", { name: "Ещё 4 категории: ₴1,050" });
    expect(screen.getByText("Ещё 4 категории")).toBeTruthy();
    expect(screen.getByText("₴1,050")).toBeTruthy();
    await fireEvent.press(more);
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
    expect(screen.queryByText("Ещё 4 категории")).toBeNull();
  });

  it("a category spent on only in the month before has no row", async () => {
    await renderWith(<Insights now={now} />, fakeApi());
    await screen.findByText("₴18,220");
    await fireEvent.press(screen.getByRole("button", { name: /^Ещё/ }));
    expect(screen.queryByText("Покупки")).toBeNull();
  });

  it("with one category left over it is shown as it is, not folded", async () => {
    const categories = insightsFixture().categories.slice(0, 6);
    await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ categories })) }));
    await screen.findByText("Ноябрь, 1–16");
    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(screen.queryByRole("button", { name: /^Ещё/ })).toBeNull();
  });

  it("draws a bright bar for this month and a pale one for the same days before, scaled to the largest", async () => {
    await renderWith(<Insights now={now} />, fakeApi());
    await screen.findByText("₴18,220");
    // October's groceries are the largest figure on the screen.
    expect(flat("bar-now-groceries").width).toBe(`${(880_000 / 900_000) * 100}%`);
    expect(flat("bar-before-groceries").width).toBe("100%");
    expect(flat("bar-now-cafe").width).toBe(`${(320_000 / 900_000) * 100}%`);
    expect(flat("bar-now-groceries").backgroundColor).toBe(tokens.color.accent.signal);
    expect(flat("bar-before-groceries").backgroundColor).toBe(tokens.color.data.track);
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
    expect(screen.queryByTestId("bar-before-refund")).toBeNull();
    expect(screen.queryByTestId("bar-now-cafe")).toBeNull();
    for (const t of screen.getAllByText(/./)) {
      const c = (StyleSheet.flatten(t.props.style) as { color?: string }).color;
      expect([tokens.color.status.danger, tokens.color.money.expense]).not.toContain(c);
    }
  });

  it("payments outside the limit: one quiet line under the categories, no colour, no breakdown, not a button (В2а)", async () => {
    await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ otherPayments: 1_870_500 })) }));
    const line = await screen.findByText("Ещё платежи: ₴18,705");
    // «Потрачено» stays the limit's.
    expect(screen.getByText("₴18,220")).toBeTruthy();
    expect((StyleSheet.flatten(line.props.style) as { color?: string }).color).toBe(tokens.color.fg.muted);
    expect(screen.queryByRole("button", { name: /платежи/ })).toBeNull();
    // Below the categories card: after its last row.
    const texts = screen.getAllByText(/./).map((t) => t.props.children as unknown);
    expect(texts.indexOf("Ещё платежи: ₴18,705")).toBeGreaterThan(texts.indexOf("Ещё 4 категории"));
  });

  it("no line when there were no such payments (В2а)", async () => {
    await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ otherPayments: 0 })) }));
    await screen.findByText("₴18,220");
    expect(screen.queryByText(/Ещё платежи/)).toBeNull();
  });

  it("no line from an older server's answer without the field (В2а)", async () => {
    await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture()) }));
    await screen.findByText("₴18,220");
    expect(screen.queryByText(/Ещё платежи/)).toBeNull();
  });

  it("the line shows in a month with no spending from the limit too (В2а)", async () => {
    await renderWith(
      <Insights now={now} />,
      fakeApi({ insights: jest.fn(async () => insightsFixture({ spent: 0, previousSpent: 0, categories: [], otherPayments: 795_000 })) }),
    );
    expect(await screen.findByText("Трат пока нет.")).toBeTruthy();
    expect(screen.getByText("Ещё платежи: ₴7,950")).toBeTruthy();
  });

  it("a quiet line for a month with no spending yet", async () => {
    await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ spent: 0, previousSpent: 0, categories: [] })) }));
    expect(await screen.findByText("Трат пока нет.")).toBeTruthy();
    expect(screen.getByText("потрачено")).toBeTruthy();
    expect(screen.queryByText("Категории")).toBeNull();
  });

  it("an older server without «Итоги»: one calm line instead of the screen", async () => {
    await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => null) }));
    expect(await screen.findByText("Итоги появятся после обновления сервера.")).toBeTruthy();
    expect(screen.queryByText("Категории")).toBeNull();
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
    expect(screen.getByText("потрачено · в сентябре ₴29,500")).toBeTruthy();
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

  describe("places of the month (В3)", () => {
    it("a card «Места» with up to five rows: name, visits declined in Russian, sum", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places })) }));
      expect(await screen.findByText("Места")).toBeTruthy();
      expect(placeRows()).toEqual([
        "Сільпо, 1 раз: ₴7,480",
        "АТБ, 2 раза: ₴4,215",
        "Aroma Kava, 5 раз: ₴2,240",
        "Uklon, 11 раз: ₴1,960",
        "Сушия, новое, 21 раз: ₴1,380",
      ]);
      expect(screen.getByText("Сільпо")).toBeTruthy();
      expect(screen.getByText("· 1 раз")).toBeTruthy();
      expect(screen.getByText("· 2 раза")).toBeTruthy();
      expect(screen.getByText("· 21 раз")).toBeTruthy();
      expect(screen.getByText("₴7,480")).toBeTruthy();
      expect(screen.getByText("₴4,215")).toBeTruthy();
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
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places })) }));
      await screen.findByText("Места");
      const tags = screen.getAllByText("новое");
      expect(tags).toHaveLength(1);
      expect((StyleSheet.flatten(tags[0]!.props.style) as { color?: string }).color).toBe(tokens.color.fg.muted);
      expect(placeRows().filter((r) => r.includes("новое"))).toEqual(["Сушия, новое, 21 раз: ₴1,380"]);
      for (const t of screen.getAllByText(/./)) {
        const c = (StyleSheet.flatten(t.props.style) as { color?: string }).color;
        expect([tokens.color.status.danger, tokens.color.money.expense]).not.toContain(c);
      }
    });

    it("rows are not buttons and lead nowhere: «Операции» has no place filter yet", async () => {
      const onOpenCategory = jest.fn();
      await renderWith(<Insights now={now} onOpenCategory={onOpenCategory} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places })) }));
      await screen.findByText("Места");
      for (const r of screen.getAllByTestId("place-row")) {
        expect(r.props.accessibilityRole).toBeUndefined();
        expect(r.props.onPress).toBeUndefined();
      }
      expect(screen.queryByRole("button", { name: /Сільпо|АТБ|Aroma|Uklon|Сушия/ })).toBeNull();
      // No «›» on place rows: only the month arrow and «Ещё 4 категории» carry it.
      expect(screen.getAllByText("›")).toHaveLength(2);
      await fireEvent.press(screen.getByText("Сільпо"));
      expect(onOpenCategory).not.toHaveBeenCalled();
    });

    it("a solid card, not glass", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places })) }));
      await screen.findByText("Места");
      const card = StyleSheet.flatten(screen.getByTestId("places-card").props.style) as { backgroundColor?: string };
      expect(card.backgroundColor).toBe(tokens.color.card.fill);
    });

    it("comes after the categories card and the line «Ещё платежи»", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places, otherPayments: 1_870_500 })) }));
      await screen.findByText("Места");
      const texts = screen.getAllByText(/./).map((t) => t.props.children as unknown);
      expect(texts.indexOf("Места")).toBeGreaterThan(texts.indexOf("Ещё 4 категории"));
      expect(texts.indexOf("Места")).toBeGreaterThan(texts.indexOf("Ещё платежи: ₴18,705"));
    });

    it("no card from an older server's answer without the field", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture()) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByText("Места")).toBeNull();
      expect(screen.queryByTestId("places-card")).toBeNull();
    });

    it("no card when there were no places", async () => {
      await renderWith(<Insights now={now} />, fakeApi({ insights: jest.fn(async () => insightsFixture({ places: [] })) }));
      await screen.findByText("₴18,220");
      expect(screen.queryByText("Места")).toBeNull();
      expect(screen.queryByTestId("places-card")).toBeNull();
    });

    it("the places change with the month", async () => {
      const insights = jest.fn(async (month?: string) =>
        month === "2026-10" ? { ...october(), places: [place("Novus", 310_000, 22)] } : insightsFixture({ places }),
      );
      await renderWith(<Insights now={now} />, fakeApi({ insights }));
      await screen.findByText("Места");
      await fireEvent.press(screen.getByRole("button", { name: "Предыдущий месяц" }));
      expect(await screen.findByText("Novus")).toBeTruthy();
      expect(placeRows()).toEqual(["Novus, 22 раза: ₴3,100"]);
      expect(screen.queryByText("Сільпо")).toBeNull();
    });
  });

  describe("subscriptions of the month (В4)", () => {
    it("one row: the total a month, with the first raised one as a quiet note", async () => {
      await renderWith(<Insights now={now} />, withSubs(subscriptions));
      const row = await screen.findByTestId("subscriptions-row");
      expect(row.props.accessibilityLabel).toBe("Подписки: ₴1,886 в месяц. Netflix подорожала на ₴50");
      expect(screen.getByText("₴1,886 в месяц")).toBeTruthy();
      expect(screen.getByText("Netflix подорожала на ₴50")).toBeTruthy();
      // The row lists nothing: the subscriptions are in the sheet.
      expect(screen.queryByText("ChatGPT")).toBeNull();
    });

    it("with none raised, the first one not charged for a while is the note", async () => {
      const items = subscriptions.items.map((i) => ({ ...i, raisedBy: 0 }));
      await renderWith(<Insights now={now} />, withSubs({ ...subscriptions, items }));
      await screen.findByTestId("subscriptions-row");
      expect(screen.getByText("Megogo не списывалась 2 месяца")).toBeTruthy();
      expect(screen.queryByText(/подорожала/)).toBeNull();
    });

    it("one missed charge reads as a month, five as months", async () => {
      const one = [sub("ChatGPT", 83_000), sub("Megogo", 19_900, { missed: 1 })];
      await renderWith(<Insights now={now} />, withSubs({ monthly: 83_000, items: one }));
      expect(await screen.findByText("Megogo не списывалась месяц")).toBeTruthy();
    });

    it("five missed charges read as «5 месяцев»", async () => {
      const five = [sub("ChatGPT", 83_000), sub("Megogo", 19_900, { missed: 5 })];
      await renderWith(<Insights now={now} />, withSubs({ monthly: 83_000, items: five }));
      expect(await screen.findByText("Megogo не списывалась 5 месяцев")).toBeTruthy();
    });

    it("no note when nothing changed", async () => {
      const calm = [sub("ChatGPT", 83_000), sub("Spotify", 19_900)];
      await renderWith(<Insights now={now} />, withSubs({ monthly: 102_900, items: calm }));
      const row = await screen.findByTestId("subscriptions-row");
      expect(row.props.accessibilityLabel).toBe("Подписки: ₴1,029 в месяц");
      expect(screen.queryByText(/подорожала|не списывалась/)).toBeNull();
    });

    it("a tap opens the sheet with the list, and «Закрыть» closes it", async () => {
      await renderWith(<Insights now={now} />, withSubs(subscriptions));
      await fireEvent.press(await screen.findByRole("button", { name: "Подписки: ₴1,886 в месяц. Netflix подорожала на ₴50" }));
      expect(await screen.findByText("₴1,886 в месяц · 6 подписок")).toBeTruthy();
      expect(screen.getByText("ChatGPT")).toBeTruthy();
      expect(screen.getByText("Давно не списывались")).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Закрыть" }));
      await waitFor(() => expect(screen.queryByText("Давно не списывались")).toBeNull());
      expect(screen.getByTestId("subscriptions-row")).toBeTruthy();
    });

    it("a solid card, not glass, with no red", async () => {
      await renderWith(<Insights now={now} />, withSubs(subscriptions));
      await screen.findByTestId("subscriptions-row");
      const card = StyleSheet.flatten(screen.getByTestId("subscriptions-card").props.style) as { backgroundColor?: string };
      expect(card.backgroundColor).toBe(tokens.color.card.fill);
      const note = StyleSheet.flatten(screen.getByText("Netflix подорожала на ₴50").props.style) as { color?: string };
      expect(note.color).toBe(tokens.color.fg.muted);
    });

    it("comes after the categories, «Ещё платежи» and «Места»", async () => {
      await renderWith(
        <Insights now={now} />,
        fakeApi({ insights: jest.fn(async () => insightsFixture({ places, otherPayments: 1_870_500, subscriptions })) }),
      );
      await screen.findByTestId("subscriptions-row");
      const texts = screen.getAllByText(/./).map((t) => t.props.children as unknown);
      const at = texts.indexOf("₴1,886 в месяц");
      expect(at).toBeGreaterThan(texts.indexOf("Ещё 4 категории"));
      expect(at).toBeGreaterThan(texts.indexOf("Ещё платежи: ₴18,705"));
      expect(at).toBeGreaterThan(texts.indexOf("Сушия"));
    });

    it("no row from an older server's answer without the field", async () => {
      await renderWith(<Insights now={now} />, withSubs(undefined));
      await screen.findByText("₴18,220");
      expect(screen.queryByTestId("subscriptions-row")).toBeNull();
    });

    it("no row when none were found", async () => {
      await renderWith(<Insights now={now} />, withSubs({ monthly: 0, items: [] }));
      await screen.findByText("₴18,220");
      expect(screen.queryByTestId("subscriptions-row")).toBeNull();
    });

    it("no row when every one found has stopped being charged", async () => {
      await renderWith(<Insights now={now} />, withSubs({ monthly: 0, items: [sub("Megogo", 19_900, { missed: 2 })] }));
      await screen.findByText("₴18,220");
      expect(screen.queryByTestId("subscriptions-row")).toBeNull();
      expect(screen.queryByText(/Megogo/)).toBeNull();
    });
  });
});
