import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { LoansSheet } from "./LoansSheet";
import { NetworkError } from "../api/client";
import { useToday } from "../api/queries";
import { fakeApi, loanFixture, loanHistoryFixture, renderWith } from "../testing";

const noop = () => undefined;
const pressAlert = (alert: jest.SpyInstance, label: string) => {
  const buttons = alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  buttons.find((b) => b.text === label)!.onPress!();
};

/** Stands for the Today screen: it holds the day's figures while the loans are open. */
function TodayHolder() {
  useToday();
  return null;
}

/** One loan entered by hand, "Друг": ₴5,000 from 01.11, nothing repaid. It leaves the list once changed. */
const oneLoan = (over: Parameters<typeof fakeApi>[0] = {}) => {
  let open = true;
  const gone = async () => {
    open = false;
  };
  return fakeApi({
    loanHistory: jest.fn(async () => loanHistoryFixture({ open: open ? [loanFixture()] : [] })),
    deleteLoan: jest.fn(gone),
    repayLoan: jest.fn(gone),
    ...over,
  });
};

const show = async (api: ReturnType<typeof fakeApi>) => {
  await renderWith(
    <>
      <TodayHolder />
      <LoansSheet onClose={noop} />
    </>,
    api,
  );
  await screen.findByText("Друг");
  await waitFor(() => expect(api.today).toHaveBeenCalledTimes(1));
};

describe("the loans list in Plan", () => {
  let alert: jest.SpyInstance;
  beforeEach(() => {
    alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
  });
  afterEach(() => alert.mockRestore());

  it("deletes a mistaken loan entered by hand, after asking, and Today is counted again", async () => {
    const api = oneLoan();
    await show(api);
    await fireEvent.press(screen.getByRole("button", { name: "Удалить: Друг" }));
    expect(alert.mock.calls.at(-1)![0]).toBe("Удалить ошибочную запись?");
    expect(api.deleteLoan).not.toHaveBeenCalled();
    await act(async () => pressAlert(alert, "Удалить"));
    await waitFor(() => expect(api.deleteLoan).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.queryByText("Друг")).toBeNull());
    await waitFor(() => expect(api.today).toHaveBeenCalledTimes(2));
  });

  it("keeps the loan when the question is answered with no", async () => {
    const api = oneLoan();
    await show(api);
    await fireEvent.press(screen.getByRole("button", { name: "Удалить: Друг" }));
    const buttons = alert.mock.calls.at(-1)![2] as { text: string; style?: string; onPress?: () => void }[];
    expect(buttons.find((b) => b.text === "Оставить")).toEqual({ text: "Оставить", style: "cancel" });
    expect(api.deleteLoan).not.toHaveBeenCalled();
    expect(screen.getByText("Друг")).toBeTruthy();
  });

  it("says so when the deletion does not go through, and keeps the loan", async () => {
    const api = oneLoan({
      deleteLoan: jest.fn(async () => {
        throw new NetworkError();
      }),
    });
    await show(api);
    await fireEvent.press(screen.getByRole("button", { name: "Удалить: Друг" }));
    await act(async () => pressAlert(alert, "Удалить"));
    await waitFor(() => expect(alert.mock.calls.at(-1)![0]).toBe("Не удалось удалить займ"));
    expect(screen.getByText("Друг")).toBeTruthy();
  });

  it("repays a loan from the list: the form opens with what is owed, and Today is counted again", async () => {
    const api = oneLoan();
    await show(api);
    await fireEvent.press(screen.getByRole("button", { name: "Погасил: Друг" }));
    expect(screen.getByLabelText("Сумма").props.value).toBe("5000");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.repayLoan).toHaveBeenCalledWith(7, expect.objectContaining({ amount: 500_000 })));
    await waitFor(() => expect(screen.queryByLabelText("Сумма")).toBeNull());
    await waitFor(() => expect(screen.queryByText("Друг")).toBeNull());
    await waitFor(() => expect(api.today).toHaveBeenCalledTimes(2));
  });
});
