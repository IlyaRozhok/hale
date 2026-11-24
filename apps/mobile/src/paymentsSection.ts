import type { RunwayDto, TodayDto } from "@hale/contracts";
import { dueWords, formatMoney, shiftDate } from "./format";

// Pure: which payments the «Платежи» section of «Сегодня» shows and what it says. No native imports.

/** How many payments are rows; the rest are counted in «Ещё N · ₴сумма». */
const SHOWN = 3;

/** Whole phrases, so they can be translated as they are. */
const CAPTION = "{n} до дохода · {sum}";
const MORE = "Ещё {n} · {sum}";

export interface PaymentRow {
  id: string;
  name: string;
  /** Kopecks, already in hryvnias. */
  amount: number;
  /** The day the payment is really due: an overdue one keeps its past day, though the chart puts it on today. */
  dueOn: string;
  /** «сегодня», «завтра», «через 4 дня», «ждёт с 6 ноя». */
  due: string;
  /** Due today or tomorrow, or already waiting: the words are sand. */
  soon: boolean;
  /** `upcoming` lists it, so «Оплачено» can be opened for it. */
  payable: boolean;
}

export interface PaymentsSection {
  /** «3 до дохода · ₴21,800», over every payment of the stretch, not only the rows. */
  caption: string;
  rows: PaymentRow[];
  /** «Ещё 2 · ₴3,500»: the payments that are not rows; null when all of them are. */
  more: { text: string } | null;
}

const sum = (amounts: { amount: number }[]) => amounts.reduce((total, a) => total + a.amount, 0);

/**
 * The «Платежи» section (task ЧЛ6). The payments are the runway's (`runway.events`): unpaid, up to the income, no
 * taxes, the same ones the chart draws. The day each is really due comes from `upcoming` by `id`, because the runway
 * puts an overdue payment on today; one `upcoming` does not list keeps the runway's day.
 *
 * Null, and so no section, without a runway (an older server), without an income date and without payments.
 * The order is by the real due day, so overdue ones come first, the oldest first; equal days keep the server's order.
 */
export function paymentsSection(runway: RunwayDto | null | undefined, upcoming: TodayDto["upcoming"], today: string): PaymentsSection | null {
  if (!runway || !runway.incomeOn || runway.events.length === 0) return null;
  const real = new Map(upcoming.map((p) => [p.id, p.dueOn]));
  const tomorrow = shiftDate(today, 1);
  const all: PaymentRow[] = runway.events
    .map((e) => {
      const dueOn = real.get(e.id) ?? e.date;
      return { id: e.id, name: e.name, amount: e.amount, dueOn, due: dueWords(dueOn, today), soon: dueOn <= tomorrow, payable: real.has(e.id) };
    })
    // ISO dates compare as text; the sort is stable.
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const rest = all.slice(SHOWN);
  return {
    caption: CAPTION.replace("{n}", String(all.length)).replace("{sum}", formatMoney(sum(all))),
    rows: all.slice(0, SHOWN),
    more: rest.length > 0 ? { text: MORE.replace("{n}", String(rest.length)).replace("{sum}", formatMoney(sum(rest))) } : null,
  };
}
