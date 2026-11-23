import { screen, within } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { Sheet } from "./Sheet";
import { fakeApi, renderWith } from "../testing";

const noop = () => undefined;

describe("Sheet footer (ЯМ2)", () => {
  it("a footer stays below the scrolling body, not inside it", async () => {
    await renderWith(
      <Sheet title="Окно" onClose={noop} footer={<Text>Внизу</Text>}>
        <Text>Содержимое</Text>
      </Sheet>,
      fakeApi(),
    );
    const body = screen.getByTestId("sheet-body");
    expect(within(body).getByText("Содержимое")).toBeTruthy();
    expect(within(body).queryByText("Внизу")).toBeNull();
    const footer = screen.getByTestId("sheet-footer");
    expect(within(footer).getByText("Внизу")).toBeTruthy();
    // It sits in the panel, so it shares the panel's side padding and the bottom inset under it.
    expect(within(screen.getByTestId("sheet-panel")).getByTestId("sheet-footer")).toBeTruthy();
    expect(StyleSheet.flatten(footer.props.style)).toMatchObject({ paddingTop: tokens.space.sm });
  });

  it("without a footer the sheet is as before: everything scrolls, no footer at all", async () => {
    await renderWith(
      <Sheet title="Окно" onClose={noop}>
        <Text>Содержимое</Text>
      </Sheet>,
      fakeApi(),
    );
    expect(within(screen.getByTestId("sheet-body")).getByText("Содержимое")).toBeTruthy();
    expect(screen.queryByTestId("sheet-footer")).toBeNull();
  });
});
