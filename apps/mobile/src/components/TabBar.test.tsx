import { fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import { TabBar } from "./TabBar";

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const routes = ["Today", "Activity", "Plan"].map((name) => ({ key: `${name}-k`, name }));

function setup(index = 0, defaultPrevented = false) {
  const navigation = { emit: jest.fn(() => ({ defaultPrevented })), navigate: jest.fn() };
  const ui = (
    <SafeAreaProvider initialMetrics={METRICS}>
      <TabBar state={{ index, routes } as never} navigation={navigation as never} />
    </SafeAreaProvider>
  );
  return { navigation, ui };
}

describe("TabBar", () => {
  it("is icons only, with a Russian name for assistive tech and the current tab selected", async () => {
    await render(setup(1).ui);
    expect(screen.getByRole("tab", { name: "Сегодня" }).props.accessibilityState.selected).toBe(false);
    expect(screen.getByRole("tab", { name: "Операции" }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole("tab", { name: "План" })).toBeTruthy();
    expect(screen.queryByText("Операции")).toBeNull();
    expect(screen.getByTestId("icon-home")).toBeTruthy();
    expect(screen.getByTestId("icon-list")).toBeTruthy();
    expect(screen.getByTestId("icon-target")).toBeTruthy();
  });

  it("goes to another tab, and stays put on the current one", async () => {
    const { navigation, ui } = setup(0);
    await render(ui);
    await fireEvent.press(screen.getByRole("tab", { name: "План" }));
    expect(navigation.navigate).toHaveBeenCalledWith("Plan");
    navigation.navigate.mockClear();
    await fireEvent.press(screen.getByRole("tab", { name: "Сегодня" }));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("marks the active tab with the accent fill and keeps touch targets big enough", async () => {
    await render(setup(0).ui);
    const on = StyleSheet.flatten(screen.getByRole("tab", { name: "Сегодня" }).props.style);
    expect(on.backgroundColor).toBe(tokens.color.accent.default);
    expect(on.minHeight).toBeGreaterThanOrEqual(tokens.touchMin);
    expect(StyleSheet.flatten(screen.getByRole("tab", { name: "План" }).props.style).backgroundColor).toBeUndefined();
  });
});
