import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import type { OwnMoneyItemDto } from "@hale/contracts";
import { AccountSheet, NewAccountSheet } from "./AccountSheet";
import { NetworkError } from "../api/client";
import { fakeApi, renderWith } from "../testing";

const noop = () => undefined;
const card = (over: Partial<OwnMoneyItemDto> = {}): OwnMoneyItemDto => ({
  kind: "other",
  name: "Детская карта",
  own: 210_000,
  id: 5,
  source: "account",
  countsAsOwn: true,
  ...over,
});
const deposit = (over: Partial<OwnMoneyItemDto> = {}): OwnMoneyItemDto => ({
  kind: "manual",
  name: "Депозит Приват",
  own: 5_000_000,
  currency: "UAH",
  amount: 5_000_000,
  id: 9,
  source: "manual",
  countsAsOwn: false,
  ...over,
});
const OWN = "Входит в свои деньги";
const LIMIT_NOTE = "Покупки с этого счёта всё равно считаются в лимите.";

describe("the window of a bank account (Д2б, variant А)", () => {
  it("shows its name to change, the balance from monobank that is not changed here, and the switch with its note", async () => {
    await renderWith(<AccountSheet item={card()} amount="₴2,100" onClose={noop} />, fakeApi());
    expect(screen.getByText("monobank")).toBeTruthy();
    expect(screen.getByLabelText("Название").props.value).toBe("Детская карта");
    expect(screen.getByText("Остаток")).toBeTruthy();
    expect(screen.getByText("приходит из monobank")).toBeTruthy();
    expect(screen.getByText("₴2,100")).toBeTruthy();
    // The balance is the bank's: there is no field for it.
    expect(screen.queryByLabelText(/^Остаток,/)).toBeNull();
    expect(screen.getByLabelText(OWN).props.value).toBe(true);
    expect(screen.getByText(LIMIT_NOTE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Удалить/ })).toBeNull();
  });

  it("switches it off, sending only the mark, and closes", async () => {
    const api = fakeApi();
    const onClose = jest.fn();
    await renderWith(<AccountSheet item={card()} amount="₴2,100" onClose={onClose} />, api);
    await fireEvent(screen.getByLabelText(OWN), "valueChange", false);
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.patchAccount).toHaveBeenCalledWith(5, { countsAsOwn: false }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("renames it, and a cleared name gives the default one back", async () => {
    const api = fakeApi();
    await renderWith(<AccountSheet item={card()} amount="₴2,100" onClose={noop} />, api);
    await fireEvent.changeText(screen.getByLabelText("Название"), " Карта сына ");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.patchAccount).toHaveBeenCalledWith(5, { name: "Карта сына" }));
    await fireEvent.changeText(screen.getByLabelText("Название"), "");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.patchAccount).toHaveBeenLastCalledWith(5, { name: null }));
  });

  it("closes without a request when nothing was changed", async () => {
    const api = fakeApi();
    const onClose = jest.fn();
    await renderWith(<AccountSheet item={card()} amount="₴2,100" onClose={onClose} />, api);
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.patchAccount).not.toHaveBeenCalled();
  });

  it("shows a switched-off card in debt with its minus and its switch off, and switches it back on", async () => {
    const api = fakeApi();
    const black = card({ kind: "black", name: "Чёрная карта", own: -3_000_000, creditLimit: 3_000_000, id: 1, countsAsOwn: false });
    await renderWith(<AccountSheet item={black} amount="−₴30,000" onClose={noop} />, api);
    expect(screen.getByText("−₴30,000")).toBeTruthy();
    expect(screen.getByLabelText(OWN).props.value).toBe(false);
    await fireEvent(screen.getByLabelText(OWN), "valueChange", true);
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.patchAccount).toHaveBeenCalledWith(1, { countsAsOwn: true }));
  });

  it("keeps the window and says so calmly when the save fails", async () => {
    const onClose = jest.fn();
    const patchAccount = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(<AccountSheet item={card()} amount="₴2,100" onClose={onClose} />, fakeApi({ patchAccount }));
    await fireEvent(screen.getByLabelText(OWN), "valueChange", false);
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(screen.getByLabelText(OWN).props.value).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the window of an account kept by hand (Д2б)", () => {
  it("shows its name, its balance in its currency to change, and the switch", async () => {
    await renderWith(<AccountSheet item={deposit({ currency: "USD", amount: 100_550 })} amount="$1,006" onClose={noop} />, fakeApi());
    expect(screen.getByLabelText("Название").props.value).toBe("Депозит Приват");
    expect(screen.getByLabelText("Остаток, $").props.value).toBe("1005.50");
    expect(screen.getByLabelText(OWN).props.value).toBe(false);
    expect(screen.queryByText("приходит из monobank")).toBeNull();
    expect(screen.getByRole("button", { name: "Удалить: Депозит Приват" })).toBeTruthy();
  });

  it("saves the name, the balance and the mark on the same balance, and closes", async () => {
    const api = fakeApi();
    const onClose = jest.fn();
    await renderWith(<AccountSheet item={deposit()} amount="₴50,000" onClose={onClose} />, api);
    await fireEvent.changeText(screen.getByLabelText("Остаток, ₴"), "52 000");
    await fireEvent(screen.getByLabelText(OWN), "valueChange", true);
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.patchManualBalance).toHaveBeenCalledWith(9, { name: "Депозит Приват", amount: 5_200_000, counts_as_own: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("refuses an empty name or a bad balance before sending", async () => {
    const api = fakeApi();
    await renderWith(<AccountSheet item={deposit()} amount="₴50,000" onClose={noop} />, api);
    for (const [name, amount] of [["", "100"], ["Депозит", "abc"]] as const) {
      await fireEvent.changeText(screen.getByLabelText("Название"), name);
      await fireEvent.changeText(screen.getByLabelText("Остаток, ₴"), amount);
      await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
      expect(await screen.findByText("Проверьте название и остаток.")).toBeTruthy();
    }
    expect(api.patchManualBalance).not.toHaveBeenCalled();
  });

  it("deletes it only after asking, then closes", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
    const api = fakeApi();
    const onClose = jest.fn();
    await renderWith(<AccountSheet item={deposit()} amount="₴50,000" onClose={onClose} />, api);
    await fireEvent.press(screen.getByRole("button", { name: "Удалить: Депозит Приват" }));
    expect(api.deleteManualBalance).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]![2]!;
    expect(buttons.map((b) => b.text)).toEqual(["Оставить", "Удалить"]);
    await act(async () => buttons.find((b) => b.text === "Удалить")!.onPress!());
    await waitFor(() => expect(api.deleteManualBalance).toHaveBeenCalledWith(9));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    alert.mockRestore();
  });
});

describe("a new account (Д2б, variant А)", () => {
  const fill = async (name: string, amount: string) => {
    await fireEvent.changeText(screen.getByLabelText("Название"), name);
    await fireEvent.changeText(screen.getByLabelText("Остаток"), amount);
    await fireEvent.press(screen.getByRole("button", { name: "Добавить счёт" }));
  };

  it("asks for a name, a currency of ₴, $ or €, and a balance, with the switch off", async () => {
    await renderWith(<NewAccountSheet onClose={noop} />, fakeApi());
    expect(screen.getByText("Новый счёт")).toBeTruthy();
    expect(screen.getByLabelText("Название")).toBeTruthy();
    expect(screen.getAllByRole("radio").map((c) => c.props.accessibilityLabel)).toEqual(["₴", "$", "€"]);
    expect(screen.getByRole("radio", { name: "₴" }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText("Остаток")).toBeTruthy();
    expect(screen.getByText("Остаток вы правите сами, когда захотите.")).toBeTruthy();
    expect(screen.getByLabelText(OWN).props.value).toBe(false);
    expect(screen.getByText(LIMIT_NOTE)).toBeTruthy();
  });

  it("adds it set aside by default, saying so to the server, and closes", async () => {
    const api = fakeApi();
    const onClose = jest.fn();
    await renderWith(<NewAccountSheet onClose={onClose} />, api);
    await fill(" Депозит Приват ", "50 000");
    await waitFor(() =>
      expect(api.createManualBalance).toHaveBeenCalledWith({ name: "Депозит Приват", amount: 5_000_000, currency: "UAH", counts_as_own: false }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("adds one in euros that counts as own money", async () => {
    const api = fakeApi();
    await renderWith(<NewAccountSheet onClose={noop} />, api);
    await fireEvent.press(screen.getByRole("radio", { name: "€" }));
    await fireEvent(screen.getByLabelText(OWN), "valueChange", true);
    await fill("Карта Revolut", "120,50");
    await waitFor(() =>
      expect(api.createManualBalance).toHaveBeenCalledWith({ name: "Карта Revolut", amount: 12_050, currency: "EUR", counts_as_own: true }),
    );
  });

  it("refuses an empty name or a bad balance before sending", async () => {
    const api = fakeApi();
    await renderWith(<NewAccountSheet onClose={noop} />, api);
    for (const [name, amount] of [["", "100"], ["Конверт", ""], ["Конверт", "abc"]] as const) {
      await fill(name, amount);
      expect(await screen.findByText("Проверьте название и остаток.")).toBeTruthy();
    }
    expect(api.createManualBalance).not.toHaveBeenCalled();
  });

  it("keeps the form and says so when the save fails", async () => {
    const onClose = jest.fn();
    const createManualBalance = jest.fn(async () => {
      throw new NetworkError();
    });
    await renderWith(<NewAccountSheet onClose={onClose} />, fakeApi({ createManualBalance }));
    await fill("Конверт", "1000");
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(screen.getByLabelText("Название").props.value).toBe("Конверт");
    expect(onClose).not.toHaveBeenCalled();
  });
});
