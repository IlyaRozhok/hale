import { describe, expect, it } from "vitest";
import { contrastRatio, tokens } from "./index";

const { color } = tokens;

describe("contrastRatio", () => {
  it("matches known WCAG values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });
});

describe("silver tokens contrast (WCAG AA 4.5:1)", () => {
  it("fg.default on surface.base and surface.raised", () => {
    expect(contrastRatio(color.fg.default, color.surface.base)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.fg.default, color.surface.raised)).toBeGreaterThanOrEqual(4.5);
  });
  it("fg.muted on surface.base and surface.raised", () => {
    expect(contrastRatio(color.fg.muted, color.surface.base)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.fg.muted, color.surface.raised)).toBeGreaterThanOrEqual(4.5);
  });
  it("status.success on surface.base", () => {
    expect(contrastRatio(color.status.success, color.surface.base)).toBeGreaterThanOrEqual(4.5);
  });
  it("money colours on surface.base and surface.inset", () => {
    for (const c of [color.money.expense, color.money.income, color.money.neutral]) {
      expect(contrastRatio(c, color.surface.base)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c, color.surface.inset)).toBeGreaterThanOrEqual(4.5);
    }
    expect(color.money.expense).toBe("#E39A8F");
    expect(color.money.income).toBe("#8CC7A1");
    expect(color.money.neutral).toBe(color.fg.default);
  });
  it("status.danger is a calm red, readable on every surface", () => {
    for (const s of [color.surface.base, color.surface.inset, color.surface.raised]) {
      expect(contrastRatio(color.status.danger, s)).toBeGreaterThanOrEqual(4.5);
    }
    expect(color.status.danger).toBe("#F08585");
    expect(color.status.danger).not.toBe(color.money.expense);
  });
  it("the one green accent reads on the base, and its badge text on it", () => {
    expect(color.accent.signal).toBe("#8CC7A1");
    expect(contrastRatio(color.accent.signal, color.surface.base)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.accent.fgOnSignal, color.accent.signal)).toBeGreaterThanOrEqual(4.5);
  });
  it("the limit's spark colours are muted, and the overspent words read on the base", () => {
    expect(color.limit).toEqual({ ok: "#8CC7A1", low: "#D6B26E", over: "#E07A7A", overDeep: "#3A2224", strip: "#E9EBEE" });
    expect(contrastRatio(color.status.danger, color.surface.base)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.limit.low, color.surface.base)).toBeGreaterThanOrEqual(4.5);
  });
  it("cards are solid and a step above the background, with a hairline edge", () => {
    expect(contrastRatio(color.fg.default, color.card.fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.fg.muted, color.card.fill)).toBeGreaterThanOrEqual(4.5);
    expect(color.card.fill).not.toBe(color.surface.base);
  });
});

describe("soft graphite (owner's variant «Б»)", () => {
  const lum = (hex: string) => contrastRatio(hex, "#000000");

  it("the screen is a flat dark graphite, not black, and a card is one step lighter", () => {
    expect(color.surface.base).toBe("#121417");
    expect(color.card.fill).toBe("#1B1E22");
    expect(lum(color.card.fill)).toBeGreaterThan(lum(color.surface.base));
    expect("glow" in color.backdrop).toBe(false);
  });
  it("the line between rows is a faint white hairline", () => {
    expect(color.card.edge).toBe("rgba(255, 255, 255, 0.05)");
  });
  it("text is softer than white: the big title a touch brighter than the rest", () => {
    expect(color.fg.default).toBe("#E8EAED");
    expect(color.fg.strong).toBe("#F2F3F5");
    expect(color.money.neutral).toBe(color.fg.default);
    expect(lum(color.fg.strong)).toBeGreaterThan(lum(color.fg.default));
  });
  it("a list's secondary text, values and icons read on the card and on the screen", () => {
    expect(color.list).toEqual({ secondary: "#8B9098", value: "#A6ABB3", icon: "#A6ABB3", chevron: "#4A4E55" });
    for (const bg of [color.card.fill, color.surface.base]) {
      for (const c of [color.fg.strong, color.fg.default, color.list.secondary, color.list.value, color.money.income]) {
        expect(contrastRatio(c, bg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(color.list.icon, bg)).toBeGreaterThanOrEqual(3);
    }
  });
  it("the chevron is the quietest mark on a row, but still there", () => {
    expect(lum(color.list.chevron)).toBeLessThan(lum(color.list.secondary));
    expect(contrastRatio(color.list.chevron, color.card.fill)).toBeGreaterThanOrEqual(1.5);
  });
  it("an input's fill stands out on the screen and inside a card, and is never darker than the card", () => {
    expect(lum(color.field.fill)).toBeGreaterThan(lum(color.card.fill));
    expect(contrastRatio(color.field.fill, color.surface.base)).toBeGreaterThanOrEqual(1.3);
    expect(contrastRatio(color.field.fill, color.card.fill)).toBeGreaterThanOrEqual(1.2);
    expect(contrastRatio(color.fg.default, color.field.fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.fg.subtle, color.field.fill)).toBeGreaterThanOrEqual(4.5);
  });
  it("a loading bar shows on a card and on the screen", () => {
    expect(contrastRatio(color.skeleton, color.card.fill)).toBeGreaterThanOrEqual(1.2);
    expect(contrastRatio(color.skeleton, color.surface.base)).toBeGreaterThanOrEqual(1.3);
  });
  it("a list card is rounder than before", () => {
    expect(tokens.radius.card).toBe(22);
  });
  it("accent.fgOnAccent on accent.default", () => {
    expect(contrastRatio(color.accent.fgOnAccent, color.accent.default)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("floating glass, in the worst case", () => {
  /** Composites an rgba() string over an opaque #RRGGBB. */
  function over(rgba: string, hex: string): string {
    const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(rgba);
    if (!m) throw new Error(`not rgba: ${rgba}`);
    const a = Number(m[4]);
    const out = [1, 2, 3].map((i) => {
      const under = parseInt(hex.slice(i * 2 - 1, i * 2 + 1), 16);
      return Math.round(Number(m[i]) * a + under * (1 - a)).toString(16).padStart(2, "0");
    });
    return `#${out.join("")}`;
  }
  const brightest = "#FFFFFF"; // the metal is at most white

  it("keeps text readable on a window over the scrim, over the brightest metal", () => {
    const backing = over(color.glass.floating.tint, over(color.surface.scrim, brightest));
    expect(contrastRatio(color.fg.default, backing)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.fg.muted, backing)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.status.danger, backing)).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps the menu's icons readable over the backdrop's brightest crest", () => {
    const backing = over(color.glass.menu.tint, color.backdrop.peak);
    expect(contrastRatio(color.fg.default, backing)).toBeGreaterThanOrEqual(3);
  });
  it("keeps text readable on cards over the blurred backdrop, and on see-through rows over its brightest crest", () => {
    for (const backing of [over(color.glass.surface.tint, color.backdrop.sheet), over(color.glass.row, color.backdrop.peak)]) {
      expect(contrastRatio(color.fg.default, backing)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color.fg.muted, backing)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color.fg.subtle, backing)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(color.money.expense, backing)).toBeGreaterThanOrEqual(3);
    }
  });
  it("the fallback fills are opaque and readable", () => {
    for (const fill of [color.glass.floating.fallback, color.glass.surface.fallback]) {
      expect(fill).toMatch(/^#[0-9A-F]{6}$/);
      expect(contrastRatio(color.fg.muted, fill)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("limit calendar colours", () => {
  it("are small dots seen on the sheet, and differ from one another", () => {
    const { within, over, farOver } = color.calendar;
    for (const c of [within, over, farOver]) expect(contrastRatio(c, color.glass.floating.fallback)).toBeGreaterThanOrEqual(3);
    expect(new Set([within, over, farOver]).size).toBe(3);
    expect(contrastRatio(over, farOver)).toBeGreaterThanOrEqual(1.2);
  });
  it("keep red for far over the limit only: over the limit is the sand of a warning", () => {
    expect(color.calendar.over).toBe(color.limit.low);
    expect(color.calendar.farOver).not.toBe(color.calendar.over);
  });
});

describe("the shares of a bar (ЧЛ7)", () => {
  const lum = (hex: string) => contrastRatio(hex, "#000000");
  const { shares } = color.data;

  it("are five steps of the one sage, from the accent itself down to the darkest", () => {
    expect(shares).toEqual(["#8CC7A1", "#73AA89", "#5A8C71", "#446E59", "#325143"]);
    expect(shares[0]).toBe(color.accent.signal);
    for (let i = 1; i < shares.length; i++) expect(lum(shares[i]!)).toBeLessThan(lum(shares[i - 1]!));
  });
  it("every step shows on the screen, and neighbours differ enough to see where one share ends", () => {
    for (const step of shares) expect(contrastRatio(step, color.surface.base)).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < shares.length; i++) expect(contrastRatio(shares[i]!, shares[i - 1]!)).toBeGreaterThanOrEqual(1.3);
  });
});

describe("the sage pill (ЧЛ7)", () => {
  it("is a faint tint of the accent, and the accent's words still read on it over the screen", () => {
    expect(color.accent.signalSoft).toBe("rgba(140, 199, 161, 0.12)");
    // 12% of the sage over the screen's graphite.
    const mix = (i: number) => Math.round(parseInt(color.accent.signal.slice(i, i + 2), 16) * 0.12 + parseInt(color.surface.base.slice(i, i + 2), 16) * 0.88);
    const backing = `#${[1, 3, 5].map((i) => mix(i).toString(16).padStart(2, "0")).join("")}`;
    expect(contrastRatio(color.accent.signal, backing)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("metal settings", () => {
  it("are in the tokens", () => {
    expect(tokens.metal).toEqual({ renderScale: 2, levelTau: 0.35, stillTime: 4, barHeight: 6, barSpeed: 0.25 });
  });
});

describe("token shape", () => {
  it("has opaque surfaces and a translucent scrim", () => {
    for (const [name, v] of Object.entries(color.surface)) {
      if (name === "scrim") continue;
      expect(v, name).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(color.surface.scrim).toMatch(/^rgba\(/);
  });
  it("exposes scales and touchMin", () => {
    expect(tokens.touchMin).toBe(44);
    expect(tokens.space.md).toBeGreaterThan(0);
    expect(tokens.radius.md).toBeGreaterThan(0);
    expect(tokens.type.body.fontSize).toBeGreaterThan(0);
  });
  it("does not export the raw palette", async () => {
    const mod = await import("./index");
    expect("palette" in mod).toBe(false);
  });
});
