import { palette as p, blackAlpha } from "./palette";

/** Semantic Silver tokens. Surfaces are opaque; what is translucent is the scrim and the glass. */
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
    /** Dims what is behind a window, while the glass still has something to show. */
    scrim: blackAlpha(0.6),
  },
  glass: {
    /** The menu and windows: the system's glass, dark enough for text over the brightest metal. */
    floating: { tint: blackAlpha(0.55), fallback: p.graphite[800] },
    /** Cards: the same glass, lighter, as what is behind them is only the blurred backdrop. */
    surface: { tint: blackAlpha(0.18), fallback: p.graphite[900] },
    /** The menu: only icons on it, so it can be the most see-through. */
    menu: { tint: blackAlpha(0.3), fallback: p.graphite[800] },
    /** List rows: too many for real glass, so a see-through fill. */
    row: blackAlpha(0.6),
  },
  /** How a day went against the limit; dark numbers on them. */
  calendar: { within: p.sage, over: p.rose, farOver: p.crimson },
  /** The app's backdrop of metal folds: `peak` caps its thin crests, `sheet` the wide light that survives the glass's blur. */
  backdrop: { peak: p.silver[400], sheet: p.graphite[500] },
  // Statuses differ by lightness, and danger (errors) by a calm red. Each also carries a text label.
  status: {
    success: p.silver[400],
    warning: p.silver[200],
    danger: p.rose,
  },
  accent: {
    default: p.silver[100],
    soft: p.silver[200],
    fgOnAccent: p.black,
  },
  // Hue only on amounts, and always with a sign, so colour is never the only signal.
  money: {
    income: p.sage,
    expense: p.coral,
    neutral: p.white,
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

/** The liquid metal: a quarter of the pixels (it is soft), how fast the level moves, the pose when motion is reduced, widths of thin metal edges. */
export const metal = { renderScale: 2, levelTau: 0.35, stillTime: 4, edge: 1.5, edgeToday: 2.5 } as const;

/** Minimum touch target in points (Apple HIG). */
export const touchMin = 44;
