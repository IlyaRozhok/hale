import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import type { RunwayDto, TodayDto } from "@hale/contracts";
import { PaymentsSection } from "./PaymentsSection";

const TODAY = "2026-11-24";
type Event = RunwayDto["events"][number];
const { color, touchMin } = tokens;

const event = (id: string, date: string, amount: number, name: string): Event => ({ id, date, name, amount });
const due = (id: string, dueOn: string): TodayDto["upcoming"][number] => ({ id, name: "—", amount: 1, dueOn, kind: "obligation", currency: "UAH" });
const run = (events: Event[], over: Partial<RunwayDto> = {}): RunwayDto => ({ endOn: "2026-12-03", incomeOn: "2026-12-03", reserve: 520_000, zeroOn: null, points: [], events, ...over });
const three = [event("1", "2026-11-25", 1_700_000, "Квартплата"), event("2", "2026-11-28", 35_000, "Интернет"), event("3", "2026-12-02", 445_000, "Рассрочка")];
const five = [...three, event("4", "2026-12-02", 250_000, "Телефон"), event("5", "2026-12-03", 100_000, "Спортзал")];
const listed = (events: Event[]) => events.map((e) => due(e.id, e.date));
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

describe("PaymentsSection (ЧЛ6)", () => {
  it("is not drawn without payments, without an income date and without a runway", async () => {
    const { rerender } = await render(<PaymentsSection runway={run([])} upcoming={[]} today={TODAY} />);
    expect(screen.queryByText("Платежи")).toBeNull();
    await rerender(<PaymentsSection runway={run(three, { incomeOn: null })} upcoming={listed(three)} today={TODAY} />);
    expect(screen.queryByText("Платежи")).toBeNull();
    await rerender(<PaymentsSection runway={null} upcoming={listed(three)} today={TODAY} />);
    expect(screen.queryByText("Платежи")).toBeNull();
    expect(screen.queryByTestId("payments-section")).toBeNull();
  });

  it("the header names the section and, quietly at the right, how many payments and how much", async () => {
    await render(<PaymentsSection runway={run(three)} upcoming={listed(three)} today={TODAY} />);
    expect(flat(screen.getByText("Платежи"))).toMatchObject({ fontSize: 15, fontWeight: "600", color: color.fg.default });
    expect(flat(screen.getByText("3 до дохода · ₴21,800")).color).toBe(color.fg.muted);
    // 26 pt of air above, of which the screen's own gap is 12; no card and no fill.
    const section = flat(screen.getByTestId("payments-section"));
    expect(section.marginTop).toBe(26 - tokens.space.md);
    expect(section.backgroundColor).toBeUndefined();
  });

  it("a row: the day over the short month, the name with the due words under it, the amount at the right", async () => {
    await render(<PaymentsSection runway={run(three)} upcoming={listed(three)} today={TODAY} />);
    expect(flat(screen.getByText("25"))).toMatchObject({ fontSize: 17, fontWeight: "500" });
    expect(screen.getByText("28")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getAllByText("ноя")).toHaveLength(2);
    expect(flat(screen.getAllByText("ноя")[0]!)).toMatchObject({ fontSize: 11, color: color.fg.subtle });
    expect(screen.getByText("дек")).toBeTruthy();
    // The name stays on one line and is the one to give way; the amount is never cut.
    const name = screen.getByText("Квартплата");
    expect(name.props.numberOfLines).toBe(1);
    const amount = screen.getByText("₴17,000");
    expect(amount.props.numberOfLines).toBeUndefined();
    expect(flat(amount)).toMatchObject({ fontSize: 15, flexShrink: 0, fontVariant: ["tabular-nums"] });
    expect(screen.getByText("₴350")).toBeTruthy();
    expect(screen.getByText("₴4,450")).toBeTruthy();
    expect(screen.queryByText(/^Ещё/)).toBeNull();
  });

  it("the due words: sand for today, tomorrow and a waiting payment, quiet for the rest; never red", async () => {
    const events = [event("0", TODAY, 10_000, "Вода"), event("1", TODAY, 20_000, "Свет"), event("2", "2026-11-25", 30_000, "Газ"), event("3", "2026-11-28", 40_000, "Интернет")];
    const upcoming = [due("0", "2026-11-06"), due("1", TODAY), due("2", "2026-11-25"), due("3", "2026-11-28")];
    await render(<PaymentsSection runway={run(events)} upcoming={upcoming} today={TODAY} />);
    // The overdue one first, with the day it was really due at the left.
    const texts = screen.getAllByText(/./).map((t) => t.props.children as string);
    expect(texts.indexOf("Вода")).toBeLessThan(texts.indexOf("Свет"));
    expect(texts.slice(texts.indexOf("Платежи") + 2, texts.indexOf("Вода"))).toEqual(["6", "ноя"]);
    for (const words of ["ждёт с 6 ноя", "сегодня", "завтра"]) {
      expect(flat(screen.getByText(words))).toMatchObject({ fontSize: 12, color: color.limit.low });
    }
    // The fourth is not a row.
    expect(screen.queryByText("через 4 дня")).toBeNull();
    expect(screen.getByText("Ещё 1 · ₴400")).toBeTruthy();
    expect(screen.queryByText(/просроч/i)).toBeNull();
    for (const t of screen.getAllByText(/./)) {
      expect([color.limit.over, color.limit.overDeep, color.status.danger]).not.toContain(flat(t).color);
    }
  });

  it("a payment further away says its days quietly", async () => {
    await render(<PaymentsSection runway={run(three)} upcoming={listed(three)} today={TODAY} />);
    expect(flat(screen.getByText("через 4 дня")).color).toBe(color.fg.subtle);
    expect(flat(screen.getByText("через 8 дней")).color).toBe(color.fg.subtle);
  });

  it("a faint hairline between the rows, none above the first; each row is tall enough to press", async () => {
    await render(<PaymentsSection runway={run(five)} upcoming={listed(five)} today={TODAY} onPay={jest.fn()} onOpenPlan={jest.fn()} />);
    const rows = screen.getAllByRole("button");
    expect(rows).toHaveLength(4);
    expect(flat(rows[0]!).borderTopWidth).toBeUndefined();
    for (const row of rows.slice(1)) expect(flat(row)).toMatchObject({ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge });
    for (const row of rows) expect(flat(row).minHeight).toBeGreaterThanOrEqual(touchMin);
  });

  it("a pressed row asks to mark that payment paid", async () => {
    const onPay = jest.fn();
    await render(<PaymentsSection runway={run(three)} upcoming={listed(three)} today={TODAY} onPay={onPay} />);
    await fireEvent.press(screen.getByRole("button", { name: "Интернет, через 4 дня, ₴350: отметить оплату" }));
    expect(onPay).toHaveBeenCalledTimes(1);
    expect(onPay).toHaveBeenCalledWith("2");
    expect(screen.getByRole("button", { name: "Квартплата, завтра, ₴17,000: отметить оплату" })).toBeTruthy();
  });

  it("a payment `upcoming` does not list is plain text, not a button", async () => {
    const onPay = jest.fn();
    await render(<PaymentsSection runway={run(three)} upcoming={[due("1", "2026-11-25"), due("3", "2026-12-02")]} today={TODAY} onPay={onPay} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Интернет/ })).toBeNull();
    expect(screen.getByLabelText("Интернет, через 4 дня, ₴350")).toBeTruthy();
    await fireEvent.press(screen.getByText("Интернет"));
    expect(onPay).not.toHaveBeenCalled();
  });

  it("with nothing to call, the rows are plain text", async () => {
    await render(<PaymentsSection runway={run(five)} upcoming={listed(five)} today={TODAY} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Ещё 2 · ₴3,500")).toBeTruthy();
  });

  it("more than three: «Ещё N · ₴сумма» is the last row and opens the plan", async () => {
    const onOpenPlan = jest.fn();
    const onPay = jest.fn();
    await render(<PaymentsSection runway={run(five)} upcoming={listed(five)} today={TODAY} onPay={onPay} onOpenPlan={onOpenPlan} />);
    expect(screen.getByText("5 до дохода · ₴25,300")).toBeTruthy();
    expect(screen.queryByText("Телефон")).toBeNull();
    expect(screen.queryByText("Спортзал")).toBeNull();
    const more = screen.getByRole("button", { name: "Ещё 2 · ₴3,500" });
    expect(screen.getAllByRole("button").at(-1)).toBe(more);
    await fireEvent.press(more);
    expect(onOpenPlan).toHaveBeenCalledTimes(1);
    expect(onPay).not.toHaveBeenCalled();
  });
});
