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

  it("a card is the system's glass too, more strongly tinted, with no fill of its own", async () => {
    await render(<Glass><Text>Текст</Text></Glass>);
    const glass = screen.getByTestId("native-glass");
    expect(glass.props.tintColor).toBe(tokens.color.glass.surface.tint);
    expect(StyleSheet.flatten(glass.props.style).backgroundColor).toBeUndefined();
  });

  it("a card falls back to an opaque fill where the system has no such glass", async () => {
    jest.mocked(isLiquidGlassAvailable).mockReturnValue(false);
    await render(<Glass testID="card"><Text>Текст</Text></Glass>);
    expect(flat("card").backgroundColor).toBe(tokens.color.glass.surface.fallback);
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
