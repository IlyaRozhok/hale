import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { Settings } from "./Settings";
import { Today } from "./Today";
import { TxEditSheet } from "../components/TxEditSheet";
import { PaymentPaidSheet } from "../components/PaymentPaidSheet";
import { fakeApi, renderWith, todayFixture, txFixture } from "../testing";
import type { RuleDto } from "@hale/contracts";

jest.mock("../metal", () => {
  const { View } = require("react-native");
  return { LimitVisual: () => <View testID="limit-visual" /> };
});
jest.mock("@react-native-community/slider", () => {
  const React = require("react");
  return { __esModule: true, default: (props: object) => React.createElement("Slider", props) };
});

const noop = () => undefined;
const press = async (name: string | RegExp) => fireEvent.press(await screen.findByRole("button", { name }));

describe("apply to similar says how many rows change", () => {
  it("asks the server for the row's own type, and for the type about to be chosen", async () => {
    const api = fakeApi({ similarCount: jest.fn(async () => 3) });
    await renderWith(<TxEditSheet tx={txFixture({ id: 7, type: "spend" })} onClose={noop} />, api);
    expect(await screen.findByText("Изменится 3 операции")).toBeTruthy();
    expect(api.similarCount).toHaveBeenCalledWith(7, undefined);
    await fireEvent(screen.getByLabelText("Применить к похожим"), "valueChange", false);
    expect(screen.queryByText(/^Изменится/)).toBeNull();
  });

  it("one row reads in the singular", async () => {
    await renderWith(<TxEditSheet tx={txFixture()} onClose={noop} />, fakeApi({ similarCount: jest.fn(async () => 1) }));
    expect(await screen.findByText("Изменится 1 операция")).toBeTruthy();
  });
});

describe("the owner's rules in Settings", () => {
  const rules: RuleDto[] = [
    { id: 4, matchKind: "merchant", title: "видача готівки сільпо", direction: "out", type: "spend", category: null, label: null, count: 1 },
    { id: 9, matchKind: "iban", title: "Olena K", direction: "out", type: "person_transfer", category: null, label: "close_regular", count: 12 },
  ];

  it("lists what each rule matches and does, and deletes one after a confirmation", async () => {
    const api = fakeApi({ rules: jest.fn(async () => rules) });
    await renderWith(<Settings onClose={noop} />, api);
    await press("Мои правила");
    expect(await screen.findByText("видача готівки сільпо")).toBeTruthy();
    expect(screen.getByText("Трата · 1 операция")).toBeTruthy();
    expect(screen.getByText("Olena K")).toBeTruthy();
    expect(screen.getByText(/· 12 операций$/)).toBeTruthy();
    const alert = jest.spyOn(Alert, "alert");
    await press("Удалить правило «видача готівки сільпо»");
    expect(alert.mock.calls.at(-1)!.slice(0, 2)).toEqual([
      "Удалить правило?",
      "1 операция снова распознается автоматически. Лимит пересчитается.",
    ]);
    expect(api.deleteRule).not.toHaveBeenCalled();
    const buttons = alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === "Удалить")!.onPress!();
    await waitFor(() => expect(api.deleteRule).toHaveBeenCalledWith(4));
  });

  it("a rule with no operations under it says so", async () => {
    const alert = jest.spyOn(Alert, "alert");
    await renderWith(<Settings onClose={noop} />, fakeApi({ rules: jest.fn(async () => [{ ...rules[0]!, count: 0 }]) }));
    await press("Мои правила");
    await press("Удалить правило «видача готівки сільпо»");
    expect(alert.mock.calls.at(-1)![1]).toBe("Сейчас под ним нет операций.");
  });

  it("says when there are none", async () => {
    await renderWith(<Settings onClose={noop} />, fakeApi());
    await press("Мои правила");
    expect(await screen.findByText("Правил пока нет. Они появляются, когда вы меняете операцию с «Применить к похожим» или отвечаете, что это за перевод.")).toBeTruthy();
  });
});

describe("paid with chosen operations", () => {
  const payment = { id: "11", name: "Квартплата", amount: 1_700_000, dueOn: "2026-11-06", kind: "obligation", currency: "UAH" };
  const silpo = txFixture({ id: 1, description: "Видача готівки Сільпо", amount: -310_500, amountUah: -310_500, localDate: "2026-11-08", type: "cash_out" });
  const card = txFixture({ id: 2, description: "545708****4563", amount: -1_560_000, amountUah: -1_560_000, localDate: "2026-11-08", type: "own_transfer" });

  it("lists the operations that could have paid it; the chosen ones close the payment", async () => {
    const onClose = jest.fn();
    const api = fakeApi({ paymentCandidates: jest.fn(async () => [card, silpo]) });
    await renderWith(<PaymentPaidSheet payment={payment} today="2026-11-09" onClose={onClose} />, api);
    expect(await screen.findByText("Чем оплачено")).toBeTruthy();
    expect(api.paymentCandidates).toHaveBeenCalledWith(11);
    await fireEvent.press(screen.getByRole("checkbox", { name: /Видача готівки Сільпо/ }));
    await fireEvent.press(screen.getByRole("checkbox", { name: /545708\*\*\*\*4563/ }));
    expect(screen.getByText("Выбрано ₴18,705 из ₴17,000")).toBeTruthy();
    await press("Оплачено");
    await waitFor(() => expect(api.payWith).toHaveBeenCalledWith(11, [2, 1]));
    expect(api.markPaid).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("with nothing chosen it works as before", async () => {
    const api = fakeApi({ paymentCandidates: jest.fn(async () => [silpo]) });
    await renderWith(<PaymentPaidSheet payment={payment} today="2026-11-09" onClose={noop} />, api);
    await screen.findByText("Чем оплачено");
    await press("Оплачено");
    await waitFor(() => expect(api.markPaid).toHaveBeenCalledWith(11));
    expect(api.payWith).not.toHaveBeenCalled();
  });

  it("shows no list when there is nothing to choose", async () => {
    const api = fakeApi();
    await renderWith(<PaymentPaidSheet payment={payment} today="2026-11-09" onClose={noop} />, api);
    await waitFor(() => expect(api.paymentCandidates).toHaveBeenCalled());
    expect(screen.queryByText("Чем оплачено")).toBeNull();
  });
});

describe("cash taken from the owner's card at another bank", () => {
  const question = todayFixture({
    questions: [{ id: "cash_card:42", kind: "cash_card", text: "Перевод ₴15,600 на 545708****4563 (09.11). Снял наличными?" }],
  });
  const open = async (api: ReturnType<typeof fakeApi>) => {
    await renderWith(<Today onOpenActivity={noop} onOpenPlan={noop} />, api);
    await fireEvent.press(await screen.findByText(/^Осталось разобрать: /));
  };

  it("yes", async () => {
    const api = fakeApi({ today: jest.fn(async () => question) });
    await open(api);
    await press("Да");
    await waitFor(() => expect(api.answerCashCard).toHaveBeenCalledWith(42, { answer: "yes" }));
  });

  it("part: the amount taken", async () => {
    const api = fakeApi({ today: jest.fn(async () => question) });
    await open(api);
    await press("Да, часть");
    await fireEvent.changeText(await screen.findByLabelText("Сколько снял"), "15000");
    await press("Сохранить");
    await waitFor(() => expect(api.answerCashCard).toHaveBeenCalledWith(42, { answer: "part", amount: 1_500_000 }));
  });

  it("no", async () => {
    const api = fakeApi({ today: jest.fn(async () => question) });
    await open(api);
    await press("Нет");
    await waitFor(() => expect(api.answerCashCard).toHaveBeenCalledWith(42, { answer: "no" }));
  });

  it("the operation card shows what was taken and lets it change", async () => {
    const api = fakeApi();
    const tx = txFixture({ id: 42, description: "545708****4563", type: "own_transfer", amount: -1_560_000, amountUah: -1_560_000, cashOut: 1_560_000 });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, api);
    expect(await screen.findByText("Снял наличными: ₴15,600")).toBeTruthy();
    await press("Изменить сумму");
    await fireEvent.changeText(await screen.findByLabelText("Сколько снял"), "10000");
    await press("Сохранить");
    await waitFor(() => expect(api.setCardCash).toHaveBeenCalledWith(42, 1_000_000));
  });

  it("not taken at all", async () => {
    const api = fakeApi();
    const tx = txFixture({ id: 42, description: "545708****4563", type: "own_transfer", cashOut: 1_560_000 });
    await renderWith(<TxEditSheet tx={tx} onClose={noop} />, api);
    await press("Не снимал");
    await waitFor(() => expect(api.setCardCash).toHaveBeenCalledWith(42, 0));
  });

  it("an ordinary row says nothing about cash", async () => {
    await renderWith(<TxEditSheet tx={txFixture()} onClose={noop} />, fakeApi());
    await screen.findByText(/^Изменится/);
    expect(screen.queryByText(/^Снял наличными/)).toBeNull();
  });
});
