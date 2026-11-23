import { addDays, kyivDate } from "../domain/money";
import { shortDate } from "../domain/text-format";
import { KYIV_TZ } from "../time/clock";

export type NotificationKind = "tax" | "over_limit" | "bad_case" | "usdc" | "income_date" | "sync_broken";

export interface Notification {
  key: string;
  kind: NotificationKind;
  title: string;
  body: string;
}

export interface TaxPayment {
  id: number;
  name: string;
  /** Kopecks of `currency`. */
  amount: number;
  currency: string;
  dueOn: string;
  paid: boolean;
}

/** Everything `dueNotifications` needs; it reads nothing else, so it can be tested with a fake clock. */
export interface NotifyState {
  /** Tax payments from `scheduled_payments`. */
  taxes: TaxPayment[];
  leftToday: number;
  dailyLimit: number;
  /** Today is the day the shortage mode came on: its spending is not judged by any limit (audit, decision 6.7). */
  shortageStart: boolean;
  badCases: { id: string; text: string }[];
  questions: { id: string; kind: string; text: string }[];
  /** `settings.last_sync_at` as an ISO string. */
  syncedAt: string | null;
  /** Keys already in `notifications_log`. */
  sentKeys: ReadonlySet<string>;
  /** An ordinary (non-tax) notification already went out today (Kyiv). */
  ordinarySentToday: boolean;
}

/** Words that must never appear in a notification (design: calm tone, facts only). */
export const FORBIDDEN_WORDS = ["должен", "плохо", "ошибка", "срочно", "нельзя"];

const REMINDER_HOUR = 10;
const OVER_LIMIT_HOUR = 21;
const SYNC_BROKEN_MS = 24 * 3_600_000;

const kyivHourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: KYIV_TZ,
  hour: "2-digit",
  hourCycle: "h23",
});
const kyivHour = (d: Date): number => Number(kyivHourFormat.format(d));

const group = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const SYMBOL: Record<string, string> = { UAH: "₴", USD: "$", EUR: "€" };
/** Kopecks as "₴12 345" (whole units). */
function money(minor: number, currency = "UAH"): string {
  const sym = SYMBOL[currency];
  const v = group(minor / 100);
  return sym ? `${sym}${v}` : `${v} ${currency}`;
}

function taxNotifications(t: TaxPayment, date: string, hour: number, sent: ReadonlySet<string>): Notification[] {
  if (t.paid || hour < REMINDER_HOUR) return [];
  const sum = money(t.amount, t.currency);
  const due = shortDate(t.dueOn, date);
  const steps: [string, string, string][] = [
    [addDays(t.dueOn, -7), "d7", `${t.name}: ${sum} к уплате до ${due}, через 7 дней.`],
    [addDays(t.dueOn, -1), "d1", `${t.name}: ${sum} к уплате до ${due}, срок завтра.`],
    [t.dueOn, "d0", `${t.name}: ${sum}, срок уплаты сегодня, ${due}.`],
    [addDays(t.dueOn, 1), "over", `${t.name}: ${sum}, срок прошёл ${due}.`],
  ];
  const step = steps.find(([day]) => day === date);
  if (!step) return [];
  const key = `tax:${t.id}:${step[1]}`;
  return sent.has(key) ? [] : [{ key, kind: "tax", title: `Налог: ${t.name}`, body: step[2] }];
}

/**
 * Notifications due at `now`. Tax reminders are not limited. Ordinary candidates come in priority order
 * (bad case, over limit, USDC, income date, broken sync) and the caller sends only the first that gets
 * through, so a failing top item cannot starve the rest. Ordinary ones are held until 10:00 Kyiv and none
 * goes out after one already did today, except over_limit, which keeps the evening to itself and is not sent on the day
 * the shortage came on. A reminder is only due on its own day, so one that was missed is skipped rather than back-filled.
 */
export function dueNotifications(state: NotifyState, now: Date): Notification[] {
  const date = kyivDate(now);
  const hour = kyivHour(now);
  const out: Notification[] = [];
  const fresh = (key: string) => !state.sentKeys.has(key);

  for (const t of state.taxes) out.push(...taxNotifications(t, date, hour, state.sentKeys));
  const ordinary: Notification[] = [];
  if (hour >= REMINDER_HOUR && !state.ordinarySentToday) {
    for (const b of state.badCases) {
      ordinary.push({ key: `bad:${b.id}`, kind: "bad_case", title: "Денежный план", body: b.text });
    }
  }
  if (hour >= OVER_LIMIT_HOUR && state.leftToday < 0 && !state.shortageStart) {
    ordinary.push({
      key: `over_limit:${date}`,
      kind: "over_limit",
      title: "Лимит дня",
      body: `Сегодня потрачено ${money(state.dailyLimit - state.leftToday)} при лимите ${money(state.dailyLimit)}, это на ${money(-state.leftToday)} больше. Завтра лимит пересчитается.`,
    });
  }
  if (hour >= REMINDER_HOUR && !state.ordinarySentToday) {
    for (const q of state.questions) {
      if (q.kind === "usdc_arrived") {
        const eventId = q.id.slice(q.id.indexOf(":") + 1);
        ordinary.push({ key: `usdc:${eventId}:${date}`, kind: "usdc", title: "USDC", body: `${q.text} Подтвердите одним нажатием, и доход попадёт в план.` });
      }
    }
    for (const q of state.questions) {
      if (q.kind === "income_date") {
        ordinary.push({ key: `income_date:${date.slice(0, 7)}`, kind: "income_date", title: "Дата дохода", body: q.text });
      }
    }
    if (state.syncedAt) {
      const at = new Date(state.syncedAt);
      if (now.getTime() - at.getTime() > SYNC_BROKEN_MS) {
        ordinary.push({
          key: `sync_broken:${kyivDate(at)}`,
          kind: "sync_broken",
          title: "Синхронизация с monobank",
          body: `Данные из monobank не обновлялись больше суток, последний раз ${shortDate(kyivDate(at), date)}. Цифры на экране могут отставать.`,
        });
      }
    }
  }
  out.push(...ordinary.filter((n) => fresh(n.key)));
  return out;
}
