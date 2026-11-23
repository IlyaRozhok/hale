// Pure: runs in node tests.
import type { AccountPatch, GoalDto, GoalPlace, OwnMoneyItemDto } from "@hale/contracts";
import type { IconName } from "./components/Icon";
import { formatDollars, formatMoney, formatOriginal } from "./format";
import { accountLabel } from "./labels";

/** The glyph of a place of money in a list: the wallet, Binance, a balance kept by hand, or a card. */
export function placeIcon(item: OwnMoneyItemDto): IconName {
  if (item.kind === "cash") return "cash";
  if (item.kind === "binance") return "coin";
  return item.source === "manual" || item.kind === "manual" ? "lock" : "card";
}

/**
 * The window a place of money opens (Д2б): the wallet and Binance their own ones, a bank account or a balance kept by
 * hand the account window. A newer server says where a place is kept and its id; without them (an older server) a card
 * opens nothing, as before.
 */
export function placeOpens(item: OwnMoneyItemDto): "cash" | "binance" | "account" | "manual" | null {
  if (item.kind === "cash") return "cash";
  if (item.kind === "binance") return "binance";
  if (item.id === undefined) return null;
  return item.source === "account" ? "account" : item.source === "manual" ? "manual" : null;
}

/** A bank account goes by the person's name for it (a newer server sends it); an older server's card by its kind. */
export function placeName(item: OwnMoneyItemDto): string {
  return item.source === "account" ? item.name : (accountLabel(item.kind) ?? item.name);
}

/**
 * What the account window sends for a bank account: only what changed; a cleared name gives the default one back.
 * Null when nothing changed.
 */
export function accountPatchOf(item: OwnMoneyItemDto, name: string, countsAsOwn: boolean): AccountPatch | null {
  const patch: AccountPatch = {};
  const title = name.trim();
  if (title !== item.name) patch.name = title === "" ? null : title;
  if (countsAsOwn !== (item.countsAsOwn ?? true)) patch.countsAsOwn = countsAsOwn;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** A set-aside place: a balance kept by hand in its own currency (hryvnias and dollars whole), a bank account in hryvnias. */
export function setAsideDetail(item: OwnMoneyItemDto): string {
  if (item.source !== "manual" || item.amount === undefined || !item.currency) return formatMoney(item.own);
  if (item.currency === "UAH") return formatMoney(item.amount);
  return item.currency === "USD" ? formatDollars(item.amount) : formatOriginal(item.amount, item.currency);
}

/** The total on the «Отложено» row: the set-aside places in hryvnias; nothing when there are none or the server does not say. */
export function setAsideTotal(setAside: readonly OwnMoneyItemDto[] | undefined): string | undefined {
  if (!setAside || setAside.length === 0) return undefined;
  return formatMoney(setAside.reduce((s, i) => s + i.own, 0));
}

/** A quiet line under a place: what a card in credit stands for, or a hand-kept balance in its own currency. */
export function placeNote(item: OwnMoneyItemDto): string | null {
  if (item.own < 0 && item.creditLimit) {
    return item.own <= -item.creditLimit ? "кредитный лимит потрачен весь" : `потрачено из кредитного лимита ${formatMoney(item.creditLimit)}`;
  }
  if (item.amount !== undefined && item.currency && item.currency !== "UAH") {
    return item.currency === "USD" ? formatDollars(item.amount) : formatOriginal(item.amount, item.currency);
  }
  return null;
}

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

/** Money of a goal in its own currency, whole (ЯМ5); dollars when an older server does not say. */
export function goalMoney(minor: number, currency: string | undefined): string {
  if (currency === undefined || currency === "USD") return formatDollars(minor);
  if (currency === "UAH") return formatMoney(minor);
  return formatOriginal(Math.round(minor / 100) * 100, currency);
}

/** The line under a goal: «$1,200 из $5,000», and «· на Binance» when it is kept in a place (ЯМ5). */
export function goalDetail(goal: GoalDto): string {
  const of = `${goalMoney(goal.saved_cents, goal.currency)} из ${goalMoney(goal.target_cents, goal.currency)}`;
  return goal.place ? `${of} · на ${goal.place.name}` : of;
}

/** A place a goal can be kept in (ЯМ5, «Где копите?»), with its balance as its row shows it. */
export type GoalPlaceOption = GoalPlace & { name: string; currency: string; balance: string | null; icon: IconName };

/**
 * The places «Где копите?» offers: the bank accounts and balances kept by hand of own money and of «Отложено», each
 * once. Not the wallet (the server takes no goal there), not a card spent into its credit (nothing lies there), and
 * nothing an older server lists without an id.
 */
export function goalPlaces(accounts: { items?: OwnMoneyItemDto[]; setAside?: OwnMoneyItemDto[] } | undefined): GoalPlaceOption[] {
  const out: GoalPlaceOption[] = [];
  for (const item of [...(accounts?.items ?? []), ...(accounts?.setAside ?? [])]) {
    const source = item.source;
    if ((source !== "account" && source !== "manual") || item.id === undefined || item.own < 0) continue;
    if (out.some((p) => p.source === source && p.id === item.id)) continue;
    const currency = item.currency ?? "UAH";
    const balance = item.amount !== undefined ? goalMoney(item.amount, currency) : formatMoney(item.own);
    out.push({ source, id: item.id, name: placeName(item), currency, balance, icon: placeIcon(item) });
  }
  return out;
}
