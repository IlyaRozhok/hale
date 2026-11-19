import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert, StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import type { CategoryDto, TransactionPageDto } from "@hale/contracts";
import { CategoriesSheet } from "./CategoriesSheet";
import { ApiError } from "../api/client";
import { fakeApi, renderWith } from "../testing";

const noop = () => undefined;
const pressAlert = (alert: jest.SpyInstance, label: string) => {
  const buttons = alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  buttons.find((b) => b.text === label)!.onPress!();
};

const LIST: CategoryDto[] = [
  { key: "groceries", name: "Продукты", icon: "cart", system: false },
  { key: "cafe", name: "Кафе и рестораны", icon: "coffee", system: false },
  { key: "c_cat", name: "Кот", icon: "paw", system: false },
  { key: "refund", name: "Возвраты", icon: "arrowIn", system: true },
  { key: "uncategorized", name: "Без категории", icon: "circle", system: true },
];
const names = () => screen.getAllByTestId("category-row").map((r) => String(r.props.accessibilityLabel));
const FOOTNOTE = "Нажмите на категорию, чтобы переименовать или удалить. «Возвраты» и «Без категории» служебные — их не удалить.";

describe("CategoriesSheet (В5)", () => {
  it("lists the categories in the server's order, with a row for a new one and the footnote", async () => {
    await renderWith(<CategoriesSheet onClose={noop} />, fakeApi({ categories: jest.fn(async () => LIST) }));
    expect(await screen.findByText("Кот")).toBeTruthy();
    expect(screen.getByText("Категории")).toBeTruthy();
    expect(screen.getByText("Порядок — как в карточке операции")).toBeTruthy();
    expect(names()).toEqual(["Продукты", "Кафе и рестораны", "Кот", "Возвраты", "Без категории"]);
    expect(screen.getByRole("button", { name: "Новая категория" })).toBeTruthy();
    expect(screen.getByText(FOOTNOTE)).toBeTruthy();
  });

  it("moves a category down and up, sending the whole new order", async () => {
    // The server keeps what it was sent, so the list read again after the change is the new one.
    let kept = LIST;
    const api = fakeApi({
      categories: jest.fn(async () => kept),
      reorderCategories: jest.fn(async (keys: string[]) => (kept = keys.map((k) => LIST.find((c) => c.key === k)!))),
    });
    await renderWith(<CategoriesSheet onClose={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Ниже: Продукты" }));
    await waitFor(() => expect(api.reorderCategories).toHaveBeenCalledWith(["cafe", "groceries", "c_cat", "refund", "uncategorized"]));
    await waitFor(() => expect(names()).toEqual(["Кафе и рестораны", "Продукты", "Кот", "Возвраты", "Без категории"]));
    await fireEvent.press(screen.getByRole("button", { name: "Выше: Кот" }));
    await waitFor(() => expect(api.reorderCategories).toHaveBeenLastCalledWith(["cafe", "c_cat", "groceries", "refund", "uncategorized"]));
  });

  it("the first cannot go up and the last cannot go down", async () => {
    await renderWith(<CategoriesSheet onClose={noop} />, fakeApi({ categories: jest.fn(async () => LIST) }));
    await screen.findByText("Кот");
    expect(screen.getByRole("button", { name: "Выше: Продукты" }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Ниже: Без категории" }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Ниже: Продукты" }).props.accessibilityState.disabled).toBe(false);
  });

  it("each arrow is a full touch target", async () => {
    await renderWith(<CategoriesSheet onClose={noop} />, fakeApi({ categories: jest.fn(async () => LIST) }));
    const button = await screen.findByRole("button", { name: "Ниже: Кот" });
    const arrow = StyleSheet.flatten(button.props.style) as { minWidth: number; minHeight: number };
    expect(arrow.minWidth).toBeGreaterThanOrEqual(tokens.touchMin);
    expect(arrow.minHeight).toBeGreaterThanOrEqual(tokens.touchMin);
  });

  it("a refused order goes back and says so", async () => {
    const api = fakeApi({ categories: jest.fn(async () => LIST), reorderCategories: jest.fn(async () => Promise.reject(new ApiError(422))) });
    await renderWith(<CategoriesSheet onClose={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Ниже: Продукты" }));
    expect(await screen.findByText("Не удалось сохранить порядок. Попробуйте ещё раз.")).toBeTruthy();
    expect(names()).toEqual(["Продукты", "Кафе и рестораны", "Кот", "Возвраты", "Без категории"]);
  });

  it("renames a category from its row", async () => {
    const api = fakeApi({ categories: jest.fn(async () => LIST), patchCategory: jest.fn(async () => ({ ...LIST[2]!, name: "Кошка" })) });
    await renderWith(<CategoriesSheet onClose={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Кот" }));
    const field = await screen.findByLabelText("Название");
    expect(field.props.value).toBe("Кот");
    await fireEvent.changeText(field, "Кошка");
    await fireEvent.press(screen.getByRole("radio", { name: "Значок: звезда" }));
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.patchCategory).toHaveBeenCalledWith("c_cat", { name: "Кошка", icon: "star" }));
    await waitFor(() => expect(screen.queryByLabelText("Название")).toBeNull());
  });

  it("a name already taken says so calmly and keeps the window", async () => {
    const api = fakeApi({ categories: jest.fn(async () => LIST), patchCategory: jest.fn(async () => Promise.reject(new ApiError(409))) });
    await renderWith(<CategoriesSheet onClose={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Кот" }));
    await fireEvent.changeText(await screen.findByLabelText("Название"), "Продукты");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Такая категория уже есть.")).toBeTruthy();
    expect(screen.getByLabelText("Название")).toBeTruthy();
  });

  it("a system category keeps its name and cannot be deleted; only its icon changes", async () => {
    const api = fakeApi({ categories: jest.fn(async () => LIST), patchCategory: jest.fn(async () => LIST[3]!) });
    await renderWith(<CategoriesSheet onClose={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Возвраты" }));
    expect(await screen.findByText("Служебная категория: можно сменить только значок")).toBeTruthy();
    expect(screen.queryByLabelText("Название")).toBeNull();
    expect(screen.queryByRole("button", { name: "Удалить" })).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "Значок: подарок" }));
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.patchCategory).toHaveBeenCalledWith("refund", { icon: "gift" }));
  });

  describe("deleting", () => {
    let alert: jest.SpyInstance;
    beforeEach(() => {
      alert = jest.spyOn(Alert, "alert").mockImplementation(noop);
    });
    afterEach(() => alert.mockRestore());

    it("asks first, naming how many operations go to «Без категории», however quickly «Удалить» is pressed", async () => {
      // The count comes only when the test lets it: the question must wait for it.
      let answer: (page: TransactionPageDto) => void = noop;
      const api = fakeApi({
        categories: jest.fn(async () => LIST),
        transactions: jest.fn(() => new Promise((resolve) => (answer = resolve))),
        deleteCategory: jest.fn(async () => ({ deleted: true as const, moved: 14 })),
      });
      await renderWith(<CategoriesSheet onClose={noop} />, api);
      await fireEvent.press(await screen.findByRole("button", { name: "Кот" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Удалить" }));
      await waitFor(() => expect(api.transactions).toHaveBeenCalledWith({ group: "all", category: "c_cat" }));
      expect(alert).not.toHaveBeenCalled();
      await act(async () => answer({ items: [], nextCursor: null, dayTotals: {}, summary: { total: -100_000, count: 14 } }));
      await waitFor(() => expect(alert).toHaveBeenCalled());
      expect(alert.mock.calls.at(-1)![0]).toBe("Удалить «Кот»?");
      expect(alert.mock.calls.at(-1)![1]).toBe("Операции этой категории (14) станут «Без категории».");
      expect(api.deleteCategory).not.toHaveBeenCalled();
      await act(async () => pressAlert(alert, "Удалить"));
      await waitFor(() => expect(api.deleteCategory).toHaveBeenCalledWith("c_cat"));
      await waitFor(() => expect(screen.queryByLabelText("Название")).toBeNull());
    });

    it("without a count from the server the question has no number", async () => {
      const api = fakeApi({ categories: jest.fn(async () => LIST), transactions: jest.fn(async () => ({ items: [], nextCursor: null, dayTotals: {} })) });
      await renderWith(<CategoriesSheet onClose={noop} />, api);
      await fireEvent.press(await screen.findByRole("button", { name: "Кот" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Удалить" }));
      await waitFor(() => expect(alert).toHaveBeenCalled());
      expect(alert.mock.calls.at(-1)![1]).toBe("Операции этой категории станут «Без категории».");
    });

    it("a failed count still asks, without the number, and still deletes", async () => {
      const api = fakeApi({
        categories: jest.fn(async () => LIST),
        transactions: jest.fn(async () => Promise.reject(new ApiError(500))),
        deleteCategory: jest.fn(async () => ({ deleted: true as const, moved: 3 })),
      });
      await renderWith(<CategoriesSheet onClose={noop} />, api);
      await fireEvent.press(await screen.findByRole("button", { name: "Кот" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Удалить" }));
      await waitFor(() => expect(alert).toHaveBeenCalled());
      expect(alert.mock.calls.at(-1)![1]).toBe("Операции этой категории станут «Без категории».");
      await act(async () => pressAlert(alert, "Удалить"));
      await waitFor(() => expect(api.deleteCategory).toHaveBeenCalledWith("c_cat"));
    });
  });

  it("adds a category at the end", async () => {
    const created: CategoryDto = { key: "c_new", name: "Спорт", icon: "dumbbell", system: false };
    let kept = LIST;
    const api = fakeApi({ categories: jest.fn(async () => kept), createCategory: jest.fn(async () => ((kept = [...LIST, created]), created)) });
    await renderWith(<CategoriesSheet onClose={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Новая категория" }));
    await fireEvent.changeText(await screen.findByLabelText("Название"), "Спорт");
    await fireEvent.press(screen.getByRole("radio", { name: "Значок: гантель" }));
    await fireEvent.press(screen.getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(api.createCategory).toHaveBeenCalledWith({ name: "Спорт", icon: "dumbbell" }));
    await waitFor(() => expect(names().at(-1)).toBe("Спорт"));
  });

  it("an empty name is not sent", async () => {
    const api = fakeApi({ categories: jest.fn(async () => LIST), createCategory: jest.fn() });
    await renderWith(<CategoriesSheet onClose={noop} />, api);
    await fireEvent.press(await screen.findByRole("button", { name: "Новая категория" }));
    await fireEvent.changeText(await screen.findByLabelText("Название"), "   ");
    await fireEvent.press(screen.getByRole("button", { name: "Добавить" }));
    expect(await screen.findByText("Введите название.")).toBeTruthy();
    expect(api.createCategory).not.toHaveBeenCalled();
  });

  describe("«Это скорее»: нужное или желаемое (В6)", () => {
    const SIDED: CategoryDto[] = [
      { key: "groceries", name: "Продукты", icon: "cart", system: false, want: false },
      { key: "cafe", name: "Кафе и рестораны", icon: "coffee", system: false, want: true },
      { key: "refund", name: "Возвраты", icon: "arrowIn", system: true, want: null },
    ];
    const CAPTION = "Действует на все операции категории, кроме тех, где вы выбрали по-другому.";
    const side = (name: "Нужное" | "Желаемое") => screen.getByRole("radio", { name });

    it("shows the category's side with what it does, and saves a new one", async () => {
      const api = fakeApi({ categories: jest.fn(async () => SIDED), patchCategory: jest.fn(async () => ({ ...SIDED[1]!, want: false })) });
      await renderWith(<CategoriesSheet onClose={noop} />, api);
      await fireEvent.press(await screen.findByRole("button", { name: "Кафе и рестораны" }));
      expect(await screen.findByText("Это скорее")).toBeTruthy();
      expect(screen.getByText(CAPTION)).toBeTruthy();
      expect(side("Желаемое").props.accessibilityState.selected).toBe(true);
      expect(side("Нужное").props.accessibilityState.selected).toBe(false);
      expect((StyleSheet.flatten(side("Нужное").props.style) as { minHeight?: number }).minHeight).toBeGreaterThanOrEqual(tokens.touchMin);
      // Between the name and the icons, as in the mockup.
      const texts = screen.getAllByText(/^(Название|Это скорее|Значок)$/).map((t) => String(t.props.children));
      expect(texts).toEqual(["Название", "Это скорее", "Значок"]);
      await fireEvent.press(side("Нужное"));
      await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
      await waitFor(() => expect(api.patchCategory).toHaveBeenCalledWith("cafe", { want: false }));
    });

    it("the same side sends nothing", async () => {
      const api = fakeApi({ categories: jest.fn(async () => SIDED), patchCategory: jest.fn() });
      await renderWith(<CategoriesSheet onClose={noop} />, api);
      await fireEvent.press(await screen.findByRole("button", { name: "Продукты" }));
      await fireEvent.press(await screen.findByRole("radio", { name: "Нужное" }));
      await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
      await waitFor(() => expect(screen.queryByText("Это скорее")).toBeNull());
      expect(api.patchCategory).not.toHaveBeenCalled();
    });

    it("a system category has no side", async () => {
      await renderWith(<CategoriesSheet onClose={noop} />, fakeApi({ categories: jest.fn(async () => SIDED) }));
      await fireEvent.press(await screen.findByRole("button", { name: "Возвраты" }));
      expect(await screen.findByText("Служебная категория: можно сменить только значок")).toBeTruthy();
      expect(screen.queryByText("Это скорее")).toBeNull();
    });

    it("an older server without sides shows none, for a category or a new one", async () => {
      await renderWith(<CategoriesSheet onClose={noop} />, fakeApi({ categories: jest.fn(async () => LIST) }));
      await fireEvent.press(await screen.findByRole("button", { name: "Кот" }));
      expect(await screen.findByLabelText("Название")).toBeTruthy();
      expect(screen.queryByText("Это скорее")).toBeNull();
    });

    it("a new category is «Нужное» unless «Желаемое» is chosen", async () => {
      const created: CategoryDto = { key: "c_new", name: "Спорт", icon: "star", system: false, want: true };
      const api = fakeApi({ categories: jest.fn(async () => SIDED), createCategory: jest.fn(async () => created) });
      await renderWith(<CategoriesSheet onClose={noop} />, api);
      await fireEvent.press(await screen.findByRole("button", { name: "Новая категория" }));
      expect((await screen.findByRole("radio", { name: "Нужное" })).props.accessibilityState.selected).toBe(true);
      await fireEvent.changeText(screen.getByLabelText("Название"), "Спорт");
      await fireEvent.press(side("Желаемое"));
      await fireEvent.press(screen.getByRole("button", { name: "Добавить" }));
      await waitFor(() => expect(api.createCategory).toHaveBeenCalledWith({ name: "Спорт", icon: "star", want: true }));
    });

    it("a new category left as it is goes as «Нужное»", async () => {
      const created: CategoryDto = { key: "c_new", name: "Дом", icon: "star", system: false, want: false };
      const api = fakeApi({ categories: jest.fn(async () => SIDED), createCategory: jest.fn(async () => created) });
      await renderWith(<CategoriesSheet onClose={noop} />, api);
      await fireEvent.press(await screen.findByRole("button", { name: "Новая категория" }));
      await fireEvent.changeText(await screen.findByLabelText("Название"), "Дом");
      await fireEvent.press(screen.getByRole("button", { name: "Добавить" }));
      await waitFor(() => expect(api.createCategory).toHaveBeenCalledWith({ name: "Дом", icon: "star", want: false }));
    });
  });

  it("an older server: one calm line, nothing to change", async () => {
    await renderWith(<CategoriesSheet onClose={noop} />, fakeApi({ categories: jest.fn(async () => null) }));
    expect(await screen.findByText("Свои категории появятся после обновления сервера.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Новая категория" })).toBeNull();
  });
});
