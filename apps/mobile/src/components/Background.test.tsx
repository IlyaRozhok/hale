import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import { Background } from "./Background";

describe("Background, soft graphite (variant «Б»)", () => {
  it("is one flat dark graphite, with no light at the top and nothing drawn on it", async () => {
    await render(<Background />);
    const back = screen.getByTestId("background", { includeHiddenElements: true });
    expect(StyleSheet.flatten(back.props.style).backgroundColor).toBe(tokens.color.surface.base);
    expect(back.props.children ?? null).toBeNull();
  });
});
