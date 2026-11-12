import { fireEvent, render, screen } from "@testing-library/react-native";
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

const touch = (x: number, type: "responderGrant" | "responderMove" = "responderGrant") =>
  fireEvent(screen.getByTestId("runway-chart"), type, { nativeEvent: { locationX: x } });
const measure = () => fireEvent(screen.getByTestId("runway-chart"), "layout", { nativeEvent: { layout: { width: 400, height: 112 } } });

describe("Runway", () => {
  it("names the reserve to the income with one figure and marks only the ends of the axis", async () => {
    await render(<Runway runway={run()} today="2026-11-11" />);
    expect(screen.getByText("Запас к доходу")).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByText("₴3,100").props.style).color).toBe(tokens.color.fg.default);
    expect(screen.getByText("сегодня")).toBeTruthy();
    expect(screen.getByText("доход 15 ноя")).toBeTruthy();
    // No list of dates under the graph: they come by touch. The one payment named is the nearest.
    expect(screen.queryByText(/12 ноя/)).toBeNull();
    expect(screen.queryByText(/14 ноя/)).toBeNull();
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

  it("on the income's day there is nothing to draw: only the figure", async () => {
    await render(<Runway runway={run({ points: [{ date: "2026-11-11", balance: 310_000 }], events: [] })} today="2026-11-11" />);
    expect(screen.getByText("₴3,100")).toBeTruthy();
    expect(screen.queryByTestId("runway-chart")).toBeNull();
    expect(screen.queryByText("сегодня")).toBeNull();
  });
});
