import type { CalendarDayDto, ObservationDto, ObservationRef, TodayDto } from "@hale/contracts";
import { dayMonth, dayMonthLong, formatMoney, pluralIndex, shiftDate } from "./format";
import { categoryName, type CategoryList } from "./labels";

type Payment = TodayDto["upcoming"][number];

export type PhraseAction =
  | { kind: "bridge" }
  | { kind: "questions" }
  | { kind: "calendar" }
  | { kind: "loans" }
  | { kind: "pay"; payment: Payment }
  | { kind: "observation"; observation: ObservationDto };
export interface Phrase {
  text: string;
  action: PhraseAction;
}

export interface PhraseInput {
  today: string;
  dailyLimit: number;
  /** The money does not reach the income and no plan is confirmed yet. */
  needsPlan: boolean;
  questions: number;
  upcoming: Payment[];
  /** Loans whose return date is today or past; absent from an older server. */
  loansDue?: NonNullable<TodayDto["loansDue"]>;
  yesterday: CalendarDayDto | null;
  /** The day before yesterday (task А24), for a step closer to the limit; absent when it is not loaded. */
  dayBefore?: CalendarDayDto | null;
  streak: number;
  /** Today's observation from the server (task В7); absent from an older server. */
  observation?: ObservationDto | null;
  /** For the observation's category name. */
  categories?: CategoryList;
  /**
   * Task Я2: the screen already carries bad news (the pace line, or the day over its limit), so the observation,
   * a third piece of it, is not said: one thought a day.
   */
  quiet?: boolean;
}

const date = (iso: string) => {
  const { day, month } = dayMonth(iso);
  return `${day} ${month}`;
};

/** Which observation it is, as the server is told it was shown or dismissed; null for an incomplete spike. */
export function observationRef(o: ObservationDto): ObservationRef | null {
  if (o.kind === "subscriptions") return { kind: "subscriptions", category: null };
  return o.category === null ? null : { kind: "spike", category: o.category };
}

/** A month's spike right after the 1st («с начала декабря» on the 2nd) reads oddly: it waits until the 4th. */
const EARLY_MONTH_DAYS = 3;

/**
 * The observation as a whole phrase (task В7): what was spent and what is usual, never «больше» or «слишком».
 * Null when there is nothing to say well: a month's spike in the first days of the month, or missing figures.
 */
export function observationText(o: ObservationDto, categories: CategoryList, today: string): string | null {
  if (o.kind === "subscriptions") return o.amount === null ? null : `На этой неделе спишутся подписки: около ${formatMoney(o.amount)}.`;
  if (o.category === null || o.spent === null || o.usual === null) return null;
  const name = categoryName(o.category, categories);
  if (o.period === "week") return `${name} за неделю ${formatMoney(o.spent)}. Обычно около ${formatMoney(o.usual)}.`;
  if (Number(today.slice(8, 10)) <= EARLY_MONTH_DAYS) return null;
  // The month in the genitive, «ноября», from the span's first day.
  const month = dayMonthLong(o.from).split(" ")[1];
  return `${name} с начала ${month} ${formatMoney(o.spent)}. Обычно к этому дню около ${formatMoney(o.usual)}.`;
}

/**
 * The one thing worth saying today, the most important first: a decision that is waiting, an overdue
 * payment, a loan to return, the questions, then an observation (В7) in its place unless the day is `quiet`, else
 * how yesterday went. Null on a day with nothing to say. A payment due today or tomorrow is not said here since
 * ЧЛ6: the «Платежи» section of «Сегодня» says it.
 */
export function dayPhrase(i: PhraseInput): Phrase | null {
  if (i.needsPlan) return { text: "Нужен план до дохода. Это пара минут: выберите сумму на день.", action: { kind: "bridge" } };

  const byDate = [...i.upcoming].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const late = byDate.find((p) => p.dueOn < i.today);
  if (late) return { text: `${late.name} ждёт с ${date(late.dueOn)}. Отметьте, если уже оплачено.`, action: { kind: "pay", payment: late } };

  const loan = [...(i.loansDue ?? [])].sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  if (loan) {
    const text =
      loan.dueOn < i.today
        ? `Займ ${formatMoney(loan.amount)} ждёт возврата с ${date(loan.dueOn)}. Отметьте, если уже вернули.`
        : `Сегодня срок вернуть займ ${formatMoney(loan.amount)}. Он уже учтён в лимите.`;
    return { text, action: { kind: "loans" } };
  }

  if (i.questions > 0) {
    const words = ["вопрос ждёт", "вопроса ждут", "вопросов ждут"][pluralIndex(i.questions)];
    return { text: `${i.questions} ${words} ответа. Это пять секунд, и лимит станет точнее.`, action: { kind: "questions" } };
  }

  const o = i.quiet ? null : i.observation;
  const noticed = o ? observationText(o, i.categories, i.today) : null;
  if (o && noticed) return { text: noticed, action: { kind: "observation", observation: o } };

  const y = i.yesterday;
  if (!y || y.limit === null || y.date !== shiftDate(i.today, -1)) return null;
  const left = y.limit - y.spent;
  if (left < 0 && closerThanDayBefore(y, i.dayBefore ?? null, i.today)) {
    return { text: "Вчера — ближе к лимиту, чем позавчера.", action: { kind: "calendar" } };
  }
  if (left < 0) return { text: `Вчера вышло на ${formatMoney(-left)} больше лимита. Сегодня новый день.`, action: { kind: "calendar" } };
  const first = left === 0 ? "Вчера ровно в лимит." : `Вчера осталось ${formatMoney(left)}.`;
  const grew = i.dailyLimit - y.limit;
  const second =
    grew >= 100
      ? ` Лимит сегодня на ${formatMoney(grew)} больше.`
      : i.streak >= 2
        ? ` Уже ${i.streak} ${["день", "дня", "дней"][pluralIndex(i.streak)]} в лимите.`
        : "";
  return { text: first + second, action: { kind: "calendar" } };
}

/** A day the server judged against a limit: not a day without one, and not the day the shortage mode came on. */
const judged = (d: CalendarDayDto) => d.status !== "no_limit" && d.limit !== null && !d.shortageStart;

/**
 * Task А24: yesterday went over its limit by less than the day before went over its own. Each day is set against
 * its own limit, so a day before within the limit is never «further».
 */
function closerThanDayBefore(y: CalendarDayDto, d: CalendarDayDto | null, today: string): boolean {
  if (!d || d.date !== shiftDate(today, -2) || !judged(y) || !judged(d)) return false;
  return y.spent - y.limit! < d.spent - d.limit!;
}
