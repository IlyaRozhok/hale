import type { CalendarDayDto, TodayDto } from "@hale/contracts";
import { dayMonth, formatMoney, pluralIndex, shiftDate } from "./format";

type Payment = TodayDto["upcoming"][number];

export type PhraseAction = { kind: "bridge" } | { kind: "questions" } | { kind: "calendar" } | { kind: "loans" } | { kind: "pay"; payment: Payment };
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
  streak: number;
}

const date = (iso: string) => {
  const { day, month } = dayMonth(iso);
  return `${day} ${month}`;
};

/**
 * The one thing worth saying today, the most important first: a decision that is waiting, an overdue
 * payment, a loan to return, then a payment at the door, then how yesterday went. Null on a day with nothing to say.
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

  const tomorrow = shiftDate(i.today, 1);
  const soon = byDate.find((p) => p.dueOn <= tomorrow);
  if (soon) {
    const when = soon.dueOn === i.today ? "Сегодня" : "Завтра";
    return { text: `${when} платёж: ${soon.name}, ${formatMoney(soon.amount)}. Он уже учтён в лимите.`, action: { kind: "pay", payment: soon } };
  }

  const y = i.yesterday;
  if (!y || y.limit === null || y.date !== shiftDate(i.today, -1)) return null;
  const left = y.limit - y.spent;
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
