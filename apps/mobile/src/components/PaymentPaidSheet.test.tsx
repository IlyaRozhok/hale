import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { PaymentPaidSheet } from "./PaymentPaidSheet";
import { fakeApi, renderWith, txFixture } from "../testing";

const noop = () => undefined;
const press = async (name: string | RegExp) => fireEvent.press(await screen.findByRole("button", { name }));
const tick = async (name: RegExp) => fireEvent.press(await screen.findByRole("checkbox", { name }));

// A newer server sends `paid` on every open payment (task Б9); an older one leaves it out.
const payment = { id: "11", name: "Квартплата", amount: 1_700_000, dueOn: "2026-11-06", kind: "obligation", currency: "UAH", paid: 0 };
const out = (id: number, description: string, amount: number) =>
  txFixture({ id, description, amount: -amount, amountUah: -amount, localDate: "2026-11-08", type: "person_transfer" });
const silpo = out(1, "Видача готівки Сільпо", 310_500);
const card = out(2, "545708****4563", 1_560_000);
const almost = out(3, "Переказ Олені", 1_698_000);
const rest = out(4, "Переказ решти", 700_000);
const SHORT = /^Платёж останется открытым/;
const CLOSES = "Платёж закроется, выбранные операции станут им и не потратят лимит.";

describe("dates in the sheet (Я4)", () => {
  it("shows the due date and the operations' dates as «6 ноя»", async () => {
    const api = fakeApi({ paymentCandidates: jest.fn(async () => [silpo]) });
    await renderWith(<PaymentPaidSheet payment={payment} today="2026-11-09" onClose={noop} />, api);
    expect(await screen.findByText("8 ноя")).toBeTruthy();
    expect(screen.getByText("₴17,000 · просрочен с 6 ноя")).toBeTruthy();
  });

  it("an upcoming payment reads «до 6 ноя»", async () => {
    const api = fakeApi({ paymentCandidates: jest.fn(async () => []) });
    await renderWith(<PaymentPaidSheet payment={payment} today="2026-11-02" onClose={noop} />, api);
    expect(await screen.findByText("₴17,000 · до 6 ноя")).toBeTruthy();
  });
});

describe("a payment paid in parts (Б9)", () => {
  it("says the payment stays open only while the chosen operations do not cover it", async () => {
    const api = fakeApi({ paymentCandidates: jest.fn(async () => [card, silpo, almost]) });
    await renderWith(<PaymentPaidSheet payment={payment} today="2026-11-09" onClose={noop} />, api);
    await screen.findByText("Чем оплачено");
    expect(screen.queryByText(SHORT)).toBeNull();

    await tick(/Видача готівки Сільпо/);
    expect(screen.getByText("Платёж останется открытым: не хватает ₴13,895. Остальное можно отметить потом.")).toBeTruthy();
    expect(screen.queryByText(CLOSES)).toBeNull();

    await tick(/545708/);
    expect(screen.queryByText(SHORT)).toBeNull();
    expect(screen.getByText(CLOSES)).toBeTruthy();

    // ₴20 short still closes it, as on the server.
    await tick(/Видача готівки Сільпо/);
    await tick(/545708/);
    await tick(/Переказ Олені/);
    expect(screen.queryByText(SHORT)).toBeNull();
    expect(screen.getByText(CLOSES)).toBeTruthy();
  });

  it("a partial payment is saved and the sheet closes as before", async () => {
    const onClose = jest.fn();
    const api = fakeApi({ paymentCandidates: jest.fn(async () => [silpo]) });
    await renderWith(<PaymentPaidSheet payment={payment} today="2026-11-09" onClose={onClose} />, api);
    await tick(/Видача готівки Сільпо/);
    await press("Оплачено");
    await waitFor(() => expect(api.payWith).toHaveBeenCalledWith(11, [1]));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("a partly paid payment shows what is paid, counts it toward the rest, and offers no cash once an operation is chosen", async () => {
    const api = fakeApi({
      paymentCandidates: jest.fn(async () => [rest, silpo]),
      cash: jest.fn(async () => ({ started: true, start: "2026-11-01", balance: 5_000_000 })),
    });
    await renderWith(<PaymentPaidSheet payment={{ ...payment, paid: 1_000_000 }} today="2026-11-09" onClose={noop} />, api);
    expect(await screen.findByText("Уже оплачено ₴10,000 из ₴17,000")).toBeTruthy();
    await screen.findByLabelText("Наличными из кошелька");

    await tick(/Видача готівки Сільпо/);
    expect(screen.queryByLabelText("Наличными из кошелька")).toBeNull();
    expect(screen.getByText("Платёж останется открытым: не хватает ₴3,895. Остальное можно отметить потом.")).toBeTruthy();
    await tick(/Видача готівки Сільпо/);
    await tick(/Переказ решти/);
    expect(screen.queryByText(SHORT)).toBeNull();
    expect(screen.getByText(CLOSES)).toBeTruthy();
  });

  it("an older server sends no `paid`: nothing new, the sheet reads as before", async () => {
    const older: Omit<typeof payment, "paid"> & { paid?: number } = { ...payment };
    delete older.paid;
    const api = fakeApi({ paymentCandidates: jest.fn(async () => [silpo]) });
    await renderWith(<PaymentPaidSheet payment={older} today="2026-11-09" onClose={noop} />, api);
    await tick(/Видача готівки Сільпо/);
    expect(screen.queryByText(SHORT)).toBeNull();
    expect(screen.queryByText(/^Уже оплачено/)).toBeNull();
    expect(screen.getByText(CLOSES)).toBeTruthy();
  });

  describe("the rest in cash from the wallet (Б54)", () => {
    // ₴36,000 a month: ₴27,000 sent from the card, the rest handed over in cash.
    const partly = { ...payment, name: "Ежемесячно", amount: 3_600_000, paid: 2_700_000 };
    const wallet = (balance: number) => ({ cash: jest.fn(async () => ({ started: true, start: "2026-11-01", balance })) });

    it("offers cash for the rest and pays it from the wallet", async () => {
      const onClose = jest.fn();
      const api = fakeApi(wallet(2_000_000));
      await renderWith(<PaymentPaidSheet payment={partly} today="2026-11-09" onClose={onClose} />, api);
      await fireEvent(await screen.findByLabelText("Наличными из кошелька"), "valueChange", true);
      expect(screen.getByText("Наличные уменьшатся на ₴9,000 — остаток платежа.")).toBeTruthy();
      await press("Оплачено");
      await waitFor(() => expect(api.payFromWallet).toHaveBeenCalledWith(11));
      expect(api.markPaid).not.toHaveBeenCalled();
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it("a wallet with less than the rest cannot pay it, and says what it has against the rest", async () => {
      const api = fakeApi(wallet(500_000));
      await renderWith(<PaymentPaidSheet payment={partly} today="2026-11-09" onClose={noop} />, api);
      expect((await screen.findByLabelText("Наличными из кошелька")).props.disabled).toBe(true);
      expect(
        screen.getByText("В кошельке по записям ₴5,000, остаток платежа — ₴9,000. Если наличные были до начала учёта, просто отметьте оплату."),
      ).toBeTruthy();
      await press("Оплачено");
      await waitFor(() => expect(api.markPaid).toHaveBeenCalledWith(11));
      expect(api.payFromWallet).not.toHaveBeenCalled();
    });

    it("a wallet with exactly the rest can pay it", async () => {
      const api = fakeApi(wallet(900_000));
      await renderWith(<PaymentPaidSheet payment={partly} today="2026-11-09" onClose={noop} />, api);
      expect((await screen.findByLabelText("Наличными из кошелька")).props.disabled).toBe(false);
    });
  });

  it("nothing paid yet: no «Уже оплачено» line", async () => {
    const api = fakeApi({ paymentCandidates: jest.fn(async () => [silpo]) });
    await renderWith(<PaymentPaidSheet payment={payment} today="2026-11-09" onClose={noop} />, api);
    await screen.findByText("Чем оплачено");
    expect(screen.queryByText(/^Уже оплачено/)).toBeNull();
  });
});
