import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import { RepayLoanSheet } from "./RepayLoanSheet";
import { ApiError } from "../api/client";
import { kyivDate, shiftDate } from "../format";
import { fakeApi, pickDate, renderWith } from "../testing";

const NAME = "Займ ₴5,000 от 01.11";
const open = async (api = fakeApi(), onClose = jest.fn()) => {
  await renderWith(<RepayLoanSheet loanId={7} remaining={500_000} name={NAME} onClose={onClose} />, api);
  return { api, onClose };
};

describe("the repayment form", () => {
  it("names the loan and asks for the amount and date, with what is owed filled in", async () => {
    const { api, onClose } = await open();
    expect(screen.getByText(NAME)).toBeTruthy();
    expect(screen.getByLabelText("Сумма").props.value).toBe("5000");
    const yesterday = shiftDate(kyivDate(), -1);
    await pickDate("Дата", yesterday);
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.repayLoan).toHaveBeenCalledWith(7, { amount: 500_000, date: yesterday }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("says what a different repayment amount will do, and rejects a bad one", async () => {
    const { api } = await open();
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "2000");
    expect(screen.getByText("Останется ₴3,000, займ будет открыт.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "5500");
    expect(screen.getByText("₴500 сверх займа уйдут в обслуживание.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "ноль");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    expect(screen.getByText("Проверьте сумму и дату.")).toBeTruthy();
    expect(api.repayLoan).not.toHaveBeenCalled();
  });

  it("the button works while the keyboard is up", async () => {
    await open();
    let node = screen.getByText("Сохранить").parent;
    while (node && node.props.keyboardShouldPersistTaps === undefined) node = node.parent;
    expect(node?.props.keyboardShouldPersistTaps).toBe("handled");
  });

  it("says what is wrong when the repayment date does not fit the loan", async () => {
    const repayLoan = jest.fn(async () => {
      throw new ApiError(422);
    });
    const { onClose } = await open(fakeApi({ repayLoan }));
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    const text = await screen.findByText("Дата должна быть не раньше дня займа и не позже сегодня.");
    expect(StyleSheet.flatten(text.props.style).color).toBe(tokens.color.status.danger);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open when the save fails", async () => {
    const repayLoan = jest.fn(async () => {
      throw new Error("boom");
    });
    const { onClose } = await open(fakeApi({ repayLoan }));
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(screen.getByLabelText("Сумма")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the repayment window", () => {
  const touch = (y: number, timestamp: number) => ({ nativeEvent: { pageX: 100, pageY: y, timestamp, touches: [{}] } });
  const swipe = async (to: number, ms: number) => {
    const panel = screen.getByTestId("sheet-panel");
    await fireEvent(panel, "touchStart", touch(400, 0));
    await fireEvent(panel, "touchMove", touch(410, ms / 2));
    await fireEvent(panel, "touchMove", touch(to, ms));
    await fireEvent(panel, "touchEnd", touch(to, ms));
  };

  it("closes when swiped down far enough", async () => {
    const { onClose } = await open();
    await swipe(600, 400);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("stays open after a short, slow drag", async () => {
    const { onClose } = await open();
    await swipe(450, 1000);
    await act(async () => new Promise<void>((r) => setTimeout(r, 300)));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Сумма")).toBeTruthy();
  });

  it("closes with the button too", async () => {
    const { onClose } = await open();
    const closes = screen.getAllByRole("button", { name: "Закрыть" });
    await fireEvent.press(closes[closes.length - 1]!);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
