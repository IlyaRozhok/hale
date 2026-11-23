import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import type { PaceDto } from "@hale/contracts";
import { PaceSheet, paceHintText, paceLineText } from "./PaceSheet";
import { fakeApi, renderWith } from "../testing";

const pace = (over: Partial<PaceDto> = {}): PaceDto => ({
  avgDaily: 500_000,
  runOutOn: "2026-12-13",
  incomeOn: "2026-12-15",
  hint: { daily: 380_000, lastsUntil: "2026-12-14", untilIncome: 150_000 },
  ...over,
});

const FIRST = "Последние 7 дней уходило около ₴5,000 в день. В таком темпе денег хватит до 13 дек, а доход — 15 дек.";
const STEP = "Если держаться лимита ₴2,000 в день, хватит до дохода и останется ₴12,000.";
const NOTE = "Лимит от этого не меняется.";

describe("the pace sheet (ЯМ1: two sentences instead of a table)", () => {
  it("says what happens and what to do, then the quiet note", async () => {
    await renderWith(<PaceSheet pace={pace()} dailyLimit={200_000} reserve={1_200_000} today="2026-11-23" onClose={() => undefined} />, fakeApi());
    expect(await screen.findByText("Темп трат")).toBeTruthy();
    expect(screen.getByText(FIRST)).toBeTruthy();
    expect(screen.getByText(STEP)).toBeTruthy();
    const note = screen.getByText(NOTE);
    expect(StyleSheet.flatten(note.props.style).color).toBe(tokens.color.fg.muted);
    // The four-row table is gone, and with the step said the middle hint is not said too.
    for (const gone of ["Обычно в день", "Лимит", "Хватит до", "Доход"]) expect(screen.queryByText(gone)).toBeNull();
    expect(screen.queryByText(/^Если тратить/)).toBeNull();
  });

  it("nothing in the sheet is red", async () => {
    await renderWith(<PaceSheet pace={pace()} dailyLimit={200_000} reserve={1_200_000} today="2026-11-23" onClose={() => undefined} />, fakeApi());
    await screen.findByText(FIRST);
    for (const t of screen.getAllByText(/./)) {
      const c = StyleSheet.flatten(t.props.style)?.color;
      expect([tokens.color.status.danger, tokens.color.limit.over, tokens.color.calendar.farOver]).not.toContain(c);
    }
  });

  it("money that ends even at the limit: no «останется»; the server's calm middle step instead", async () => {
    await renderWith(<PaceSheet pace={pace()} dailyLimit={200_000} reserve={-300_000} today="2026-11-23" onClose={() => undefined} />, fakeApi());
    expect(await screen.findByText(FIRST)).toBeTruthy();
    expect(screen.queryByText(/останется/)).toBeNull();
    expect(screen.getByText("Если тратить около ₴3,800 в день — хватит до 14 дек. Около ₴1,500 — до самого дохода.")).toBeTruthy();
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it("a zero reserve is not «останется ₴0»", async () => {
    await renderWith(<PaceSheet pace={pace({ hint: undefined })} dailyLimit={200_000} reserve={0} today="2026-11-23" onClose={() => undefined} />, fakeApi());
    expect(await screen.findByText(FIRST)).toBeTruthy();
    expect(screen.queryByText(/останется/)).toBeNull();
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it("an older server with no runway: the first sentence, the hint if any, the note", async () => {
    await renderWith(<PaceSheet pace={pace()} dailyLimit={200_000} reserve={null} today="2026-11-23" onClose={() => undefined} />, fakeApi());
    expect(await screen.findByText(FIRST)).toBeTruthy();
    expect(screen.queryByText(/останется/)).toBeNull();
    expect(screen.getByText(/^Если тратить около ₴3,800/)).toBeTruthy();
  });

  it("money that lasts only today is said so, with no date of today", async () => {
    await renderWith(<PaceSheet pace={pace({ runOutOn: "2026-11-23" })} dailyLimit={200_000} reserve={1_200_000} today="2026-11-23" onClose={() => undefined} />, fakeApi());
    expect(await screen.findByText("Последние 7 дней уходило около ₴5,000 в день. В таком темпе денег хватит только на сегодня, а доход — 15 дек.")).toBeTruthy();
    expect(screen.queryByText(/23 ноя/)).toBeNull();
  });

  it("closes as every sheet does, with «Закрыть», and has no «Понятно» of its own (Я6)", async () => {
    const onClose = jest.fn();
    await renderWith(<PaceSheet pace={pace()} dailyLimit={200_000} reserve={1_200_000} today="2026-11-23" onClose={onClose} />, fakeApi());
    await screen.findByText(FIRST);
    expect(screen.queryByRole("button", { name: "Понятно" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: "Закрыть" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  describe("the hint's words", () => {
    const hint = pace().hint!;

    it("never names more than the person's own limit, rounded down to ₴100", () => {
      expect(paceHintText({ ...hint, untilIncome: 260_000 }, 230_434)).toBe(
        "Если тратить около ₴3,800 в день — хватит до 14 дек. Около ₴2,300 — до самого дохода.",
      );
      expect(paceHintText({ ...hint, untilIncome: 220_000 }, 230_434)).toBe(
        "Если тратить около ₴3,800 в день — хватит до 14 дек. Около ₴2,200 — до самого дохода.",
      );
    });

    it("a limit below ₴100 leaves only the first sentence", () => {
      expect(paceHintText(hint, 9_000)).toBe("Если тратить около ₴3,800 в день — хватит до 14 дек.");
    });

    it("a server without the amount to the income (before А24а2) leaves only the first sentence", () => {
      const old = { daily: 380_000, lastsUntil: "2026-12-14" } as unknown as NonNullable<PaceDto["hint"]>;
      expect(paceHintText(old, 230_000)).toBe("Если тратить около ₴3,800 в день — хватит до 14 дек.");
    });
  });

  describe("the sand line on «Сегодня»", () => {
    it("names the day the money lasts to; the income's day stands in the card's header", () => {
      expect(paceLineText(pace(), "2026-11-23")).toBe("В таком темпе хватит до 13 дек.");
    });

    it("money that lasts only today is said in one sentence", () => {
      expect(paceLineText(pace({ runOutOn: "2026-11-23" }), "2026-11-23")).toBe("В таком темпе денег хватит только на сегодня.");
    });
  });
});
