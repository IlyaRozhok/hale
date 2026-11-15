// Pure: runs in node tests.

/** Whole hryvnias of a total the way `formatMoney` shows it: half away from zero. */
const wholeOf = (kopecks: number): number => Math.sign(kopecks) * Math.round(Math.abs(kopecks) / 100);

/**
 * Rounds the places of own money to whole hryvnias so that they add up exactly to the total as it is
 * shown (task Б25): each place starts rounded down, and the hryvnias still missing go to the places
 * with the largest remainders, earlier places first on a tie. Returns whole hryvnias, one per place.
 * When the places do not add up to the total at all (a server bug), each is rounded on its own.
 */
export function wholeShares(totalKopecks: number, kopecks: number[]): number[] {
  const floors = kopecks.map((k) => Math.floor(k / 100));
  const missing = wholeOf(totalKopecks) - floors.reduce((s, f) => s + f, 0);
  if (missing < 0 || missing > kopecks.length) return kopecks.map(wholeOf);
  const byRemainder = kopecks
    .map((k, i) => ({ i, rest: k - floors[i]! * 100 }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i)
    .slice(0, missing);
  const out = [...floors];
  for (const { i } of byRemainder) out[i]! += 1;
  return out;
}
