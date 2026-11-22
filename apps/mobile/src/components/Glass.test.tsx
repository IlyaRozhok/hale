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

  it("a card is solid, one step above the screen, round and with no line around it: there is nothing for glass to blur", async () => {
    await render(<Glass testID="card"><Text>Текст</Text></Glass>);
    expect(screen.queryByTestId("native-glass")).toBeNull();
    expect(flat("card")).toMatchObject({ backgroundColor: tokens.color.card.fill, borderRadius: tokens.radius.card });
    expect(flat("card").borderWidth ?? 0).toBe(0);
    jest.mocked(isLiquidGlassAvailable).mockReturnValue(false);
    await render(<Glass testID="card2"><Text>Текст</Text></Glass>);
    expect(flat("card2").backgroundColor).toBe(tokens.color.card.fill);
  });

  it("a floating panel is the system's glass, tinted from the tokens", async () => {
    await render(<Glass kind="floating"><Text>Текст</Text></Glass>);
    expect(screen.getByTestId("native-glass").props.tintColor).toBe(tokens.color.glass.floating.tint);
    expect(screen.getByText("Текст")).toBeTruthy();
  });

  it("the one glass card is lightly tinted glass, and an ordinary solid card where the system has none", async () => {
    await render(<Glass kind="card"><Text>Текст</Text></Glass>);
    expect(screen.getByTestId("native-glass").props.tintColor).toBe(tokens.color.glass.surface.tint);
    jest.mocked(isLiquidGlassAvailable).mockReturnValue(false);
    await render(<Glass kind="card" testID="plain"><Text>Текст</Text></Glass>);
    expect(flat("plain")).toMatchObject({ backgroundColor: tokens.color.card.fill, borderRadius: tokens.radius.card });
  });

  it("the menu is the most see-through", async () => {
    await render(<Glass kind="menu"><Text>Текст</Text></Glass>);
    expect(screen.getByTestId("native-glass").props.tintColor).toBe(tokens.color.glass.menu.tint);
  });

  it("falls back to an opaque fill where the system has no such glass", async () => {
    jest.mocked(isLiquidGlassAvailable).mockReturnValue(false);
    await render(<Glass kind="floating" testID="panel"><Text>Текст</Text></Glass>);
    expect(screen.queryByTestId("native-glass")).toBeNull();
    expect(flat("panel").backgroundColor).toBe(tokens.color.glass.floating.fallback);
  });
});
