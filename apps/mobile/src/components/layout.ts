/** Heights shared by the loaded screen and its skeleton. */
export const LAYOUT = {
  eyebrow: 20,
  amount: 64,
  note: 20,
  /** The metal's own band, below the text, so it never runs under a number. */
  pool: 132,
  goals: 112,
  upcoming: 176,
  /** Room a scrolling screen leaves for the floating menu, above the home indicator. */
  tabBar: 72,
} as const;
