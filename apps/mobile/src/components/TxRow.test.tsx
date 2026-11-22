import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import { txFixture } from "../testing";
import { TxRow } from "./TxRow";

const { color, radius } = tokens;
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

describe("TxRow, soft graphite (variant «Б»)", () => {
  it("sits on the solid card fill, rounded at the ends of the day, with the icon a bare glyph", async () => {
    await render(
      <>
        <TxRow tx={txFixture({ id: 1 })} onPress={() => {}} first last={false} />
        <TxRow tx={txFixture({ id: 2 })} onPress={() => {}} first={false} last />
      </>,
    );
    const [top, bottom] = screen.getAllByRole("button");
    expect(flat(top!)).toMatchObject({ backgroundColor: color.card.fill, borderTopLeftRadius: radius.card });
    expect(flat(bottom!)).toMatchObject({ backgroundColor: color.card.fill, borderBottomLeftRadius: radius.card });
    const icon = flat(screen.getAllByTestId(/^tx-icon-/)[0]!);
    expect(icon.backgroundColor).toBeUndefined();
  });

  it("starts the hairline between operations at the text, after the icon", async () => {
    await render(
      <>
        <TxRow tx={txFixture({ id: 1 })} onPress={() => {}} first last={false} />
        <TxRow tx={txFixture({ id: 2 })} onPress={() => {}} first={false} last />
      </>,
    );
    for (const row of screen.getAllByRole("button")) expect(flat(row).borderTopWidth ?? 0).toBe(0);
    const [first, second] = screen.getAllByTestId("tx-line");
    expect(flat(first!).borderTopWidth ?? 0).toBe(0);
    expect(flat(second!)).toMatchObject({ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge });
  });
});
