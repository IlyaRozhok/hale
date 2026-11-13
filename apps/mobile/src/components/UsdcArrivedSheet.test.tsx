import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { UsdcArrivedSheet } from "./UsdcArrivedSheet";
import { NetworkError } from "../api/client";
import { fakeApi, renderWith } from "../testing";

const noop = () => undefined;
const sheet = (over: Partial<Parameters<typeof UsdcArrivedSheet>[0]> = {}) => (
  <UsdcArrivedSheet eventId={12} expectedAmount={270_000} onClose={noop} onSaved={noop} {...over} />
);
const save = async (amount: string) => {
  await fireEvent.changeText(screen.getByLabelText("Пришло, $"), amount);
  await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
};

describe("«Сколько пришло на Binance?»", () => {
  it("opens with the expected amount filled in and says what was expected, in one phrase", async () => {
    await renderWith(sheet(), fakeApi());
    expect(screen.getByText("Сколько пришло на Binance?")).toBeTruthy();
    expect(screen.getByLabelText("Пришло, $").props.value).toBe("2700");
    expect(screen.getByText("Ожидали $2,700. Если пришло другое — поправьте.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeTruthy();
  });

  it("sends the amount that arrived in cents, then reports it saved and closes", async () => {
    const api = fakeApi();
    const onClose = jest.fn();
    const onSaved = jest.fn();
    await renderWith(sheet({ onClose, onSaved }), api);
    await save("2 600,50");
    await waitFor(() => expect(api.confirmIncome).toHaveBeenCalledWith(12, 260_050));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty, malformed or zero amount before sending", async () => {
    const api = fakeApi();
    await renderWith(sheet(), api);
    for (const amount of ["", "abc", "0", "-5"]) {
      await save(amount);
      expect(await screen.findByText("Проверьте сумму.")).toBeTruthy();
    }
    expect(api.confirmIncome).not.toHaveBeenCalled();
  });

  it("keeps the amount and says so when the save fails", async () => {
    const onClose = jest.fn();
    const confirmIncome = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(sheet({ onClose }), fakeApi({ confirmIncome }));
    await save("2600");
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(screen.getByLabelText("Пришло, $").props.value).toBe("2600");
    expect(onClose).not.toHaveBeenCalled();
  });
});
