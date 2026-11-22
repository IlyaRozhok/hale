import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import { DateRow, ListRow, ListRows, PlanSection } from "./PlanList";

const { color, radius } = tokens;
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

describe("PlanList, soft graphite (variant «Б»)", () => {
  it("a section's card is one step above the screen, rounder, with no line around it", async () => {
    await render(
      <PlanSection title="Счета">
        <ListRow key="a" icon="cash" label="Наличные" value="₴15,600" />
      </PlanSection>,
    );
    const card = flat(screen.getByTestId("plan-card"));
    expect(card.backgroundColor).toBe(color.card.fill);
    expect(card.borderRadius).toBe(radius.card);
    expect(card.borderWidth ?? 0).toBe(0);
    expect(flat(screen.getByText("Счета")).color).toBe(color.list.secondary);
  });

  it("draws the icon as a bare glyph, with no square behind it", async () => {
    await render(<ListRow icon="cash" label="Наличные" value="₴15,600" onPress={() => {}} />);
    const icon = flat(screen.getByTestId("row-icon"));
    expect(icon.backgroundColor).toBeUndefined();
    expect(icon.borderRadius).toBeUndefined();
  });

  it("puts the value in a softer grey than the name, and a count quieter still", async () => {
    await render(
      <ListRows>
        <ListRow key="a" icon="cash" label="Наличные" value="₴15,600" />
        <ListRow key="b" icon="arrowDown" label="Доходы" value="2" quiet />
      </ListRows>,
    );
    expect(flat(screen.getByText("Наличные")).color).toBe(color.fg.default);
    expect(flat(screen.getByText("₴15,600")).color).toBe(color.list.value);
    expect(flat(screen.getByText("2")).color).toBe(color.list.secondary);
  });

  it("starts the hairline between rows at the text, after the icon, not at the card's edge", async () => {
    await render(
      <ListRows>
        <ListRow key="a" icon="cash" label="Наличные" value="₴15,600" />
        <ListRow key="b" icon="card" label="Чёрная карта" value="₴1,700" />
      </ListRows>,
    );
    const [first, second] = screen.getAllByTestId("row-line");
    expect(flat(first!).borderTopWidth ?? 0).toBe(0);
    expect(flat(second!)).toMatchObject({ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge });
    // The row as a whole (with its icon) has no line of its own.
    for (const row of screen.getAllByTestId("plan-row")) expect(flat(row).borderTopWidth ?? 0).toBe(0);
  });

  it("writes the date of «До дохода» on one line, «6 дек», in a fixed column of tabular figures", async () => {
    await render(
      <ListRows>
        <DateRow key="a" date="2026-12-06" label="Квартплата" value="−₴8,000" />
        <DateRow key="b" date="2026-12-15" label="Доход" value="+₴60,000" income />
      </ListRows>,
    );
    const date = screen.getByText("6 дек");
    expect(flat(date)).toMatchObject({ color: color.list.secondary, fontVariant: ["tabular-nums"] });
    expect(flat(screen.getByTestId("date-column-2026-12-06")).width).toBe(56);
    expect(screen.queryByText("6")).toBeNull();
    expect(screen.queryByText("дек")).toBeNull();
    expect(flat(screen.getByText("+₴60,000")).color).toBe(color.money.income);
    expect(screen.getByLabelText("6 декабря, Квартплата, −₴8,000")).toBeTruthy();
  });

  it("runs the hairline of the date rows from the card's left padding, across the date", async () => {
    await render(
      <ListRows>
        <DateRow key="a" date="2026-12-06" label="Квартплата" value="−₴8,000" />
        <DateRow key="b" date="2026-12-12" label="Рассрочка" value="−₴2,400" />
      </ListRows>,
    );
    const [first, second] = screen.getAllByTestId("date-row");
    expect(flat(first!).borderTopWidth ?? 0).toBe(0);
    expect(flat(second!)).toMatchObject({ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge });
  });
});
