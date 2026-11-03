import { render, screen } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { tokens } from "@hale/tokens";
import { Glass } from "./Glass";

jest.mock("expo-glass-effect", () => {
  const { View } = require("react-native");
  return { isLiquidGlassAvailable: jest.fn(() => true), GlassView: (props: object) => <View testID="native-glass" {...props} /> };
});

const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);

describe("Glass", () => {
  beforeEach(() => jest.mocked(isLiquidGlassAvailable).mockReturnValue(true));

  it("a card is a plain fill with a thin edge, with no blur", async () => {
    await render(<Glass testID="card"><Text>Текст</Text></Glass>);
    expect(flat("card")).toMatchObject({ backgroundColor: tokens.color.glass.surface.fill, borderColor: tokens.color.glass.surface.edge, borderWidth: StyleSheet.hairlineWidth });
    expect(screen.queryByTestId("native-glass")).toBeNull();
  });

  it("a floating panel is the system's glass, tinted from the tokens", async () => {
    await render(<Glass kind="floating"><Text>Текст</Text></Glass>);
    expect(screen.getByTestId("native-glass").props.tintColor).toBe(tokens.color.glass.floating.tint);
    expect(screen.getByText("Текст")).toBeTruthy();
  });

  it("falls back to an opaque fill where the system has no such glass", async () => {
    jest.mocked(isLiquidGlassAvailable).mockReturnValue(false);
    await render(<Glass kind="floating" testID="panel"><Text>Текст</Text></Glass>);
    expect(screen.queryByTestId("native-glass")).toBeNull();
    expect(flat("panel").backgroundColor).toBe(tokens.color.glass.floating.fallback);
  });
});
