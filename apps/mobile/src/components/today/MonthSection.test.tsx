import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { Animated, StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import { monthSection } from "../../monthSection";
import { insightsFixture, passTime, watchMotion } from "../../testing";
import { MonthSection } from "./MonthSection";

// The section asks what to show once every time it is drawn: the mock counts how often that is (ЧЛ8а).
jest.mock("../../monthSection", () => {
  const real = jest.requireActual<typeof import("../../monthSection")>("../../monthSection");
  return { ...real, monthSection: jest.fn(real.monthSection) };
});

const { color, touchMin } = tokens;
const HIDDEN = { includeHiddenElements: true };
const HINT = "Нажмите на категорию, чтобы увидеть, что изменилось.";
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
const share = (key: string) => screen.getByTestId(`month-share-${key}`);
const legend = (key: string) => screen.getByTestId(`month-legend-${key}`, HIDDEN);
const KEYS = ["groceries", "cafe", "transport", "subscriptions", "rest"];

describe("MonthSection (ЧЛ7)", () => {
  it("is not drawn while «Итоги» load, after a failed request, from an older server and in a month with no spending", async () => {
    const { rerender } = await render(<MonthSection insights={undefined} categories={null} />);
    expect(screen.queryByTestId("month-section")).toBeNull();
    await rerender(<MonthSection insights={null} categories={null} />);
    expect(screen.queryByTestId("month-section")).toBeNull();
    await rerender(<MonthSection insights={insightsFixture({ spent: 0, categories: [] })} categories={null} />);
    expect(screen.queryByTestId("month-section")).toBeNull();
    expect(screen.queryByText(/./)).toBeNull();
  });

  it("the header names the month and, at the right, the comparison; no card, 26 pt of air above the title", async () => {
    await render(<MonthSection insights={insightsFixture()} categories={null} />);
    expect(flat(screen.getByText("Ноябрь"))).toMatchObject({ fontSize: 15, fontWeight: "600", color: color.fg.default });
    // ₴18,220 against ₴18,040: above, so the pill is quiet, not sage and not sand.
    expect(flat(screen.getByText("1% к октябрю")).color).toBe(color.fg.muted);
    expect(screen.getByTestId("icon-arrowUp").props.accessibilityHint).toBe(color.fg.muted);
    const section = flat(screen.getByTestId("month-section"));
    expect(section.backgroundColor).toBeUndefined();
    expect(section.borderWidth).toBeUndefined();
    // The header is 44 pt tall with a 20 pt line in the middle: 12 of the 26 is its own air, 12 the screen's gap.
    const head = flat(screen.getByTestId("month-head"));
    expect(head.minHeight).toBe(touchMin);
    expect((section.marginTop as number) + tokens.space.md + ((head.minHeight as number) - 20) / 2).toBe(26);
  });

  it("a month below the one before has a sage pill with the arrow down; with nothing to compare there is no pill", async () => {
    const { rerender } = await render(<MonthSection insights={insightsFixture({ previousSpent: 1_918_000 })} categories={null} />);
    expect(flat(screen.getByText("5% к октябрю")).color).toBe(color.accent.signal);
    expect(screen.getByTestId("icon-arrowDown").props.accessibilityHint).toBe(color.accent.signal);
    expect(flat(screen.getByTestId("month-pill")).backgroundColor).toBe(color.accent.signalSoft);
    await rerender(<MonthSection insights={insightsFixture({ previousSpent: 1_822_000 })} categories={null} />);
    expect(flat(screen.getByText("как в октябре")).color).toBe(color.fg.muted);
    expect(screen.queryByTestId(/^icon-arrow(Up|Down)$/)).toBeNull();
    await rerender(<MonthSection insights={insightsFixture({ previousSpent: 0 })} categories={null} />);
    expect(screen.queryByTestId("month-pill")).toBeNull();
    expect(screen.getByText("Ноябрь")).toBeTruthy();
  });

  it("the month's sum, as «Итоги» show it, with the quiet «₴» and the average per day beside it", async () => {
    await render(<MonthSection insights={insightsFixture()} categories={null} />);
    const sum = screen.getByText("₴18,220");
    expect(flat(sum)).toMatchObject({ fontSize: 30, color: color.fg.default, fontVariant: ["tabular-nums"] });
    expect(flat(within(sum).getByText("₴"))).toMatchObject({ fontSize: 15, color: color.fg.subtle });
    expect(flat(screen.getByText("в среднем ₴1,139 в день")).color).toBe(color.fg.muted);
    expect(screen.getByLabelText("Потрачено ₴18,220, в среднем ₴1,139 в день")).toBeTruthy();
  });

  it("one bar of the four largest categories and «Остальное»: sage steps from bright to dark, widths by the sums", async () => {
    await render(<MonthSection insights={insightsFixture()} categories={null} />);
    const amounts = [880_000, 320_000, 215_000, 164_000, 268_000];
    KEYS.forEach((key, i) => {
      expect(flat(share(key)).flexGrow).toBe(amounts[i]);
      expect(flat(screen.getByTestId(`month-strip-${key}`))).toMatchObject({ backgroundColor: color.data.shares[i], height: 12 });
    });
    // «Возвраты» are below zero: not a share.
    expect(screen.queryByTestId("month-share-refund")).toBeNull();
    expect(screen.queryByText("Возвраты", HIDDEN)).toBeNull();
    expect(screen.getAllByTestId(/^month-share-/)).toHaveLength(5);
  });

  it("each share is a button named aloud, tall enough to press", async () => {
    await render(<MonthSection insights={insightsFixture()} categories={null} />);
    expect(screen.getByRole("button", { name: "Продукты, ₴8,800, 48% трат" })).toBe(share("groceries"));
    expect(screen.getByRole("button", { name: "Кафе и рестораны, ₴3,200, 17% трат, заметно больше, чем в октябре" })).toBe(share("cafe"));
    expect(screen.getByRole("button", { name: "Остальное, ₴2,680, 15% трат" })).toBe(share("rest"));
    for (const key of KEYS) {
      expect(flat(share(key)).minHeight).toBeGreaterThanOrEqual(touchMin);
      expect(flat(legend(key)).minHeight).toBeGreaterThanOrEqual(touchMin);
      expect(share(key).props.accessibilityState).toEqual({ selected: false });
    }
  });

  it("the names under the bar: two columns with the sums, a sand arrow only at the category well above the month before", async () => {
    await render(<MonthSection insights={insightsFixture()} categories={null} />);
    const names = ["Продукты", "Кафе и рестораны", "Транспорт", "Подписки", "Остальное"];
    const sums = ["₴8,800", "₴3,200", "₴2,150", "₴1,640", "₴2,680"];
    KEYS.forEach((key, i) => {
      const item = legend(key);
      expect(within(item).getByText(names[i]!, HIDDEN).props.numberOfLines).toBe(1);
      expect(flat(within(item).getByText(sums[i]!, HIDDEN))).toMatchObject({ color: color.fg.muted, flexShrink: 0 });
      expect(flat(within(item).getByTestId(`month-dot-${key}`, HIDDEN)).backgroundColor).toBe(color.data.shares[i]);
      expect(flat(item).width).toBe("47%");
    });
    // The names are for the eye: aloud the bar's shares already say them.
    expect(screen.queryByText("Продукты")).toBeNull();
    for (const key of KEYS) expect(within(legend(key)).queryAllByTestId("icon-arrowUp", HIDDEN)).toHaveLength(key === "cafe" ? 1 : 0);
    expect(within(legend("cafe")).getByTestId("icon-arrowUp", HIDDEN).props.accessibilityHint).toBe(color.limit.low);
  });

  it("a pressed share dims the others and says one phrase about it; pressed again, the choice is gone", async () => {
    await render(<MonthSection insights={insightsFixture()} categories={null} />);
    expect(flat(screen.getByText(HINT)).color).toBe(color.fg.muted);
    await fireEvent.press(share("cafe"));
    expect(screen.getByText("Кафе и рестораны — ₴3,200, на ₴1,100 больше, чем в октябре за те же дни")).toBeTruthy();
    expect(screen.queryByText(HINT)).toBeNull();
    for (const key of KEYS) {
      const opacity = key === "cafe" ? 1 : 0.3;
      expect(flat(share(key)).opacity).toBe(opacity);
      expect(flat(legend(key)).opacity).toBe(opacity);
      expect(share(key).props.accessibilityState).toEqual({ selected: key === "cafe" });
    }
    // Another share takes the choice over.
    await fireEvent.press(share("rest"));
    expect(screen.getByText("Остальное — ₴2,680 в 4 категориях")).toBeTruthy();
    expect(flat(share("cafe")).opacity).toBe(0.3);
    await fireEvent.press(share("rest"));
    expect(screen.getByText(HINT)).toBeTruthy();
    for (const key of KEYS) expect(flat(share(key)).opacity).toBe(1);
  });

  it("a pressed name under the bar chooses the same share", async () => {
    await render(<MonthSection insights={insightsFixture()} categories={null} />);
    await fireEvent.press(legend("groceries"));
    expect(screen.getByText("Продукты — ₴8,800, на ₴200 меньше, чем в октябре за те же дни")).toBeTruthy();
    expect(share("groceries").props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(share("groceries"));
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it("a choice that the new month's data no longer has is dropped", async () => {
    const { rerender } = await render(<MonthSection insights={insightsFixture()} categories={null} />);
    await fireEvent.press(share("cafe"));
    await rerender(<MonthSection insights={insightsFixture({ spent: 880_000, categories: [{ category: "groceries", spent: 880_000, previousSpent: 900_000, count: 12 }] })} categories={null} />);
    expect(screen.getByText(HINT)).toBeTruthy();
    expect(flat(share("groceries")).opacity).toBe(1);
  });

  it("the header opens «Итоги» when there is a way there; without one it is a plain header", async () => {
    const onOpenInsights = jest.fn();
    const { rerender } = await render(<MonthSection insights={insightsFixture()} categories={null} onOpenInsights={onOpenInsights} />);
    const head = screen.getByRole("button", { name: "Ноябрь. На 1% больше, чем в октябре за те же дни" });
    expect(head.props.accessibilityHint).toBe("Открывает итоги");
    expect(flat(head).minHeight).toBeGreaterThanOrEqual(touchMin);
    expect(screen.getByTestId("icon-chevron")).toBeTruthy();
    await fireEvent.press(head);
    expect(onOpenInsights).toHaveBeenCalledTimes(1);
    await rerender(<MonthSection insights={insightsFixture()} categories={null} />);
    expect(screen.queryByRole("button", { name: /^Ноябрь/ })).toBeNull();
    expect(screen.getByRole("header", { name: "Ноябрь. На 1% больше, чем в октябре за те же дни" })).toBeTruthy();
    expect(screen.queryByTestId("icon-chevron")).toBeNull();
    await rerender(<MonthSection insights={insightsFixture({ previousSpent: 0 })} categories={null} />);
    expect(screen.getByRole("header", { name: "Ноябрь" })).toBeTruthy();
  });

  it("names a category as the owner's list names it", async () => {
    await render(<MonthSection insights={insightsFixture()} categories={[{ key: "cafe", name: "Кофе" }] as never} />);
    expect(within(legend("cafe")).getByText("Кофе", HIDDEN)).toBeTruthy();
  });

  it("no red and no sand in any text: sand is only the arrow", async () => {
    await render(<MonthSection insights={insightsFixture()} categories={null} onOpenInsights={jest.fn()} />);
    await fireEvent.press(share("cafe"));
    const loud = [color.limit.over, color.limit.overDeep, color.status.danger, color.limit.low, color.money.expense, color.calendar.farOver];
    const texts = screen.getAllByText(/./, HIDDEN);
    expect(texts.length).toBeGreaterThan(10);
    for (const t of texts) expect(loud).not.toContain(flat(t).color);
  });
});

describe("MonthSection, the entrance (ЧЛ8)", () => {
  const shift = (node: { props: { style?: unknown } }) => Number(JSON.stringify((flat(node).transform as { translateX: unknown }[])[0]!.translateX));
  const bar = () => screen.getByTestId("month-bar");
  const SUM_LABEL = "Потрачено ₴18,220, в среднем ₴1,139 в день";
  let motion: ReturnType<typeof watchMotion>;
  beforeEach(() => {
    jest.useFakeTimers();
    motion = watchMotion();
  });
  afterEach(() => {
    motion.restore();
    jest.useRealTimers();
  });

  it("without an entrance key the sum and the bar are simply there and nothing is animated", async () => {
    await render(<MonthSection insights={insightsFixture()} categories={null} />);
    expect(screen.queryByTestId("month-count")).toBeNull();
    expect(flat(screen.getByText("₴18,220")).color).toBe(color.fg.default);
    expect(shift(bar())).toBe(0);
    expect(motion.asked()).toEqual([]);
    await passTime(2000);
    expect(screen.queryByTestId("month-count")).toBeNull();
  });

  it("with a key the sum counts up from zero over its own place for 0.9 s and ends as the sum itself", async () => {
    await render(<MonthSection insights={insightsFixture()} categories={null} entrance={1} />);
    // The sum keeps its place from the first frame, with clear ink; the count is drawn over it and is not in the flow.
    expect(flat(screen.getByText("₴18,220")).color).toBe("transparent");
    const count = () => screen.getByTestId("month-count");
    expect(count()).toHaveTextContent("₴0");
    expect(flat(count())).toMatchObject({ position: "absolute", left: 0, top: 0, fontSize: 30, color: color.fg.default });
    // VoiceOver has the sum itself all the while, never a figure on the way.
    expect(screen.getByLabelText(SUM_LABEL)).toBeTruthy();
    await passTime(450);
    // On the way: a whole figure below the sum, in the money's own format.
    expect(count()).toHaveTextContent(/^₴1\d,\d{3}$/);
    expect(screen.getByLabelText(SUM_LABEL)).toBeTruthy();
    await passTime(430);
    expect(screen.queryByTestId("month-count")).not.toBeNull();
    await passTime(40);
    expect(screen.queryByTestId("month-count")).toBeNull();
    expect(flat(screen.getByText("₴18,220")).color).toBe(color.fg.default);
    expect(screen.getByLabelText(SUM_LABEL)).toBeTruthy();
  });

  it("while the sum counts only its figure is drawn again: not the section, its bar or the names (ЧЛ8а)", async () => {
    const interpolate = jest.spyOn(Animated.Value.prototype, "interpolate");
    const drawn = () => (monthSection as jest.Mock).mock.calls.length;
    await render(<MonthSection insights={insightsFixture()} categories={null} entrance={1} />);
    const before = { drawn: drawn(), nodes: interpolate.mock.calls.length };
    // The figure moves on with the frames...
    await passTime(300);
    expect(screen.getByTestId("month-count")).toHaveTextContent(/^₴1\d,\d{3}$/);
    await passTime(300);
    await passTime(400);
    expect(screen.queryByTestId("month-count")).toBeNull();
    // ...and on the way the section was not drawn once, and the bar built no new animated nodes.
    expect(drawn()).toBe(before.drawn);
    expect(interpolate.mock.calls.length).toBe(before.nodes);
    interpolate.mockRestore();
  });

  it("with a key the bar starts wholly covered and is uncovered from the left over a second; its shares keep their widths", async () => {
    await render(<MonthSection insights={insightsFixture()} categories={null} entrance={1} />);
    expect(flat(bar()).overflow).toBe("hidden");
    // The window is off by the screen's width, which the bar is never wider than.
    expect(shift(bar())).toBe(-750);
    expect(motion.asked()).toEqual([{ duration: 1000, delay: 0 }]);
    expect(KEYS.map((k) => flat(share(k)).flexGrow)).toEqual([880_000, 320_000, 215_000, 164_000, 268_000]);
  });

  it("the names under the bar choose a share while it plays", async () => {
    await render(<MonthSection insights={insightsFixture()} categories={null} entrance={1} />);
    await fireEvent.press(legend("cafe"));
    expect(share("cafe").props.accessibilityState).toEqual({ selected: true });
  });

  it("a section first drawn with no key (the month came on a background refetch) does not play", async () => {
    const { rerender } = await render(<MonthSection insights={undefined} categories={null} entrance={0} />);
    await rerender(<MonthSection insights={insightsFixture()} categories={null} entrance={0} />);
    expect(screen.queryByTestId("month-count")).toBeNull();
    expect(shift(bar())).toBe(0);
    expect(motion.asked()).toEqual([]);
  });
});
