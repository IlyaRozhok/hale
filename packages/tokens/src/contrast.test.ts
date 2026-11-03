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
  it("carry a dark number, and differ from one another", () => {
    const { within, over, farOver } = color.calendar;
    for (const c of [within, over, farOver]) expect(contrastRatio(color.fg.inverse, c)).toBeGreaterThanOrEqual(4.5);
    expect(new Set([within, over, farOver]).size).toBe(3);
    expect(contrastRatio(over, farOver)).toBeGreaterThanOrEqual(1.2);
  });
});

describe("metal settings", () => {
  it("are in the tokens", () => {
    expect(tokens.metal).toEqual({ renderScale: 2, levelTau: 0.35, stillTime: 4 });
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
