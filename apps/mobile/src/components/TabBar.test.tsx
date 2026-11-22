import { fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import { TabBar } from "./TabBar";
import { fakeApi, renderWith } from "../testing";

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const routes = ["Today", "Activity", "Plan", "Insights"].map((name) => ({ key: `${name}-k`, name }));

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
  it("floats over the content, so that the content scrolls under its glass", async () => {
    await render(setup().ui);
    const bar = screen.getByTestId("tab-bar");
    expect(StyleSheet.flatten(bar.props.style)).toMatchObject({ position: "absolute", left: 0, right: 0, bottom: 0 });
  });

  it("is icons only: the current one white, the others dim, no names and no plate", async () => {
    await render(setup(1).ui);
    expect(screen.getByRole("tab", { name: "Сегодня" }).props.accessibilityState.selected).toBe(false);
    expect(screen.getByRole("tab", { name: "Операции" }).props.accessibilityState.selected).toBe(true);
    for (const name of ["Сегодня", "Операции", "План", "Итоги"]) expect(screen.queryByText(name)).toBeNull();
    expect(screen.getByTestId("icon-list").props.accessibilityHint).toBe(tokens.color.fg.default);
    expect(screen.getByTestId("icon-home").props.accessibilityHint).toBe(tokens.color.fg.subtle);
    expect(screen.getByTestId("icon-target").props.accessibilityHint).toBe(tokens.color.fg.subtle);
    expect(screen.getByTestId("icon-chart").props.accessibilityHint).toBe(tokens.color.fg.subtle);
    expect(StyleSheet.flatten(screen.getByRole("tab", { name: "Операции" }).props.style).backgroundColor).toBeUndefined();
  });

  it("goes to another tab, and stays put on the current one", async () => {
    const { navigation, ui } = setup(0);
    await render(ui);
    await fireEvent.press(screen.getByRole("tab", { name: "План" }));
    expect(navigation.navigate).toHaveBeenCalledWith("Plan");
    await fireEvent.press(screen.getByRole("tab", { name: "Итоги" }));
    expect(navigation.navigate).toHaveBeenCalledWith("Insights");
    navigation.navigate.mockClear();
    await fireEvent.press(screen.getByRole("tab", { name: "Сегодня" }));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("keeps touch targets big enough", async () => {
    await render(setup(0).ui);
    for (const name of ["Сегодня", "Операции", "План", "Итоги"]) {
      expect(StyleSheet.flatten(screen.getByRole("tab", { name }).props.style).minHeight).toBeGreaterThanOrEqual(tokens.touchMin);
    }
    expect(StyleSheet.flatten(screen.getByRole("button", { name: "Добавить операцию" }).props.style).minHeight).toBeGreaterThanOrEqual(tokens.touchMin);
  });

  it("a round button beside the menu opens «Добавить» from any screen (Д5)", async () => {
    await renderWith(setup(2).ui, fakeApi({ cash: jest.fn(async () => ({ started: true, start: "2026-11-01", balance: 250_000 })) }));
    expect(screen.queryByText("Добавить")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Добавить операцию" }));
    expect(await screen.findByText("Добавить")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Трата" }));
    expect(await screen.findByLabelText("Сумма")).toBeTruthy();
  });
});
