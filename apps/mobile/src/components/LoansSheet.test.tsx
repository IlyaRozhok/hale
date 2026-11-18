import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { LoansSheet } from "./LoansSheet";
import { NetworkError } from "../api/client";
import { useToday } from "../api/queries";
import { fakeApi, loanFixture, loanHistoryFixture, pickDate, renderWith } from "../testing";

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

  describe("which loans can be deleted (Б48)", () => {
    const list = (open: Parameters<typeof loanFixture>[0][]) =>
      fakeApi({ loanHistory: jest.fn(async () => loanHistoryFixture({ open: open.map((o) => loanFixture(o)) })) });

    it("offers deleting a bank loan whose row is no longer a loan, with the same question", async () => {
      const api = list([{ id: 8, title: "Від: Петро", manual: false, removable: true }, {}]);
      await show(api);
      await fireEvent.press(screen.getByRole("button", { name: "Удалить: Від: Петро" }));
      expect(alert.mock.calls.at(-1)![0]).toBe("Удалить ошибочную запись?");
      await act(async () => pressAlert(alert, "Удалить"));
      await waitFor(() => expect(api.deleteLoan).toHaveBeenCalledWith(8));
    });

    it("does not offer it for a bank loan the server says stays, nor for a manual one it says stays", async () => {
      await show(list([{ id: 8, title: "Кредит", manual: false, removable: false }, { removable: false }]));
      expect(screen.queryByRole("button", { name: /^Удалить/ })).toBeNull();
    });

    it("an older server without the field: only a manual loan can be deleted, as before", async () => {
      await show(list([{ id: 8, title: "Кредит", manual: false }, {}]));
      expect(screen.getByRole("button", { name: "Удалить: Друг" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Удалить: Кредит" })).toBeNull();
    });
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

  describe("«Вернуть до» (Б7)", () => {
    /** One open loan from a person with the given return date; the list follows what was saved. */
    const dated = (dueOn: string | null | undefined) => {
      let due = dueOn;
      return fakeApi({
        loanHistory: jest.fn(async () => loanHistoryFixture({ open: [loanFixture(due === undefined ? {} : { dueOn: due })] })),
        patchLoan: jest.fn(async (_id: number, input: { due_on?: string | null }) => {
          due = input.due_on;
        }),
      });
    };

    it("gives an open loan a return date, and Today is counted again", async () => {
      const api = dated(null);
      await show(api);
      expect(screen.getByRole("button", { name: "Вернуть до, Друг, ₴5,000 от 01.11: не выбрана" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Убрать срок/ })).toBeNull();
      await pickDate("Вернуть до, Друг, ₴5,000 от 01.11", "2026-11-20");
      await waitFor(() => expect(api.patchLoan).toHaveBeenCalledWith(7, { due_on: "2026-11-20" }));
      expect(await screen.findByRole("button", { name: /^Вернуть до, Друг, ₴5,000 от 01.11: 20 ноября/ })).toBeTruthy();
      await waitFor(() => expect(api.today).toHaveBeenCalledTimes(2));
    });

    it("clears the return date", async () => {
      const api = dated("2026-11-20");
      await show(api);
      await fireEvent.press(screen.getByRole("button", { name: "Убрать срок: Друг" }));
      await waitFor(() => expect(api.patchLoan).toHaveBeenCalledWith(7, { due_on: null }));
      expect(await screen.findByRole("button", { name: "Вернуть до, Друг, ₴5,000 от 01.11: не выбрана" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Убрать срок/ })).toBeNull();
    });

    it("names the loan in each date field, so a screen reader tells them apart", async () => {
      const api = fakeApi({
        loanHistory: jest.fn(async () =>
          loanHistoryFixture({
            open: [loanFixture({ dueOn: null }), loanFixture({ id: 8, title: "Кредит до завтра", manual: false, amount: 200_000, remaining: 150_000, receivedOn: "2026-11-02", dueOn: "2026-11-20" })],
          }),
        ),
      });
      await show(api);
      expect(screen.getByRole("button", { name: "Вернуть до, Друг, ₴5,000 от 01.11: не выбрана" })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Вернуть до, Кредит до завтра, ₴2,000 от 02\.11, осталось ₴1,500: 20 ноября/ })).toBeTruthy();
      // The visible label stays short.
      expect(screen.getAllByText("Вернуть до")).toHaveLength(2);
    });

    it("says so when the date does not save", async () => {
      const api = fakeApi({
        loanHistory: jest.fn(async () => loanHistoryFixture({ open: [loanFixture({ dueOn: "2026-11-20" })] })),
        patchLoan: jest.fn(async () => {
          throw new NetworkError();
        }),
      });
      await show(api);
      await fireEvent.press(screen.getByRole("button", { name: "Убрать срок: Друг" }));
      await waitFor(() => expect(alert.mock.calls.at(-1)![0]).toBe("Не удалось сохранить срок"));
    });

    it("is offered only on open loans", async () => {
      const api = fakeApi({
        loanHistory: jest.fn(async () =>
          loanHistoryFixture({
            old: [loanFixture({ id: 8, title: "Старый", receivedOn: "2025-12-01", dueOn: null })],
            repaid: [loanFixture({ id: 9, title: "Погашенный", repaidOn: "2026-11-02", remaining: 0, dueOn: null })],
          }),
        ),
      });
      await renderWith(<LoansSheet onClose={noop} />, api);
      await screen.findByText("Старый");
      expect(screen.getByText("Погашенный")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Вернуть до/ })).toBeNull();
    });

    it("is not offered by an older server, which cannot keep it", async () => {
      await show(fakeApi({ loanHistory: jest.fn(async () => loanHistoryFixture({ open: [loanFixture()] })) }));
      expect(screen.getByRole("button", { name: "Погасил: Друг" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Вернуть до/ })).toBeNull();
    });
  });
});
