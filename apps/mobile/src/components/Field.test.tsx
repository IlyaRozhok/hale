import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import { Field } from "./Field";
import { TodaySkeleton } from "./TodaySkeleton";

describe("fills that must show on the soft graphite", () => {
  it("an input has its own fill, lighter than the screen and the card", async () => {
    await render(<Field label="Поиск" />);
    expect(StyleSheet.flatten(screen.getByLabelText("Поиск").props.style).backgroundColor).toBe(tokens.color.field.fill);
  });

  it("the loading bars of Today use the skeleton fill", async () => {
    await render(<TodaySkeleton />);
    const bars = screen.getAllByTestId("skeleton-bar");
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) expect(StyleSheet.flatten(bar.props.style).backgroundColor).toBe(tokens.color.skeleton);
  });
});
