import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import { InsetList, ListRow } from "./ListRow";

const { color, radius } = tokens;
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

describe("ListRow and InsetList, soft graphite (variant «Б»)", () => {
  const rows = () => (
    <InsetList testID="list">
      <ListRow testID="r1" iconTestID="i1" icon="cart" title="Еда" amount="₴4,200" accessibilityLabel="Еда" first onPress={() => {}} />
      <ListRow testID="r2" iconTestID="i2" icon="coffee" title="Кафе" amount="₴1,100" accessibilityLabel="Кафе" first={false} onPress={() => {}} />
    </InsetList>
  );

  it("the card is one step above the screen, rounder, with no line around it", async () => {
    await render(rows());
    const card = flat(screen.getByTestId("list"));
    expect(card.backgroundColor).toBe(color.card.fill);
    expect(card.borderRadius).toBe(radius.card);
    expect(card.borderWidth ?? 0).toBe(0);
  });

  it("draws the icon as a bare muted glyph, with no square behind it", async () => {
    await render(rows());
    const icon = flat(screen.getByTestId("i1"));
    expect(icon.backgroundColor).toBeUndefined();
    expect(icon.borderRadius).toBeUndefined();
  });

  it("starts the hairline at the text, after the icon, and the amount is a softer grey", async () => {
    await render(rows());
    expect(flat(screen.getByTestId("r1")).borderTopWidth ?? 0).toBe(0);
    expect(flat(screen.getByTestId("r2")).borderTopWidth ?? 0).toBe(0);
    const [first, second] = screen.getAllByTestId("row-line");
    expect(flat(first!).borderTopWidth ?? 0).toBe(0);
    expect(flat(second!)).toMatchObject({ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge });
    expect(flat(screen.getByText("₴4,200")).color).toBe(color.list.value);
  });
});
