// Where the metal edge of each calendar day goes. No native imports: runs in node tests.

export interface DayEdge {
  date: string;
  x: number;
  y: number;
  width: number;
  height: number;
  today: boolean;
}

/** One edge per day that has a result or is today, inside its cell by `inset`, which keeps days apart. */
export function dayEdges(
  grid: readonly (string | null)[],
  statusOf: (date: string) => string | undefined,
  width: number,
  rowHeight: number,
  inset: number,
): DayEdge[] {
  if (width <= 0) return [];
  const cell = width / 7;
  const edges: DayEdge[] = [];
  grid.forEach((date, i) => {
    const status = date ? statusOf(date) : undefined;
    if (!date || !status || status === "no_limit") return;
    edges.push({
      date,
      x: (i % 7) * cell + inset,
      y: Math.floor(i / 7) * rowHeight + inset,
      width: cell - inset * 2,
      height: rowHeight - inset * 2,
      today: status === "today",
    });
  });
  return edges;
}
