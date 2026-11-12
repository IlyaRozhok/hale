import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import type { RecipientLabelName } from "@hale/contracts";
import { RecipientLabelSheet } from "./RecipientLabelSheet";
import { fakeApi, renderWith } from "../testing";

const noop = () => undefined;
const KEY = "0123456789abcdef";
const answer = (name: string) => screen.queryByRole("button", { name });
const selected = (name: string) => screen.getByRole("button", { name }).props.accessibilityState.selected;
const sent = (over: { count?: number; total?: number; label?: RecipientLabelName | null } = {}) =>
  jest.fn(async () => ({ name: "Олена К.", count: 3, total: 450_000, lastOn: "2026-11-09", label: null, ...over }));

const FREQUENT = ["Близкий человек, регулярно", "Оплата услуги или покупка", "Это мой счёт"];
const OTHER = ["Разовая помощь или подарок", "Возвращаю долг", "Даю в долг", "Не спрашивать"];
const NOTE = "Ответ относится ко всем переводам этому получателю.";

describe("RecipientLabelSheet: three answers and «Другое»", () => {
  it("shows three answers with what each does to the limit; the other four are hidden", async () => {
    await renderWith(<RecipientLabelSheet counterKey={KEY} name="Олена К." onClose={noop} />, fakeApi({ recipient: sent() }));
    await screen.findByText("Олена К. · 3 перевода, ₴4,500");
    for (const name of FREQUENT) expect(answer(name)).toBeTruthy();
    for (const name of OTHER) expect(answer(name)).toBeNull();
    expect(screen.getByText("Считается в дневном лимите. Платёж из плана лимит не тратит")).toBeTruthy();
    expect(screen.getByText("Считается в дневном лимите как трата")).toBeTruthy();
    expect(screen.getByText("Не расход: деньги остаются у вас")).toBeTruthy();
    expect(answer("Другое")).toBeTruthy();
  });

  it("«Другое» opens the other four in place and goes away", async () => {
    await renderWith(<RecipientLabelSheet counterKey={KEY} name="Олена К." onClose={noop} />, fakeApi({ recipient: sent() }));
    await fireEvent.press(await screen.findByRole("button", { name: "Другое" }));
    for (const name of [...FREQUENT, ...OTHER]) expect(screen.getAllByRole("button", { name })).toHaveLength(1);
    expect(screen.getByText("Считается в дневном лимите, вопроса больше не будет")).toBeTruthy();
    expect(answer("Другое")).toBeNull();
  });

  it("an answer from behind «Другое» is saved with one tap", async () => {
    const api = fakeApi({ recipient: sent() });
    const onClose = jest.fn();
    const onLabeled = jest.fn();
    await renderWith(<RecipientLabelSheet counterKey={KEY} name="Олена К." onClose={onClose} onLabeled={onLabeled} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Другое" }));
    await fireEvent.press(screen.getByRole("button", { name: "Возвращаю долг" }));
    await waitFor(() => expect(api.labelRecipient).toHaveBeenCalledWith(KEY, "debt_repayment"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onLabeled).toHaveBeenCalled();
  });

  it("a rare answer given before is in sight at once, chosen, without «Другое»", async () => {
    await renderWith(<RecipientLabelSheet counterKey={KEY} name="Олена К." onClose={noop} />, fakeApi({ recipient: sent({ label: "lend" }) }));
    await waitFor(() => expect(answer("Даю в долг")).toBeTruthy());
    expect(selected("Даю в долг")).toBe(true);
    for (const name of FREQUENT) expect(selected(name)).toBe(false);
    for (const name of ["Разовая помощь или подарок", "Возвращаю долг", "Не спрашивать"]) expect(answer(name)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Другое" }));
    for (const name of [...FREQUENT, ...OTHER]) expect(screen.getAllByRole("button", { name })).toHaveLength(1);
  });

  it("a frequent answer given before is marked, and nothing is added to the three", async () => {
    await renderWith(<RecipientLabelSheet counterKey={KEY} name="Олена К." onClose={noop} />, fakeApi({ recipient: sent({ label: "service" }) }));
    await waitFor(() => expect(selected("Оплата услуги или покупка")).toBe(true));
    for (const name of OTHER) expect(answer(name)).toBeNull();
  });
});

describe("RecipientLabelSheet: who and how much", () => {
  it("puts the name and the total on one line under the title, without the old two lines", async () => {
    await renderWith(<RecipientLabelSheet counterKey={KEY} name="Олена К." onClose={noop} />, fakeApi({ recipient: sent() }));
    expect(await screen.findByText("Олена К. · 3 перевода, ₴4,500")).toBeTruthy();
    expect(screen.queryByText(/^Переводов:/)).toBeNull();
    expect(screen.queryByText(/последний/)).toBeNull();
    expect(screen.queryByText("Олена К.")).toBeNull();
  });

  it("the word after the count follows the number", async () => {
    await renderWith(<RecipientLabelSheet counterKey={KEY} name="Иван" onClose={noop} />, fakeApi({ recipient: sent({ count: 1, total: 50_000 }) }));
    expect(await screen.findByText("Иван · 1 перевод, ₴500")).toBeTruthy();
  });

  it("shows the name alone while the totals are not there, and can be answered", async () => {
    const api = fakeApi({
      recipient: jest.fn(async () => {
        throw new Error("boom");
      }),
    });
    await renderWith(<RecipientLabelSheet counterKey={KEY} name="Олена К." onClose={noop} />, api);
    expect(await screen.findByText("Олена К.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Это мой счёт" }));
    await waitFor(() => expect(api.labelRecipient).toHaveBeenCalledWith(KEY, "own_account"));
  });

  it("says once, under the answers, that the answer is for every transfer", async () => {
    await renderWith(<RecipientLabelSheet counterKey={KEY} name="Олена К." onClose={noop} />, fakeApi({ recipient: sent() }));
    await screen.findByText("Олена К. · 3 перевода, ₴4,500");
    expect(screen.getAllByText(NOTE)).toHaveLength(1);
    const texts = screen.getAllByText(/./).map((t) => t.props.children as unknown);
    expect(texts.indexOf("Другое")).toBeGreaterThan(-1);
    expect(texts.indexOf(NOTE)).toBeGreaterThan(texts.indexOf("Другое"));
    expect(texts.indexOf(NOTE)).toBeGreaterThan(texts.indexOf("Это мой счёт"));
  });

  it("keeps the sheet open with a message when saving fails", async () => {
    const onClose = jest.fn();
    const api = fakeApi({
      recipient: sent(),
      labelRecipient: jest.fn(async () => {
        throw new Error("boom");
      }),
    });
    await renderWith(<RecipientLabelSheet counterKey={KEY} name="Олена К." onClose={onClose} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Это мой счёт" }));
    expect(await screen.findByText("Не удалось сохранить. Попробуйте ещё раз.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
