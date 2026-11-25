import type { DailyStateDto, RunwayDto } from "@hale/contracts";
import { formatMoney, formatSignedMoney, pluralIndex, shiftDate, shortDate } from "./format";

// Pure: what the sheet «Как посчитан лимит» shows (task ЧЛ4). No native imports.
//
// Nothing here computes the limit. Every figure is the server's: the parts stored with the day's limit
// (`state.parts`), what is spent and left today (`state`), and the runway's own reserve and zero day.

/** Whole phrases, so they can be translated as they are. */
export const LIMIT_SHEET_TITLE = "Как посчитан лимит";
const OWN_MORNING = "Свои деньги на утро";
/** With a confirmed plan the own money is that of the moment the plan was confirmed, not the morning's. */
const OWN = "Свои деньги";
const TAX = "отложено на налоги";
/**
 * Not «платежи»: this sum has the loans with a return date and has no taxes, so it need not equal the header of the
 * «Платежи» section. The second is for a day with no income date ahead.
 */
const DUE = ["платежи и возврат займов до дохода", "платежи и возврат займов за 30 дней"] as const;
const GOAL = "взносы в цели";
const BORROWED = "взято в долг";
const FREE = "свободно";
const SHORT = ["не хватает до дохода", "не хватает на 30 дней"] as const;
/** One per plural form. */
const DAYS = ["Свободное — на {n} день", "Свободное — на {n} дня", "Свободное — на {n} дней"] as const;
const PER_DAY = "по {sum} в день";
const A_DAY = "{sum} в день";
const CELL_TODAY = "сегодня";
const CELL_INCOME = "доход {date}";
const NO_INCOME_DATE = "Дата следующего дохода не указана, поэтому расчёт — на 30 дней.";
const CAP_OWN = "Ваш потолок трат";
const CAP_DEFAULT = "Потолок трат по умолчанию";
const CAP_RESERVE = "Потолок ниже расчёта, поэтому к доходу останется запас {sum}.";
const CAP_DEFAULT_NOTE = "Свой потолок можно задать в настройках, в строке «Сколько тратить в месяц».";
const FLOOR = "Меньше {sum} в день не ставим";
const ABOVE_SHARE = "Лимит выше, чем позволяют свободные деньги: недостающее понадобится к {date}.";
const PLAN = "Свободных денег до дохода нет. Лимит — сумма из плана до дохода.";
const PLAN_ROW = "План до дохода";
const SPENT = "Потрачено сегодня";
const TOTAL = "Сегодня можно";
const NEXT_LIMIT = "Новый лимит {sum} действует с завтра";
const NOTHING_LEFT = "Лимит на сегодня потрачен. Завтра снова {sum}.";

/** More days than this are said in one line, with no cells (the spec's author). */
const MAX_CELLS = 14;

const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

/** A line of the sheet: words on the left, a figure on the right. */
export interface LimitSheetRow {
  label: string;
  value: string;
}

/** What is taken off the own money. `amount` is kopecks above zero; `value` shows it with a minus. */
export interface LimitSheetTerm extends LimitSheetRow {
  key: "tax" | "due" | "goal" | "borrowed";
  amount: number;
}

export interface LimitSheet {
  /** «Свои деньги на утро»; kopecks, may be below zero. */
  own: LimitSheetRow & { amount: number };
  /** Zeros are left out. */
  terms: LimitSheetTerm[];
  /** What is left of the own money: «свободно», or how much is missing as a figure above zero. `amount` is `parts.free`. */
  free: LimitSheetRow & { amount: number; short: boolean };
  /** Whether the terms and the free money are drawn as shares of one bar: only when they are parts of a whole. */
  bar: boolean;
  /**
   * «Свободное — на 10 дней» and «по ₴2,520 в день». `cells` is how many day cells stand under it, today's the first;
   * null when there are too many days for cells. `end` is the caption under the last cell.
   */
  days: (LimitSheetRow & { cells: number | null; start: string; end: string | null; note: string | null }) | null;
  /**
   * The rule that gave the limit when it is not the share itself. `value` null: the label is a whole line.
   * `plan`: the line leads to the plan until the income; `text` is then said above it.
   */
  rule: { label: string; value: string | null; text: string | null; plan: boolean } | null;
  spent: LimitSheetRow & { amount: number };
  /** The figure of the screen: what is left today, never below zero. */
  total: LimitSheetRow & { amount: number };
  /** Quiet phrases under the total. */
  notes: string[];
}

type Runway = Pick<RunwayDto, "reserve" | "zeroOn" | "incomeOn">;

/**
 * The sheet for a day's state, or null when there is nothing to explain the figure with: an older server or a day
 * fixed before the parts were stored (no `state.parts`), a day with no limit, or parts that do not add up to the
 * figure on the screen (the contract says they always do; a sheet about money never shows a sum that does not hold).
 *
 * `runway` is the screen's own (`TodayDto.runway`), null from a server without it; `today` is the Kyiv day.
 */
export function limitSheet(state: DailyStateDto, runway: Runway | null, today: string): LimitSheet | null {
  const p = state.parts;
  if (!p || state.dailyLimit <= 0) return null;
  if (p.dailyLimit !== state.dailyLimit) return null;
  if (p.own - p.taxReserve - p.obligationsDue - p.goalDue - p.borrowed !== p.free) return null;
  if (p.rule === "share" && p.share !== p.dailyLimit) return null;

  const horizon = p.noIncomeDate ? 1 : 0;
  const plan = p.rule === "plan";
  const taken: [LimitSheetTerm["key"], string, number][] = [
    ["tax", TAX, p.taxReserve],
    ["due", DUE[horizon], p.obligationsDue],
    ["goal", GOAL, p.goalDue],
    ["borrowed", BORROWED, p.borrowed],
  ];
  const terms = taken.filter(([, , amount]) => amount !== 0).map(([key, label, amount]) => ({ key, label, amount, value: formatSignedMoney(-amount) }));
  const short = p.free < 0;
  const limit = formatMoney(p.dailyLimit);

  let days: LimitSheet["days"] = null;
  if (!plan && p.free > 0) {
    // The income's day under the last cell, only while the runway still looks at the same income as the stored days.
    const incomeOn = !p.noIncomeDate && runway?.incomeOn && runway.incomeOn === shiftDate(today, p.daysLeft) ? runway.incomeOn : null;
    days = {
      label: fill(DAYS[pluralIndex(p.daysLeft)], { n: String(p.daysLeft) }),
      value: fill(PER_DAY, { sum: formatMoney(p.share) }),
      cells: p.daysLeft <= MAX_CELLS ? p.daysLeft : null,
      start: CELL_TODAY,
      end: incomeOn ? fill(CELL_INCOME, { date: shortDate(incomeOn, today) }) : null,
      note: p.noIncomeDate ? NO_INCOME_DATE : null,
    };
  }

  let rule: LimitSheet["rule"] = null;
  if (p.rule === "cap") rule = { label: p.capDefault ? CAP_DEFAULT : CAP_OWN, value: fill(A_DAY, { sum: limit }), text: null, plan: false };
  else if (p.rule === "floor") rule = { label: fill(FLOOR, { sum: limit }), value: null, text: null, plan: false };
  else if (plan) rule = { label: PLAN_ROW, value: fill(A_DAY, { sum: limit }), text: PLAN, plan: true };

  const notes: string[] = [];
  const nextLimit = state.shortageStart?.nextLimit;
  if (nextLimit !== undefined) notes.push(fill(NEXT_LIMIT, { sum: formatMoney(nextLimit) }));
  else if (state.leftToday < 0) notes.push(fill(NOTHING_LEFT, { sum: limit }));
  if (p.rule === "cap" && p.share > p.dailyLimit) {
    // The cap is below the share: what is not spent stays. The figure is the runway's own, not a second computation.
    if (runway && runway.incomeOn && !p.noIncomeDate && runway.reserve > 0) notes.push(fill(CAP_RESERVE, { sum: formatMoney(runway.reserve) }));
  } else if ((p.rule === "cap" || p.rule === "floor") && p.share < p.dailyLimit) {
    // The limit is above the share (the recommended sum, or a cap between the two): nothing is left over.
    if (runway?.zeroOn && runway.zeroOn > today) notes.push(fill(ABOVE_SHARE, { date: shortDate(runway.zeroOn, today) }));
  }
  if (p.rule === "cap" && p.capDefault) notes.push(CAP_DEFAULT_NOTE);

  const spent = state.dailyLimit - state.leftToday;
  const total = Math.max(0, state.leftToday);
  return {
    own: { label: plan ? OWN : OWN_MORNING, amount: p.own, value: formatMoney(p.own) },
    terms,
    free: { label: short ? SHORT[horizon] : FREE, amount: p.free, value: formatMoney(Math.abs(p.free)), short },
    bar: !plan && p.free > 0 && terms.every((t) => t.amount > 0),
    days,
    rule,
    spent: { label: SPENT, amount: spent, value: formatSignedMoney(-spent) },
    total: { label: TOTAL, amount: total, value: formatMoney(total) },
    notes,
  };
}
