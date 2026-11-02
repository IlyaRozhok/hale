/** Which incoming rows may be USDC coming back from Binance, and so would count twice until answered. */

/** ₴1,000: smaller credits are not worth a question. */
export const USDC_MATCH_MIN_UAH = 100_000;
export const MAX_USDC_MATCH_QUESTIONS = 3;

export interface UsdcMatchRow {
  id: number;
  type: string | null;
  accountKind: string;
  /** Signed kopecks; null when no rate was known. */
  amountUah: number | null;
  /** YYYY-MM-DD. */
  localDate: string;
  usdcChecked: boolean;
}

export interface UsdcMatchInput {
  rows: readonly UsdcMatchRow[];
  /** Cents on the Binance balance. */
  binanceBalance: number;
  /** The latest received USDC event, YYYY-MM; null when none was received. */
  receivedPeriod: string | null;
  trackingStart: string;
}

const isIncomingKind = (r: UsdcMatchRow) =>
  (r.type === "cash_in" && r.accountKind !== "jar") ||
  (r.type === "person_in" && (r.accountKind === "black" || r.accountKind === "white"));

/**
 * The rows to ask about, oldest first and at most three. Nothing is asked unless money is on Binance
 * and a USDC income was received. Rows from before that income's month, or before tracking began,
 * are history: they cannot be this money.
 */
export function usdcMatchRows(i: UsdcMatchInput): UsdcMatchRow[] {
  if (i.binanceBalance <= 0 || i.receivedPeriod === null) return [];
  const since = `${i.receivedPeriod}-01`;
  return i.rows
    .filter(
      (r) =>
        !r.usdcChecked &&
        isIncomingKind(r) &&
        r.amountUah !== null &&
        r.amountUah >= USDC_MATCH_MIN_UAH &&
        r.localDate >= since &&
        r.localDate >= i.trackingStart,
    )
    .slice(0, MAX_USDC_MATCH_QUESTIONS);
}
