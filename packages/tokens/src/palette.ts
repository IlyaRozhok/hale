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
  rose: "#F08585",
  graphite: {
    500: "#54585F",
    700: "#2C2F34",
    800: "#1E2024",
    900: "#17191D",
  },
} as const;

export const whiteAlpha = (opacity: number): string => `rgba(255, 255, 255, ${opacity})`;

export const blackAlpha = (opacity: number): string => `rgba(10, 11, 13, ${opacity})`;
