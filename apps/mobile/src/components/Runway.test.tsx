import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import type { RunwayDto } from "@hale/contracts";
import { Runway } from "./Runway";

const run = (over: Partial<RunwayDto> = {}): RunwayDto => ({
  endOn: "2026-11-15",
  incomeOn: "2026-11-15",
  reserve: 310_000,
  zeroOn: null,
  points: [
    { date: "2026-11-11", balance: 1_350_000 },
    { date: "2026-11-12", balance: 1_226_000 },
    { date: "2026-11-13", balance: 1_026_000 },
    { date: "2026-11-14", balance: 526_000 },
    { date: "2026-11-15", balance: 310_000 },
  ],
  events: [{ id: "7", date: "2026-11-13", name: "Квартплата", amount: 300_000 }],
  ...over,
});

/** The same days, short of money: the line goes below zero on the 14th. */
const shortRun = () =>
  run({
    reserve: -240_000,
    zeroOn: "2026-11-14",
    points: [
      { date: "2026-11-11", balance: 800_000 },
      { date: "2026-11-12", balance: 676_000 },
      { date: "2026-11-13", balance: 476_000 },
      { date: "2026-11-14", balance: -24_000 },
      { date: "2026-11-15", balance: -240_000 },
    ],
  });

/** A finger on the chart at `x` (and `y` down from where the touches start): the chart is at the page's left edge. */
const touch = (x: number, type: "responderGrant" | "responderMove" = "responderGrant", y = 0) =>
  fireEvent(screen.getByTestId("runway-chart"), type, { nativeEvent: { locationX: x, pageX: x, pageY: y } });
/** Whether the chart lets the page take the touch now (the page asks when it wants to scroll). */
const yields = () => screen.getByTestId("runway-chart").props.onResponderTerminationRequest() as boolean;
const giveUp = () => fireEvent(screen.getByTestId("runway-chart"), "responderTerminate");
const HIDDEN = { includeHiddenElements: true };
const measure = () => fireEvent(screen.getByTestId("runway-chart"), "layout", { nativeEvent: { layout: { width: 400, height: 112 } } });

describe("Runway", () => {
  it("names the reserve to the income with one figure and marks only the ends of the axis", async () => {
    await render(<Runway runway={run()} today="2026-11-11" />);
    expect(screen.getByText("Запас к доходу")).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByText("₴3,100").props.style).color).toBe(tokens.color.fg.default);
    expect(screen.getByText("сегодня")).toBeTruthy();
    expect(screen.getByText("15 ноя · доход")).toBeTruthy();
    // No list of dates under the graph: they come by touch. The one payment named is the nearest.
    expect(screen.queryByText(/12 ноя/)).toBeNull();
    expect(screen.queryByText(/14 ноя/)).toBeNull();
  });

  it("leaves its reserve to the screen when asked (ЯМ1): the chart, the axis and the nearest payment stay", async () => {
    await render(<Runway runway={run()} today="2026-11-11" showHead={false} />);
    expect(screen.queryByText("Запас к доходу")).toBeNull();
    expect(screen.queryByText("₴3,100")).toBeNull();
    expect(screen.getByTestId("runway-chart")).toBeTruthy();
    expect(screen.getByText("15 ноя · доход")).toBeTruthy();
    expect(screen.getByText("Ближайший платёж")).toBeTruthy();
  });

  describe("the nearest payment", () => {
    const two = () =>
      run({
        events: [
          { id: "9", date: "2026-11-14", name: "Интернет", amount: 40_000 },
          { id: "7", date: "2026-11-13", name: "Квартплата", amount: 300_000 },
          { id: "8", date: "2026-11-13", name: "Телефон", amount: 20_000 },
        ],
      });

    it("stands under the graph as one quiet row: the caption, the name with the day, the amount", async () => {
      await render(<Runway runway={two()} today="2026-11-11" />);
      expect(screen.getByText("Ближайший платёж")).toBeTruthy();
      expect(screen.getByText("Квартплата · 13 ноя")).toBeTruthy();
      const amount = screen.getByText("₴3,000");
      expect(StyleSheet.flatten(amount.props.style).fontVariant).toEqual(["tabular-nums"]);
      // One row, the earliest: the others are reached through the graph.
      expect(screen.queryByText(/Интернет/)).toBeNull();
      expect(screen.queryByText(/Телефон/)).toBeNull();
      // Nothing to press unless the screen can mark a payment paid.
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("a payment standing on today is named so", async () => {
      await render(<Runway runway={run({ events: [{ id: "7", date: "2026-11-11", name: "Квартплата", amount: 300_000 }] })} today="2026-11-11" />);
      expect(screen.getByText("Квартплата · сегодня")).toBeTruthy();
    });

    it("no payments before the income: no row", async () => {
      await render(<Runway runway={run({ events: [] })} today="2026-11-11" onPay={jest.fn()} />);
      expect(screen.getByTestId("runway-chart")).toBeTruthy();
      expect(screen.queryByText("Ближайший платёж")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("gives its place to the touched day and comes back when the day is let go", async () => {
      await render(<Runway runway={run()} today="2026-11-11" onPay={jest.fn()} />);
      await measure();
      expect(screen.getByText("Ближайший платёж")).toBeTruthy();
      await touch(100);
      expect(screen.getByText("12 ноя · ₴12,260")).toBeTruthy();
      expect(screen.queryByText("Ближайший платёж")).toBeNull();
      expect(screen.queryByText(/Квартплата/)).toBeNull();
      await touch(100);
      expect(screen.queryByText(/12 ноя/)).toBeNull();
      expect(screen.getByText("Ближайший платёж")).toBeTruthy();
      expect(screen.getByText("Квартплата · 13 ноя")).toBeTruthy();
    });

    it("pressed, opens how that payment was paid", async () => {
      const onPay = jest.fn();
      await render(<Runway runway={two()} today="2026-11-11" onPay={onPay} />);
      const row = screen.getByRole("button", { name: "Ближайший платёж: Квартплата, 13 ноя, ₴3,000: отметить оплату" });
      expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(tokens.touchMin);
      await fireEvent.press(row);
      expect(onPay).toHaveBeenCalledTimes(1);
      expect(onPay).toHaveBeenCalledWith("7");
    });
  });

  it("a shortfall is the same figure in sand, with the day the money ends", async () => {
    await render(<Runway runway={shortRun()} today="2026-11-11" />);
    expect(StyleSheet.flatten(screen.getByText("−₴2,400").props.style).color).toBe(tokens.color.limit.low);
    await measure();
    expect(screen.getByText("ноль 14 ноя")).toBeTruthy();
  });

  it("without an income date it is the reserve for 30 days, and the axis ends on a plain date", async () => {
    await render(<Runway runway={run({ incomeOn: null })} today="2026-11-11" />);
    expect(screen.getByText("Запас на 30 дней")).toBeTruthy();
    expect(screen.getByText("15 ноя")).toBeTruthy();
    expect(screen.queryByText(/доход/)).toBeNull();
  });

  it("a touch tells the nearest day: its date, the money and the payment of that day", async () => {
    await render(<Runway runway={run()} today="2026-11-11" />);
    await measure();
    await touch(190); // the days stand at 0, 100, 200, 300, 400
    expect(screen.getByText("13 ноя · ₴10,260")).toBeTruthy();
    expect(screen.getByText("Квартплата −₴3,000")).toBeTruthy();
    // Nothing to press unless the screen can mark a payment paid.
    expect(screen.queryByRole("button", { name: /Квартплата/ })).toBeNull();
    await touch(310, "responderMove");
    expect(screen.getByText("14 ноя · ₴5,260")).toBeTruthy();
    expect(screen.queryByText(/Квартплата/)).toBeNull();
    await touch(5, "responderMove");
    expect(screen.getByText("Сегодня · ₴13,500")).toBeTruthy();
    await touch(399, "responderMove");
    expect(screen.getByText("15 ноя · ₴3,100")).toBeTruthy();
    expect(screen.getByText("день дохода")).toBeTruthy();
  });

  it("a second touch on the same day puts the note away", async () => {
    await render(<Runway runway={run()} today="2026-11-11" />);
    await measure();
    await touch(100);
    expect(screen.getByText("12 ноя · ₴12,260")).toBeTruthy();
    await touch(100);
    expect(screen.queryByText(/12 ноя/)).toBeNull();
  });

  describe("sharing the touch with the page", () => {
    it("a mostly vertical drag goes to the page and leaves no day chosen by it", async () => {
      await render(<Runway runway={run()} today="2026-11-11" />);
      await measure();
      await touch(100);
      expect(screen.getByText("12 ноя · ₴12,260")).toBeTruthy();
      await touch(104, "responderMove", 40);
      expect(yields()).toBe(true);
      // The touch turned into a scroll: the day it picked on the way down is put back.
      expect(screen.queryByText(/12 ноя/)).toBeNull();
      // Sideways moves later in the same scroll do not scrub.
      await touch(300, "responderMove", 60);
      expect(screen.queryByText(/14 ноя/)).toBeNull();
      await giveUp();
      // The day's note is «12 ноя · ₴…»; the axis ends in «15 ноя · доход» (ЧЛ5).
      expect(screen.queryByText(/ноя · ₴/)).toBeNull();
      expect(screen.getByText("Ближайший платёж")).toBeTruthy();
    });

    it("a scroll that starts on the chosen day does not put the day away", async () => {
      await render(<Runway runway={run()} today="2026-11-11" />);
      await measure();
      await touch(100);
      expect(screen.getByText("12 ноя · ₴12,260")).toBeTruthy();
      // A second touch on the same day would put the note away, but it becomes a pull.
      await touch(100);
      expect(screen.queryByText(/12 ноя/)).toBeNull();
      await touch(100, "responderMove", 50);
      await giveUp();
      expect(screen.getByText("12 ноя · ₴12,260")).toBeTruthy();
    });

    it("the page can take a touch that has not started scrubbing, and gets it whole", async () => {
      await render(<Runway runway={run()} today="2026-11-11" />);
      await measure();
      await touch(200);
      expect(yields()).toBe(true);
      // The page took it before any move (iOS starts its own scroll): nothing the touch did stays.
      await giveUp();
      expect(screen.queryByText(/13 ноя ·/)).toBeNull();
    });

    it("a mostly horizontal drag scrubs the days and keeps the touch from the page", async () => {
      await render(<Runway runway={run()} today="2026-11-11" />);
      await measure();
      await touch(100);
      await touch(300, "responderMove", 20);
      expect(screen.getByText("14 ноя · ₴5,260")).toBeTruthy();
      expect(yields()).toBe(false);
      // Once scrubbing, the finger may wander up and down.
      await touch(200, "responderMove", 80);
      expect(screen.getByText("13 ноя · ₴10,260")).toBeTruthy();
    });

    it("a finger's jitter on a tap does not move the day", async () => {
      await render(<Runway runway={run()} today="2026-11-11" />);
      await measure();
      await touch(148);
      expect(screen.getByText("12 ноя · ₴12,260")).toBeTruthy();
      await touch(153, "responderMove", 3); // 153 is nearer the 13th, but it is only jitter
      expect(screen.getByText("12 ноя · ₴12,260")).toBeTruthy();
    });
  });

  it("the payment in the note opens how it was paid", async () => {
    const onPay = jest.fn();
    await render(<Runway runway={run()} today="2026-11-11" onPay={onPay} />);
    await measure();
    await touch(200);
    const row = screen.getByRole("button", { name: "Квартплата, ₴3,000: отметить оплату" });
    expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(tokens.touchMin);
    await fireEvent.press(row);
    expect(onPay).toHaveBeenCalledWith("7");
  });

  it("says the whole picture in words for assistive tech", async () => {
    await render(<Runway runway={shortRun()} today="2026-11-11" />);
    expect(screen.getByLabelText("Запас к доходу −₴2,400. Деньги до нуля 14 ноя. Платежи: Квартплата 13 ноя, ₴3,000.")).toBeTruthy();
  });

  describe("the labels on the chart (ЧЛ5)", () => {
    const three = () =>
      run({
        events: [
          { id: "9", date: "2026-11-14", name: "Интернет", amount: 40_000 },
          { id: "7", date: "2026-11-13", name: "Квартплата", amount: 300_000 },
          { id: "8", date: "2026-11-12", name: "Телефон", amount: 20_000 },
        ],
      });

    it("names a payment by its point: the name and the amount with a minus, quiet and on one line", async () => {
      await render(<Runway runway={run()} today="2026-11-11" />);
      // Nothing is placed before the chart knows its width.
      expect(screen.queryByTestId("runway-label-7", HIDDEN)).toBeNull();
      await measure();
      const label = screen.getByTestId("runway-label-7", HIDDEN);
      const name = within(label).getByText("Квартплата", HIDDEN);
      const amount = within(label).getByText("−₴3,000", HIDDEN);
      expect(name.props.numberOfLines).toBe(1);
      expect(StyleSheet.flatten(name.props.style).color).toBe(tokens.color.fg.muted);
      expect(StyleSheet.flatten(amount.props.style).color).toBe(tokens.color.fg.muted);
      expect(StyleSheet.flatten(amount.props.style).fontVariant).toEqual(["tabular-nums"]);
      // Inside the chart, and never wider than its box: a long name is cut, the amount is not.
      const box = StyleSheet.flatten(label.props.style);
      expect(box.position).toBe("absolute");
      expect(box.maxWidth).toBeGreaterThan(0);
      expect(box.maxWidth).toBeLessThanOrEqual(400);
      expect(StyleSheet.flatten(name.props.style).flexShrink).toBe(1);
    });

    it("no more than the two largest payments are named", async () => {
      await render(<Runway runway={three()} today="2026-11-11" />);
      await measure();
      expect(screen.getByTestId("runway-label-7", HIDDEN)).toBeTruthy();
      expect(screen.getByTestId("runway-label-9", HIDDEN)).toBeTruthy();
      expect(screen.queryByTestId("runway-label-8", HIDDEN)).toBeNull();
    });

    it("the end of the line says what is left by the income, in the text's own colour, at the right edge", async () => {
      await render(<Runway runway={run()} today="2026-11-11" showHead={false} />);
      await measure();
      const end = screen.getByTestId("runway-end", HIDDEN);
      expect(end.props.children).toBe("₴3,100");
      const style = StyleSheet.flatten(end.props.style);
      expect(style.color).toBe(tokens.color.fg.default);
      expect(style.fontVariant).toEqual(["tabular-nums"]);
      expect(style.position).toBe("absolute");
      expect(style.textAlign).toBe("right");
    });

    it("below zero the sand «ноль» speaks alone: no figure at the end", async () => {
      await render(<Runway runway={shortRun()} today="2026-11-11" showHead={false} />);
      await measure();
      expect(screen.getByText("ноль 14 ноя", HIDDEN)).toBeTruthy();
      expect(screen.queryByTestId("runway-end", HIDDEN)).toBeNull();
      // The payment is still named.
      expect(screen.getByTestId("runway-label-7", HIDDEN)).toBeTruthy();
    });

    it("with no income date there is no figure at the end either, while the payment is still named", async () => {
      await render(<Runway runway={run({ incomeOn: null })} today="2026-11-11" />);
      await measure();
      expect(screen.getByTestId("runway-label-7", HIDDEN)).toBeTruthy();
      expect(screen.queryByTestId("runway-end", HIDDEN)).toBeNull();
    });

    it("an amount is never cut: the figure at the end has no width of its own and no label grows with the system text", async () => {
      for (const reserve of [0, 500, 50_000, 99_900, 310_000]) {
        const points = run().points.map((p, i, all) => (i === all.length - 1 ? { ...p, balance: reserve } : p));
        const { unmount } = await render(<Runway runway={run({ reserve, points })} today="2026-11-11" showHead={false} />);
        await measure();
        const end = screen.getByTestId("runway-end", HIDDEN);
        const style = StyleSheet.flatten(end.props.style);
        // Held by its right edge only: whatever the text really measures, it is drawn whole.
        expect(style.width).toBeUndefined();
        expect(style.maxWidth).toBeUndefined();
        expect(style.right).toBeGreaterThanOrEqual(0);
        expect(end.props.numberOfLines).toBeUndefined();
        expect(end.props.allowFontScaling).toBe(false);
        await unmount();
      }
      await render(<Runway runway={run()} today="2026-11-11" />);
      await measure();
      const label = screen.getByTestId("runway-label-7", HIDDEN);
      const name = within(label).getByText("Квартплата", HIDDEN);
      const amount = within(label).getByText("−₴3,000", HIDDEN);
      expect(name.props.allowFontScaling).toBe(false);
      expect(amount.props.allowFontScaling).toBe(false);
      // Only the name gives way in a narrow box.
      expect(amount.props.numberOfLines).toBeUndefined();
      expect(StyleSheet.flatten(amount.props.style).flexShrink).toBe(0);
    });

    it("a short name in capitals gets the room it needs", async () => {
      // What these texts measure at 11 pt (San Francisco): the box must not be narrower, or the name is cut for nothing.
      for (const [name, amount, needs] of [["ЖКХ", 99_900, 65.1], ["WWW", 50_000, 71.1], ["ШЩЖЮМ", 888_888_800, 127.7]] as const) {
        const { unmount } = await render(<Runway runway={run({ events: [{ id: "7", date: "2026-11-12", name, amount }] })} today="2026-11-11" />);
        await measure();
        expect(StyleSheet.flatten(screen.getByTestId("runway-label-7", HIDDEN).props.style).maxWidth).toBeGreaterThanOrEqual(needs);
        await unmount();
      }
    });

    it("the labels take no touch and are not read one by one", async () => {
      await render(<Runway runway={run()} today="2026-11-11" showHead={false} />);
      await measure();
      const labels = screen.getByTestId("runway-labels", HIDDEN);
      expect(labels.props.pointerEvents).toBe("none");
      expect(labels.props.accessibilityElementsHidden).toBe(true);
      expect(labels.props.importantForAccessibility).toBe("no-hide-descendants");
      expect(screen.queryByText("Квартплата")).toBeNull();
      expect(screen.queryByText("₴3,100")).toBeNull();
      // A touch on the label's own place still picks the day under it.
      await touch(200);
      expect(screen.getByText("13 ноя · ₴10,260")).toBeTruthy();
      expect(screen.getByText("Квартплата −₴3,000")).toBeTruthy();
    });

    it("without its head the chart itself says the whole picture in words", async () => {
      await render(<Runway runway={shortRun()} today="2026-11-11" showHead={false} />);
      expect(screen.getByLabelText("Запас к доходу −₴2,400. Деньги до нуля 14 ноя. Платежи: Квартплата 13 ноя, ₴3,000.")).toBeTruthy();
    });
  });

  it("on the income's day there is nothing to draw: only the figure", async () => {
    await render(<Runway runway={run({ points: [{ date: "2026-11-11", balance: 310_000 }], events: [] })} today="2026-11-11" />);
    expect(screen.getByText("₴3,100")).toBeTruthy();
    expect(screen.queryByTestId("runway-chart")).toBeNull();
    expect(screen.queryByText("сегодня")).toBeNull();
  });
});
