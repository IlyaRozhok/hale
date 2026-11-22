import { fireEvent, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import type { PaceDto } from "@hale/contracts";
import { PaceSheet, paceHintText, paceLineText } from "./PaceSheet";
import { fakeApi, renderWith } from "../testing";

const pace = (over: Partial<PaceDto> = {}): PaceDto => ({
  avgDaily: 460_000,
  runOutOn: "2026-12-03",
  incomeOn: "2026-12-15",
  hint: { daily: 380_000, lastsUntil: "2026-12-05", untilIncome: 220_000 },
  ...over,
});

describe("the pace sheet (А24)", () => {
  it("names the usual day, the limit, the day the money lasts to and the income", async () => {
    await renderWith(<PaceSheet pace={pace()} dailyLimit={230_000} today="2026-11-22" onClose={() => undefined} />, fakeApi());
    expect(await screen.findByText("Темп трат")).toBeTruthy();
    expect(screen.getByText("Обычно в день")).toBeTruthy();
    expect(screen.getByText("₴4,600")).toBeTruthy();
    expect(screen.getByText("Лимит")).toBeTruthy();
    expect(screen.getByText("₴2,300")).toBeTruthy();
    expect(screen.getByText("Хватит до")).toBeTruthy();
    expect(screen.getByText("Доход")).toBeTruthy();
    expect(screen.getByText("15 дек")).toBeTruthy();
  });

  it("the day the money lasts to is sand, a warning; nothing in the sheet is red", async () => {
    await renderWith(<PaceSheet pace={pace()} dailyLimit={230_000} today="2026-11-22" onClose={() => undefined} />, fakeApi());
    const lasts = await screen.findByText("3 дек");
    expect(StyleSheet.flatten(lasts.props.style).color).toBe(tokens.color.limit.low);
    for (const t of screen.getAllByText(/./)) {
      const c = StyleSheet.flatten(t.props.style)?.color;
      expect([tokens.color.status.danger, tokens.color.limit.over, tokens.color.calendar.farOver]).not.toContain(c);
    }
  });

  it("with a hint, one calm step and the amount that lasts to the income, then the note", async () => {
    await renderWith(<PaceSheet pace={pace()} dailyLimit={230_000} today="2026-11-22" onClose={() => undefined} />, fakeApi());
    expect(await screen.findByText("Если тратить около ₴3,800 в день — хватит до 5 дек. Около ₴2,200 — до самого дохода.")).toBeTruthy();
    expect(screen.getByText("Обычный день — среднее за последние 7 дней. Лимит от этого не меняется.")).toBeTruthy();
  });

  it("without a hint, only the rows and the note", async () => {
    await renderWith(<PaceSheet pace={pace({ hint: undefined })} dailyLimit={230_000} today="2026-11-22" onClose={() => undefined} />, fakeApi());
    await screen.findByText("Темп трат");
    expect(screen.queryByText(/^Если тратить/)).toBeNull();
    expect(screen.getByText("Обычный день — среднее за последние 7 дней. Лимит от этого не меняется.")).toBeTruthy();
  });

  it("«Понятно» closes it", async () => {
    const onClose = jest.fn();
    await renderWith(<PaceSheet pace={pace()} dailyLimit={230_000} today="2026-11-22" onClose={onClose} />, fakeApi());
    await fireEvent.press(await screen.findByRole("button", { name: "Понятно" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("the hint's words", () => {
    const hint = pace().hint!;

    it("never names more than the person's own limit, rounded down to ₴100", () => {
      expect(paceHintText({ ...hint, untilIncome: 260_000 }, 230_434)).toBe(
        "Если тратить около ₴3,800 в день — хватит до 5 дек. Около ₴2,300 — до самого дохода.",
      );
      expect(paceHintText({ ...hint, untilIncome: 220_000 }, 230_434)).toBe(
        "Если тратить около ₴3,800 в день — хватит до 5 дек. Около ₴2,200 — до самого дохода.",
      );
    });

    it("a limit below ₴100 leaves only the first sentence", () => {
      expect(paceHintText(hint, 9_000)).toBe("Если тратить около ₴3,800 в день — хватит до 5 дек.");
    });

    it("a server without the amount to the income (before А24а2) leaves only the first sentence", () => {
      const old = { daily: 380_000, lastsUntil: "2026-12-05" } as unknown as NonNullable<PaceDto["hint"]>;
      expect(paceHintText(old, 230_000)).toBe("Если тратить около ₴3,800 в день — хватит до 5 дек.");
    });
  });

  it("the line under the limit names both days", () => {
    expect(paceLineText(pace(), "2026-11-22")).toBe("В таком темпе хватит до 3 дек — доход 15 дек");
  });

  describe("when the money lasts only today", () => {
    const todayOnly = pace({ runOutOn: "2026-11-22", hint: undefined });

    it("the line says so in one sentence", () => {
      expect(paceLineText(todayOnly, "2026-11-22")).toBe("В таком темпе денег хватит только на сегодня — доход 15 дек");
    });

    it("the sheet's sand row says «только на сегодня» instead of a date", async () => {
      await renderWith(<PaceSheet pace={todayOnly} dailyLimit={230_000} today="2026-11-22" onClose={() => undefined} />, fakeApi());
      const row = await screen.findByText("только на сегодня");
      expect(StyleSheet.flatten(row.props.style).color).toBe(tokens.color.limit.low);
      expect(screen.getByText("Хватит")).toBeTruthy();
      expect(screen.queryByText("Хватит до")).toBeNull();
      expect(screen.queryByText("22 ноя")).toBeNull();
    });
  });
});
