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

describe("surface.overMetal over the brightest metal", () => {
  /** Composites an rgba() string over opaque white (the worst case: metal is at most white). */
  function overWhite(rgba: string): string {
    const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(rgba);
    if (!m) throw new Error(`not rgba: ${rgba}`);
    const a = Number(m[4]);
    const hex = [1, 2, 3].map((i) => Math.round(Number(m[i]) * a + 255 * (1 - a)).toString(16).padStart(2, "0"));
    return `#${hex.join("")}`;
  }
  const backing = overWhite(color.surface.overMetal);
  it("keeps fg.default and fg.muted at 4.5:1", () => {
    expect(contrastRatio(color.fg.default, backing)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.fg.muted, backing)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("token shape", () => {
  it("has opaque surfaces and a separate glass token", () => {
    for (const [name, v] of Object.entries(color.surface)) {
      if (name === "glass" || name === "overMetal") continue;
      expect(v, name).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(color.surface.glass).toMatch(/^rgba\(/);
    expect(color.surface.overMetal).toMatch(/^rgba\(/);
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
