/** Seconds within which the other leg of a transfer between the owner's accounts arrives. */
export const OWN_PAIR_WINDOW_S = 600;
export const OWN_PAIR_WINDOW_MS = OWN_PAIR_WINDOW_S * 1000;
/** How far apart, in percent of the larger, the hryvnia amounts of an exchange between own accounts may be. */
export const OWN_PAIR_FX_PERCENT = 3;

/** Kinds that never take part in an exchange between currencies: jars hold hryvnia, the wallet has no statement. */
const NOT_EXCHANGE_KINDS: ReadonlySet<string> = new Set(["jar", "cash"]);

export interface PairLeg {
  accountId: number;
  accountKind: string;
  currency: string;
  /** Epoch milliseconds. */
  at: number;
  /** Signed minor units of the account's currency. */
  amount: number;
  /** Signed kopecks at the day's rate; null when no rate was known. */
  amountUah: number | null;
}

const hryvnia = (l: PairLeg): number | null => (l.currency === "UAH" ? l.amount : l.amountUah);

/**
 * Whether two rows are the two legs of one move between the owner's own accounts (Б10). Different
 * accounts, within the window, and either the exact opposite amount (as before, whatever the
 * accounts), or an exchange: different currencies on the owner's accounts, opposite signs, and
 * hryvnia amounts no more than 3% apart (the bank's buy/sell spread).
 */
export function isOwnPair(a: PairLeg, b: PairLeg): boolean {
  if (a.accountId === b.accountId || Math.abs(a.at - b.at) > OWN_PAIR_WINDOW_MS) return false;
  if (a.amount === -b.amount) return true;
  if (a.currency === b.currency || NOT_EXCHANGE_KINDS.has(a.accountKind) || NOT_EXCHANGE_KINDS.has(b.accountKind)) return false;
  const ua = hryvnia(a);
  const ub = hryvnia(b);
  if (ua === null || ub === null || Math.sign(ua) !== -Math.sign(ub) || ua === 0) return false;
  const big = Math.max(Math.abs(ua), Math.abs(ub));
  return Math.abs(Math.abs(ua) - Math.abs(ub)) * 100 <= OWN_PAIR_FX_PERCENT * big;
}

/**
 * isOwnPair as a SQL condition, for queries that must decide inside the database: `t` and `o` are
 * transactions, `ta` and `oa` their accounts. The two must agree (reclassify.service.test.ts checks).
 */
export function ownPairSql(t: string, ta: string, o: string, oa: string): string {
  const uah = (x: string, xa: string) => `(CASE WHEN ${xa}.currency = 'UAH' THEN ${x}.amount ELSE ${x}.amount_uah END)`;
  const ut = uah(t, ta);
  const uo = uah(o, oa);
  const kinds = [...NOT_EXCHANGE_KINDS].map((k) => `'${k}'`).join(",");
  const window = `interval '${OWN_PAIR_WINDOW_S} seconds'`;
  return `(${o}.account_id <> ${t}.account_id
    AND ${o}.occurred_at BETWEEN ${t}.occurred_at - ${window} AND ${t}.occurred_at + ${window}
    AND (${o}.amount = -${t}.amount
      OR (${oa}.currency <> ${ta}.currency AND ${ta}.kind NOT IN (${kinds}) AND ${oa}.kind NOT IN (${kinds})
          AND ${ut} <> 0 AND sign(${uo}) = -sign(${ut})
          AND abs(abs(${ut}) - abs(${uo})) * 100 <= ${OWN_PAIR_FX_PERCENT} * greatest(abs(${ut}), abs(${uo})))))`;
}
