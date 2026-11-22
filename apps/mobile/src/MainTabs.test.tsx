import { StyleSheet } from "react-native";
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { tokens } from "@hale/tokens";
import { MainTabs } from "./MainTabs";
import { fakeApi, renderWith } from "./testing";

// The screens themselves are tested on their own; here only which one is shown and with what.
jest.mock("./screens/Today", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    Today: ({ onOpenActivity }: { onOpenActivity: (day?: string) => void }) => (
      <Pressable accessibilityRole="button" onPress={() => onOpenActivity("2026-11-20")}>
        <Text>экран Сегодня</Text>
      </Pressable>
    ),
  };
});
jest.mock("./screens/Activity", () => {
  const { Text } = jest.requireActual("react-native");
  return { Activity: ({ route }: { route?: { params?: { day?: string; category?: string } } }) => <Text>{`экран Операции ${route?.params?.day ?? route?.params?.category ?? ""}`}</Text> };
});
jest.mock("./screens/Plan", () => {
  const { Text } = jest.requireActual("react-native");
  return { Plan: () => <Text>экран План</Text> };
});
jest.mock("./screens/Insights", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    Insights: ({ onOpenCategory }: { onOpenCategory: (category: string, from: string, to: string) => void }) => (
      <Pressable accessibilityRole="button" onPress={() => onOpenCategory("cafe", "2026-11-01", "2026-11-20")}>
        <Text>экран Итоги</Text>
      </Pressable>
    ),
  };
});

const cash = () => fakeApi({ cash: jest.fn(async () => ({ started: true, start: "2026-11-01", balance: 250_000 })) });
const tab = (name: string) => screen.getByRole("tab", { name });

describe("MainTabs: the native tab bar", () => {
  it("has four tabs and «Добавить» apart, in the search place, named for VoiceOver only", async () => {
    await renderWith(<MainTabs />, cash());
    for (const name of ["Сегодня", "Операции", "План", "Итоги", "Добавить"]) {
      expect(tab(name)).toBeTruthy();
      // Icons only: the name is the tab's accessibility label, not text in the bar.
      expect(screen.queryByText(name)).toBeNull();
    }
    expect(tab("Сегодня").props.accessibilityState.selected).toBe(true);
    // iOS 26 draws the search role as its own glass circle after the tabs.
    expect(screen.getByTestId("tab-role-Add").props.accessibilityHint).toBe("search");
  });

  it("draws an outline symbol for a tab and the filled one for the current tab", async () => {
    await renderWith(<MainTabs />, cash());
    const symbols = { Сегодня: "house", Операции: "list.bullet.rectangle", План: "wallet.bifold", Итоги: "chart.pie" } as const;
    for (const current of Object.keys(symbols)) {
      await fireEvent.press(tab(current));
      await waitFor(() => expect(tab(current).props.accessibilityState.selected).toBe(true));
      for (const [name, symbol] of Object.entries(symbols)) {
        const shown = name === current ? `${symbol}.fill` : symbol;
        expect(within(tab(name)).getByTestId(`tab-symbol-${shown}`)).toBeTruthy();
      }
    }
    expect(within(tab("Добавить")).getByTestId("tab-symbol-plus")).toBeTruthy();
  });

  it("hides the screen of the tab being left, so it never shows through the next one while iOS fades them", async () => {
    await renderWith(<MainTabs />, cash());
    const opacity = (name: string) => (StyleSheet.flatten(screen.getByTestId(`tab-scene-${name}`, { includeHiddenElements: true }).props.style) as { opacity?: number }).opacity;
    expect(opacity("Today")).toBeUndefined();
    await fireEvent.press(tab("План"));
    expect(await screen.findByText("экран План")).toBeTruthy();
    expect(opacity("Today")).toBe(0);
    expect(opacity("Plan")).toBeUndefined();
    await fireEvent.press(tab("Сегодня"));
    await waitFor(() => expect(opacity("Plan")).toBe(0));
    expect(opacity("Today")).toBeUndefined();
  });

  it("tints the current tab white from the tokens, not the system blue", async () => {
    await renderWith(<MainTabs />, cash());
    expect(screen.getByTestId("tab-bar").props.accessibilityHint).toBe(tokens.color.fg.default);
  });

  it("switches tabs", async () => {
    await renderWith(<MainTabs />, cash());
    expect(screen.getByText("экран Сегодня")).toBeTruthy();
    await fireEvent.press(tab("План"));
    expect(await screen.findByText("экран План")).toBeTruthy();
    expect(tab("План").props.accessibilityState.selected).toBe(true);
    await fireEvent.press(tab("Итоги"));
    expect(await screen.findByText("экран Итоги")).toBeTruthy();
  });

  it("«Добавить» opens the add sheet over the current tab and does not leave it (Д5)", async () => {
    await renderWith(<MainTabs />, cash());
    await fireEvent.press(tab("План"));
    await fireEvent.press(tab("Добавить"));
    expect(await screen.findByRole("button", { name: "Трата" })).toBeTruthy();
    expect(tab("План").props.accessibilityState.selected).toBe(true);
    expect(screen.getByText("экран План")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Трата" }));
    expect(await screen.findByLabelText("Сумма")).toBeTruthy();
  });

  it("jumps to «Операции» with the day from «Сегодня» and the category from «Итоги»", async () => {
    await renderWith(<MainTabs />, cash());
    await fireEvent.press(screen.getByRole("button", { name: "экран Сегодня" }));
    expect(await screen.findByText("экран Операции 2026-11-20")).toBeTruthy();
    expect(tab("Операции").props.accessibilityState.selected).toBe(true);
    await fireEvent.press(tab("Итоги"));
    await fireEvent.press(await screen.findByRole("button", { name: "экран Итоги" }));
    await waitFor(() => expect(screen.getByText("экран Операции cafe")).toBeTruthy());
  });
});
