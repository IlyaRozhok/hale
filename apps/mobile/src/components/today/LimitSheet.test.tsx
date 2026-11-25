import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import type { DailyStateDto, LimitPartsDto } from "@hale/contracts";
import { LimitSheet } from "./LimitSheet";
import { limitSheet } from "../../limitSheet";
import { fakeApi, renderWith } from "../../testing";

const TODAY = "2026-11-24";
const HIDDEN = { includeHiddenElements: true };

/** The mockup's morning: ₴53,400 of own money, ₴25,200 free over 9 days. */
const parts = (over: Partial<LimitPartsDto> = {}): LimitPartsDto => ({
  own: 5_340_000,
  taxReserve: 640_000,
  obligationsDue: 2_180_000,
  goalDue: 0,
  borrowed: 0,
  free: 2_520_000,
  daysLeft: 9,
  share: 280_000,
  rule: "share",
  dailyLimit: 280_000,
  ...over,
});

const model = (p: LimitPartsDto, over: Partial<DailyStateDto> = {}, reserve = 0) => {
  const state: DailyStateDto = { mode: "normal", daysLeft: 9, free: 2_444_000, dailyLimit: p.dailyLimit, leftToday: p.dailyLimit - 76_000, level: 0.7, needsIncomeDate: false, bridge: null, parts: p, ...over };
  const sheet = limitSheet(state, { reserve, zeroOn: null, incomeOn: "2026-12-03" }, TODAY);
  if (!sheet) throw new Error("no sheet");
  return sheet;
};

const show = (p: LimitPartsDto, over: Partial<DailyStateDto> = {}, props: { onClose?: () => void; onOpenPlan?: () => void; reserve?: number } = {}) =>
  renderWith(<LimitSheet sheet={model(p, over, props.reserve)} onClose={props.onClose ?? (() => undefined)} onOpenPlan={props.onOpenPlan} />, fakeApi());

/** A row by its words: the row is one element for VoiceOver, named with both its sides. */
const row = (label: string, value: string) => screen.getByLabelText(`${label} ${value}`);
const flexOf = (id: string) => StyleSheet.flatten(screen.getByTestId(id, HIDDEN).props.style).flexGrow;
const fillOf = (id: string) => StyleSheet.flatten(screen.getByTestId(id, HIDDEN).props.style).backgroundColor;

describe("the sheet «Как посчитан лимит» (ЧЛ4)", () => {
  it("shows the own money, what is taken off it, the days, what is spent and the total", async () => {
    await show(parts());
    expect(await screen.findByText("Как посчитан лимит")).toBeTruthy();
    expect(row("Свои деньги на утро", "₴53,400")).toBeTruthy();
    expect(row("отложено на налоги", "−₴6,400")).toBeTruthy();
    expect(row("платежи и возврат займов до дохода", "−₴21,800")).toBeTruthy();
    expect(row("свободно", "₴25,200")).toBeTruthy();
    expect(row("Свободное — на 9 дней", "по ₴2,800 в день")).toBeTruthy();
    expect(row("Потрачено сегодня", "−₴760")).toBeTruthy();
    expect(row("Сегодня можно", "₴2,040")).toBeTruthy();
    // Zero terms have no row.
    expect(screen.queryByText("взносы в цели")).toBeNull();
    expect(screen.queryByText("взято в долг")).toBeNull();
  });

  it("draws the terms as shares of one bar, the free money the one sage share", async () => {
    await show(parts());
    await screen.findByText("Как посчитан лимит");
    const bar = screen.getByTestId("limit-sheet-bar", HIDDEN);
    expect(within(bar).getAllByTestId(/^limit-sheet-share-/, HIDDEN)).toHaveLength(3);
    expect(flexOf("limit-sheet-share-tax")).toBe(640_000);
    expect(flexOf("limit-sheet-share-due")).toBe(2_180_000);
    expect(flexOf("limit-sheet-share-free")).toBe(2_520_000);
    expect(fillOf("limit-sheet-share-free")).toBe(tokens.color.accent.signal);
    expect(fillOf("limit-sheet-share-tax")).not.toBe(fillOf("limit-sheet-share-due"));
    // Each row carries the dot of its share.
    expect(fillOf("limit-sheet-dot-tax")).toBe(fillOf("limit-sheet-share-tax"));
    expect(fillOf("limit-sheet-dot-free")).toBe(tokens.color.accent.signal);
    expect(StyleSheet.flatten(screen.getByText("₴25,200").props.style).color).toBe(tokens.color.accent.signal);
  });

  it("a cell a day, today's the first and the only bright one", async () => {
    await show(parts());
    await screen.findByText("Как посчитан лимит");
    const cells = screen.getAllByTestId("limit-sheet-cell", HIDDEN);
    expect(cells).toHaveLength(9);
    const fills = cells.map((c) => StyleSheet.flatten(c.props.style).backgroundColor);
    expect(fills[0]).toBe(tokens.color.accent.signal);
    expect(new Set(fills.slice(1)).size).toBe(1);
    expect(fills[1]).not.toBe(fills[0]);
    expect(screen.getByText("сегодня")).toBeTruthy();
    expect(screen.getByText("доход 3 дек")).toBeTruthy();
  });

  it("more than 14 days: the line alone, no cells", async () => {
    await show(parts({ daysLeft: 15, share: 168_000, dailyLimit: 168_000 }));
    expect(await screen.findByText("Свободное — на 15 дней")).toBeTruthy();
    expect(screen.getByText("по ₴1,680 в день")).toBeTruthy();
    expect(screen.queryAllByTestId("limit-sheet-cell", HIDDEN)).toHaveLength(0);
    expect(screen.queryByText("сегодня")).toBeNull();
  });

  it("no income date: the phrase why it is 30 days", async () => {
    await show(parts({ daysLeft: 30, share: 84_000, dailyLimit: 84_000, noIncomeDate: true }));
    expect(await screen.findByText("Свободное — на 30 дней")).toBeTruthy();
    expect(screen.getByText("Дата следующего дохода не указана, поэтому расчёт — на 30 дней.")).toBeTruthy();
    expect(screen.queryAllByTestId("limit-sheet-cell", HIDDEN)).toHaveLength(0);
  });

  it("the cap: its line and the reserve under the total", async () => {
    await show(parts({ rule: "cap", dailyLimit: 200_000 }), {}, { reserve: 520_000 });
    await screen.findByText("Как посчитан лимит");
    expect(row("Ваш потолок трат", "₴2,000 в день")).toBeTruthy();
    expect(row("Сегодня можно", "₴1,240")).toBeTruthy();
    expect(screen.getByText("Потолок ниже расчёта, поэтому к доходу останется запас ₴5,200.")).toBeTruthy();
  });

  it("the cap above the share: no phrase about a reserve (the task's required case)", async () => {
    await show(parts({ own: 3_000_000, free: 180_000, share: 20_000, rule: "cap", dailyLimit: 30_000 }), { leftToday: 30_000 }, { reserve: 520_000 });
    await screen.findByText("Как посчитан лимит");
    expect(row("Ваш потолок трат", "₴300 в день")).toBeTruthy();
    expect(screen.queryByText(/останется запас/)).toBeNull();
  });

  it("the recommended sum: one whole line", async () => {
    await show(parts({ own: 3_000_000, free: 180_000, share: 20_000, rule: "floor", dailyLimit: 45_000 }), { leftToday: 45_000 });
    expect(await screen.findByText("Меньше ₴450 в день не ставим")).toBeTruthy();
    expect(row("Сегодня можно", "₴450")).toBeTruthy();
  });

  it("the shortage: what is missing is said plainly, with no bar and no cells, and nothing is red", async () => {
    await show(parts({ own: -300_000, taxReserve: 0, obligationsDue: 200_000, free: -500_000, share: -55_556, rule: "floor", dailyLimit: 45_000 }), { mode: "bridge", leftToday: 45_000 });
    await screen.findByText("Как посчитан лимит");
    expect(row("Свои деньги на утро", "−₴3,000")).toBeTruthy();
    expect(row("не хватает до дохода", "₴5,000")).toBeTruthy();
    expect(screen.queryByTestId("limit-sheet-bar", HIDDEN)).toBeNull();
    expect(screen.queryAllByTestId("limit-sheet-cell", HIDDEN)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^limit-sheet-dot-/, HIDDEN)).toHaveLength(0);
    for (const t of screen.getAllByText(/./)) {
      const c = StyleSheet.flatten(t.props.style)?.color;
      expect([tokens.color.status.danger, tokens.color.limit.over, tokens.color.calendar.farOver, tokens.color.money.expense]).not.toContain(c);
    }
  });

  describe("a confirmed plan", () => {
    const plan = parts({ own: 2_000_000, free: -820_000, share: -91_112, rule: "plan", dailyLimit: 60_000 });
    const bridge = { mode: "bridge" as const, leftToday: 50_000 };

    it("no «на утро», no bar, no cells; the plan's sum and the way to the plan", async () => {
      const onOpenPlan = jest.fn();
      await show(plan, bridge, { onOpenPlan });
      await screen.findByText("Как посчитан лимит");
      expect(row("Свои деньги", "₴20,000")).toBeTruthy();
      expect(screen.queryByText(/на утро/)).toBeNull();
      expect(screen.queryByTestId("limit-sheet-bar", HIDDEN)).toBeNull();
      expect(screen.queryAllByTestId("limit-sheet-cell", HIDDEN)).toHaveLength(0);
      expect(screen.getByText("Свободных денег до дохода нет. Лимит — сумма из плана до дохода.")).toBeTruthy();
      const link = screen.getByRole("button", { name: "План до дохода ₴600 в день" });
      expect(link.props.accessibilityHint).toBe("Открывает план до дохода");
      expect(StyleSheet.flatten(link.props.style).minHeight).toBeGreaterThanOrEqual(tokens.touchMin);
      await fireEvent.press(link);
      expect(onOpenPlan).toHaveBeenCalledTimes(1);
      expect(row("Сегодня можно", "₴500")).toBeTruthy();
    });

    it("with nowhere to lead the line is plain", async () => {
      await show(plan, bridge);
      await screen.findByText("Как посчитан лимит");
      expect(row("План до дохода", "₴600 в день")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^План до дохода/ })).toBeNull();
    });
  });

  it("the day the shortage came on: the new limit from tomorrow under the total", async () => {
    await show(parts(), { mode: "bridge", leftToday: -1_000_000, level: 0, shortageStart: { nextLimit: 45_000 } });
    await screen.findByText("Как посчитан лимит");
    expect(row("Сегодня можно", "₴0")).toBeTruthy();
    expect(screen.getByText("Новый лимит ₴450 действует с завтра")).toBeTruthy();
  });

  it("closes as every sheet does, with «Закрыть»", async () => {
    const onClose = jest.fn();
    await show(parts(), {}, { onClose });
    await fireEvent.press(await screen.findByRole("button", { name: "Закрыть" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
