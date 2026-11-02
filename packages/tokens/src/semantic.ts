import { palette as p, blackAlpha, whiteAlpha } from "./palette";

/** Semantic Silver tokens. Surfaces are opaque; translucent fills live in surface.glass. */
export const color = {
  fg: {
    default: p.white,
    muted: p.silver[300],
    subtle: p.silver[400],
    inverse: p.black,
  },
  surface: {
    base: p.black,
    inset: p.graphite[900],
    raised: p.graphite[800],
    overlay: p.graphite[700],
    selected: p.silver[100],
    glass: whiteAlpha(0.14),
    /** Dark scrim for every panel and text that sits over the liquid metal (design §8). */
    overMetal: blackAlpha(0.75),
  },
  // No hue: statuses differ by lightness, so every status must also carry a text label.
  status: {
    success: p.silver[400],
    warning: p.silver[200],
    danger: p.white,
  },
  accent: {
    default: p.silver[100],
    soft: p.silver[200],
    fgOnAccent: p.black,
  },
  money: {
    income: p.silver[100],
    expense: p.white,
    bonus: p.silver[100],
  },
  data: {
    actual: p.white,
    forecast: p.silver[300],
    target: p.silver[400],
    grid: p.graphite[700],
    track: p.graphite[500],
  },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 14, xl: 20, full: 9999 } as const;

export const type = {
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
  title: { fontSize: 20, lineHeight: 28, fontWeight: "600" },
  display: { fontSize: 34, lineHeight: 40, fontWeight: "700" },
} as const;

/** Minimum touch target in points (Apple HIG). */
export const touchMin = 44;
