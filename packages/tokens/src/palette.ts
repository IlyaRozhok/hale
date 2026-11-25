/**
 * Raw Silver palette (black, white and the silver between them).
 * Internal: not exported from index.ts. Consumers use semantic tokens only.
 * Values come from tablo-web/src/shared/config/theme/palette.ts.
 */
export const palette = {
  white: "#FFFFFF",
  black: "#0A0B0D",
  silver: {
    50: "#F6F7F8",
    100: "#E9EBEE",
    200: "#D5D8DD",
    300: "#BFC3C9",
    400: "#9EA3AB",
  },
  /** Hues are few and muted: an ordinary expense is not an error, and an error is no alarm. */
  coral: "#E39A8F",
  sage: "#8CC7A1",
  /** The sage from bright to dark, for the shares of one bar (task ЧЛ7); the first step is the sage itself. */
  sageSteps: ["#8CC7A1", "#73AA89", "#5A8C71", "#446E59", "#325143"],
  rose: "#F08585",
  crimson: "#E25C5C",
  /** Muted sand for "almost used up", and a deep wine the overspent strip starts from. */
  sand: "#D6B26E",
  ember: "#E07A7A",
  wine: "#3A2224",
  graphite: {
    500: "#54585F",
    700: "#2C2F34",
    800: "#1E2024",
    /** The list card of the soft graphite (variant «Б»): one step above the screen. */
    850: "#1B1E22",
    900: "#17191D",
    /** The screen of the soft graphite: flat, not black. */
    950: "#121417",
  },
  /** Soft greys for text on graphite: a little less white, so it glares less at night. */
  fog: {
    50: "#F2F3F5",
    100: "#E8EAED",
    300: "#A6ABB3",
    400: "#8B9098",
    600: "#4A4E55",
  },
} as const;

export const whiteAlpha = (opacity: number): string => `rgba(255, 255, 255, ${opacity})`;

export const blackAlpha = (opacity: number): string => `rgba(10, 11, 13, ${opacity})`;

export const sandAlpha = (opacity: number): string => `rgba(214, 178, 110, ${opacity})`;

export const sageAlpha = (opacity: number): string => `rgba(140, 199, 161, ${opacity})`;
