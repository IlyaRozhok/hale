import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { SetAsideSheet } from "./SetAsideSheet";
import { NetworkError } from "../api/client";
import { balanceFixture, fakeApi, renderWith } from "../testing";

const noop = () => undefined;
const solana = () => balanceFixture({ id: 9, name: "Solana", amount: 75_050, counts_as_own: false });

const fill = async (name: string, amount: string) => {
  await fireEvent.changeText(screen.getByLabelText("Название"), name);
  await fireEvent.changeText(screen.getByLabelText("Сколько стоит сейчас, $"), amount);
  await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
};

describe("a new set-aside balance", () => {
  it("asks for a name and what it is worth now, says it stays out of the limit, and has nothing to delete", async () => {
    await renderWith(<SetAsideSheet onClose={noop} />, fakeApi());
    expect(screen.getByText("Отложено")).toBeTruthy();
    expect(screen.getByLabelText("Название")).toBeTruthy();
    expect(screen.getByLabelText("Сколько стоит сейчас, $")).toBeTruthy();
    expect(screen.getByText("Цену обновляете сами, когда захотите. В лимит не входит.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Удалить/ })).toBeNull();
  });

  it("saves it in dollar cents, outside own money, and closes", async () => {
    const api = fakeApi();
    const onClose = jest.fn();
    await renderWith(<SetAsideSheet onClose={onClose} />, api);
    await fill("  Solana ", "750,5");
    await waitFor(() => expect(api.createManualBalance).toHaveBeenCalledWith({ name: "Solana", amount: 75_050, currency: "USD", counts_as_own: false }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("refuses an empty name or a bad or zero amount before sending", async () => {
    const api = fakeApi();
    await renderWith(<SetAsideSheet onClose={noop} />, api);
    for (const [name, amount] of [["", "750"], ["Solana", "abc"], ["Solana", "0"]] as const) {
      await fill(name, amount);
      expect(await screen.findByText("Проверьте название и сумму.")).toBeTruthy();
    }
    expect(api.createManualBalance).not.toHaveBeenCalled();
  });

  it("keeps the form and says so when the save fails", async () => {
    const onClose = jest.fn();
    const createManualBalance = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(<SetAsideSheet onClose={onClose} />, fakeApi({ createManualBalance }));
    await fill("Solana", "750");
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(screen.getByLabelText("Название").props.value).toBe("Solana");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("an existing set-aside balance", () => {
  it("opens under its name with its name and price filled in", async () => {
    await renderWith(<SetAsideSheet balance={solana()} onClose={noop} />, fakeApi());
    expect(screen.getAllByText("Solana").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Название").props.value).toBe("Solana");
    expect(screen.getByLabelText("Сколько стоит сейчас, $").props.value).toBe("750.50");
  });

  it("saves a new name and price on the same balance", async () => {
    const api = fakeApi();
    const onClose = jest.fn();
    await renderWith(<SetAsideSheet balance={solana()} onClose={onClose} />, api);
    await fill("SOL", "820");
    await waitFor(() => expect(api.patchManualBalance).toHaveBeenCalledWith(9, { name: "SOL", amount: 82_000 }));
    expect(api.createManualBalance).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("deletes it only after asking, then closes", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
    const api = fakeApi();
    const onClose = jest.fn();
    await renderWith(<SetAsideSheet balance={solana()} onClose={onClose} />, api);
    await fireEvent.press(screen.getByRole("button", { name: "Удалить: Solana" }));
    expect(api.deleteManualBalance).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]![2]!;
    expect(buttons.map((b) => b.text)).toEqual(["Оставить", "Удалить"]);
    await act(async () => buttons.find((b) => b.text === "Удалить")!.onPress!());
    await waitFor(() => expect(api.deleteManualBalance).toHaveBeenCalledWith(9));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    alert.mockRestore();
  });

  it("says so calmly when the delete fails, and stays open", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
    const deleteManualBalance = jest.fn(async () => {
      throw new NetworkError();
    });
    const onClose = jest.fn();
    await renderWith(<SetAsideSheet balance={solana()} onClose={onClose} />, fakeApi({ deleteManualBalance }));
    await fireEvent.press(screen.getByRole("button", { name: "Удалить: Solana" }));
    await act(async () => alert.mock.calls[0]![2]!.find((b) => b.text === "Удалить")!.onPress!());
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Не удалось удалить", "Проверьте связь и попробуйте ещё раз."));
    expect(onClose).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
