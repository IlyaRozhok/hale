import { screen, within } from "@testing-library/react-native";
import { FiltersSheet } from "./FiltersSheet";
import { fakeApi, renderWith } from "../testing";

const noop = () => undefined;

describe("FiltersSheet (ЯМ2)", () => {
  it("«Показать» and «Сбросить» are pinned under the scrolling choices, always in sight", async () => {
    await renderWith(
      <FiltersSheet
        today="2026-11-23"
        value={{ period: null, category: null, account: null }}
        withCategories
        accounts={[{ kind: "black", name: "Чёрная карта" }]}
        onApply={noop}
        onClose={noop}
      />,
      fakeApi(),
    );
    const body = screen.getByTestId("sheet-body");
    expect(await within(body).findByRole("button", { name: "Неделя" })).toBeTruthy();
    expect(within(body).getByRole("button", { name: "Чёрная карта" })).toBeTruthy();
    expect(within(body).queryByRole("button", { name: "Показать" })).toBeNull();
    expect(within(body).queryByRole("button", { name: "Сбросить" })).toBeNull();
    const footer = screen.getByTestId("sheet-footer");
    expect(within(footer).getByRole("button", { name: "Показать" })).toBeTruthy();
    expect(within(footer).getByRole("button", { name: "Сбросить" })).toBeTruthy();
  });
});
