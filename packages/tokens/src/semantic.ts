import { palette as p, blackAlpha, sageAlpha, sandAlpha, whiteAlpha } from "./palette";

/** Semantic Silver tokens. Surfaces are opaque; what is translucent is the scrim and the glass. */
export const color = {
  fg: {
    default: p.fog[100],
    /** The big title of a screen and its main figure. */
    strong: p.fog[50],
    muted: p.silver[300],
    subtle: p.silver[400],
    inverse: p.black,
  },
  surface: {
    /** The screen: a flat dark graphite with no light on it (variant «Б»). */
    base: p.graphite[950],
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
  /** How a day went against the limit: a small dot under its number. Red only for far over. */
  calendar: { within: p.sage, over: p.sand, farOver: p.crimson },
  /**
   * The brightest things glass may sit over: `peak` a thin bright crest, `sheet` a wide light. The screen itself is now
   * flat graphite (variant «Б»); these stay as the worst case the glass's contrast is checked against.
   */
  backdrop: { peak: p.silver[400], sheet: p.graphite[500] },
  /**
   * Solid cards on the dark background: there is nothing behind them for glass to blur. No line around them;
   * `edge` is the faint hairline between rows.
   */
  card: { fill: p.graphite[850], edge: whiteAlpha(0.05) },
  /** An input's fill: one step above the card, so a field shows both on the screen and inside a card. */
  field: { fill: p.graphite[700] },
  /** Loading bars: visible on a card and on the screen. */
  skeleton: p.graphite[700],
  /** Inside a list card: the quiet line under a name and the headers, the value on the right, the glyph, the chevron. */
  list: { secondary: p.fog[400], value: p.fog[300], icon: p.fog[300], chevron: p.fog[600] },
  /** The limit strip: silver, with a small spark at its end that says how the day stands. */
  limit: { ok: p.sage, low: p.sand, over: p.ember, overDeep: p.wine, strip: p.silver[100] },
  /** The runway graph: a forecast line with a soft fill fading to nothing, sand once it is below zero. */
  runway: {
    line: p.white,
    fill: whiteAlpha(0.16),
    fade: whiteAlpha(0),
    low: p.sand,
    lowFill: sandAlpha(0.2),
    lowFade: sandAlpha(0),
    zero: p.graphite[500],
  },
  /** The thin limit strip: brushed silver whose highlight glides slowly along it. */
  metalBar: { shade: p.silver[400], body: p.silver[200], glint: p.white },
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
    /** The one colour accent, used sparingly: money in and the count on the bell. */
    signal: p.sage,
    fgOnSignal: p.black,
    /** The faint sage behind a small pill whose words are the accent itself (the month on «Сегодня», task ЧЛ7). */
    signalSoft: sageAlpha(0.12),
  },
  // Hue only on amounts, and always with a sign, so colour is never the only signal.
  money: {
    income: p.sage,
    expense: p.coral,
    neutral: p.fog[100],
    bonus: p.silver[100],
  },
  data: {
    actual: p.white,
    forecast: p.silver[300],
    target: p.silver[400],
    grid: p.graphite[700],
    track: p.graphite[500],
    /**
     * The shares of one bar (the month on «Сегодня», task ЧЛ7): five steps of the one sage, the largest share the
     * brightest. Told apart by lightness, and each share also has its name beside the bar.
     */
    shares: p.sageSteps,
  },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** `card`: the rounder corner of a list card (variant «Б»). */
export const radius = { sm: 6, md: 10, lg: 14, xl: 20, card: 22, full: 9999 } as const;

export const type = {
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
  title: { fontSize: 20, lineHeight: 28, fontWeight: "600" },
  display: { fontSize: 34, lineHeight: 40, fontWeight: "700" },
  /** The day's sum on Today: dense, tabular figures. */
  amount: { fontSize: 52, lineHeight: 60, fontWeight: "600", letterSpacing: -1.5 },
  /** The one large figure on Today, standing on the screen itself with no card around it: «Сегодня можно». */
  hero: { fontSize: 60, lineHeight: 64, fontWeight: "500", letterSpacing: -2 },
} as const;

/** The liquid metal: a quarter of the pixels (it is soft), how fast the level moves, the pose when motion is reduced. */
export const metal = { renderScale: 2, levelTau: 0.35, stillTime: 4, barHeight: 6, barSpeed: 0.25 } as const;

/** Minimum touch target in points (Apple HIG). */
export const touchMin = 44;
