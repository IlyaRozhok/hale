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
  /** The row has an exact opposite on another account within the window (exactPartnerSql). */
  exactPartner: boolean;
  /** Someone else is on the other side of the row (hasThirdParty in classify.ts). */
  thirdParty: boolean;
}

const hryvnia = (l: PairLeg): number | null => (l.currency === "UAH" ? l.amount : l.amountUah);

/** Whether a row may be one leg of an exchange: it is not already paired, not someone else's money, not fop income. */
const exchangeLeg = (l: PairLeg): boolean =>
  !NOT_EXCHANGE_KINDS.has(l.accountKind) && !(l.accountKind === "fop" && l.amount > 0) && !l.exactPartner && !l.thirdParty;

/**
 * Whether two rows are the two legs of one move between the owner's own accounts (Б10). Different
 * accounts, within the window, no one else on the other side of either row, and either the exact
 * opposite amount (whatever the accounts), or an exchange: different currencies, opposite signs,
 * hryvnia amounts no more than 3% apart (the bank's buy/sell spread), and both rows fit to be an
 * exchange leg. Money coming in on the fop account is income; a row with its exact other leg
 * already belongs to that move. A row with someone else on the other side is not between own
 * accounts, however exactly its sum matches (Б32: ₴500 sent to one person and ₴500 from another
 * three minutes later are two people, not one move).
 */
export function isOwnPair(a: PairLeg, b: PairLeg): boolean {
  if (a.accountId === b.accountId || Math.abs(a.at - b.at) > OWN_PAIR_WINDOW_MS) return false;
  if (a.thirdParty || b.thirdParty) return false;
  if (a.amount === -b.amount) return true;
  if (a.currency === b.currency || !exchangeLeg(a) || !exchangeLeg(b)) return false;
  const ua = hryvnia(a);
  const ub = hryvnia(b);
  if (ua === null || ub === null || Math.sign(ua) !== -Math.sign(ub) || ua === 0) return false;
  const big = Math.max(Math.abs(ua), Math.abs(ub));
  return Math.abs(Math.abs(ua) - Math.abs(ub)) * 100 <= OWN_PAIR_FX_PERCENT * big;
}

const windowSql = `interval '${OWN_PAIR_WINDOW_S} seconds'`;

/** SQL: the transaction `x` has an exact opposite on another account within the window (PairLeg.exactPartner). */
export const exactPartnerSql = (x: string): string =>
  `EXISTS (SELECT 1 FROM transactions ${x}_x WHERE ${x}_x.account_id <> ${x}.account_id AND ${x}_x.amount = -${x}.amount
     AND ${x}_x.occurred_at BETWEEN ${x}.occurred_at - ${windowSql} AND ${x}.occurred_at + ${windowSql})`;

/**
 * isOwnPair as a SQL condition, for queries that must decide inside the database: `t` and `o` are
 * transactions, `ta` and `oa` their accounts. One part cannot be read in SQL: whether someone else is
 * on the other side needs the owner's names. The stored type stands in for it, for the exact rule and
 * the exchange alike: both rows must be own_transfer, which classification gives a pair only through
 * isOwnPair with that part checked (Б32: money to one person and the same sum from another stay
 * person_transfer and person_in, so they are no pair here either). reclassify.service.test.ts checks
 * the two agree once rows are classified.
 */
export function ownPairSql(t: string, ta: string, o: string, oa: string): string {
  const uah = (x: string, xa: string) => `(CASE WHEN ${xa}.currency = 'UAH' THEN ${x}.amount ELSE ${x}.amount_uah END)`;
  const ut = uah(t, ta);
  const uo = uah(o, oa);
  const kinds = [...NOT_EXCHANGE_KINDS].map((k) => `'${k}'`).join(",");
  const leg = (x: string, xa: string) =>
    `${xa}.kind NOT IN (${kinds}) AND NOT (${xa}.kind = 'fop' AND ${x}.amount > 0) AND NOT ${exactPartnerSql(x)}`;
  return `(${o}.account_id <> ${t}.account_id
    AND ${o}.occurred_at BETWEEN ${t}.occurred_at - ${windowSql} AND ${t}.occurred_at + ${windowSql}
    AND ${t}.type = 'own_transfer' AND ${o}.type = 'own_transfer'
    AND (${o}.amount = -${t}.amount
      OR (${oa}.currency <> ${ta}.currency AND ${leg(t, ta)} AND ${leg(o, oa)}
          AND ${ut} <> 0 AND sign(${uo}) = -sign(${ut})
          AND abs(abs(${ut}) - abs(${uo})) * 100 <= ${OWN_PAIR_FX_PERCENT} * greatest(abs(${ut}), abs(${uo})))))`;
}
