import { describe, expect, it } from "vitest";
import type { CalendarDayDto, TodayDto } from "@hale/contracts";
import { dayPhrase } from "./dayPhrase";

type In = Parameters<typeof dayPhrase>[0];
const pay = (over: Partial<TodayDto["upcoming"][number]> = {}) => ({ id: "1", name: "Квартплата", amount: 1_700_000, dueOn: "2026-11-20", kind: "obligation", currency: "UAH", ...over });
const yesterday = (over: Partial<CalendarDayDto> = {}): CalendarDayDto => ({ date: "2026-11-10", limit: 200_000, spent: 166_000, status: "within", ...over });
const input = (over: Partial<In> = {}): In => ({ today: "2026-11-11", dailyLimit: 200_000, needsPlan: false, questions: 0, upcoming: [], yesterday: null, streak: 0, ...over });

describe("dayPhrase", () => {
  it("first asks for a plan when the money does not reach the income", () => {
    expect(dayPhrase(input({ needsPlan: true, questions: 2, upcoming: [pay({ dueOn: "2026-11-01" })] }))).toEqual({
      text: "Нужен план до дохода. Это пара минут: выберите сумму на день.",
      action: { kind: "bridge" },
    });
  });

  it("then an overdue payment, the oldest one", () => {
    const late = pay({ id: "7", dueOn: "2026-11-06" });
    expect(dayPhrase(input({ questions: 1, upcoming: [late, pay({ id: "8", dueOn: "2026-11-08" })] }))).toEqual({
      text: "Квартплата ждёт с 6 ноя. Отметьте, если уже оплачено.",
      action: { kind: "pay", payment: late },
    });
  });

  it("then questions, in the right word form", () => {
    expect(dayPhrase(input({ questions: 1 }))!.text).toBe("1 вопрос ждёт ответа. Это пять секунд, и лимит станет точнее.");
    expect(dayPhrase(input({ questions: 3 }))!.text).toBe("3 вопроса ждут ответа. Это пять секунд, и лимит станет точнее.");
    expect(dayPhrase(input({ questions: 5 }))).toEqual({ text: "5 вопросов ждут ответа. Это пять секунд, и лимит станет точнее.", action: { kind: "questions" } });
  });

  it("then a payment due today or tomorrow, already inside the limit", () => {
    const soon = pay({ dueOn: "2026-11-12" });
    expect(dayPhrase(input({ upcoming: [soon], yesterday: yesterday() }))).toEqual({
      text: "Завтра платёж: Квартплата, ₴17,000. Он уже учтён в лимите.",
      action: { kind: "pay", payment: soon },
    });
    expect(dayPhrase(input({ upcoming: [pay({ dueOn: "2026-11-11" })] }))!.text).toBe("Сегодня платёж: Квартплата, ₴17,000. Он уже учтён в лимите.");
    // Two days away is not news yet.
    expect(dayPhrase(input({ upcoming: [pay({ dueOn: "2026-11-13" })] }))).toBeNull();
  });

  it("then how yesterday went: what was left, and that the limit grew or the streak goes on", () => {
    expect(dayPhrase(input({ yesterday: yesterday(), dailyLimit: 204_000 }))).toEqual({
      text: "Вчера осталось ₴340. Лимит сегодня на ₴40 больше.",
      action: { kind: "calendar" },
    });
    expect(dayPhrase(input({ yesterday: yesterday(), streak: 5 }))!.text).toBe("Вчера осталось ₴340. Уже 5 дней в лимите.");
    expect(dayPhrase(input({ yesterday: yesterday(), streak: 1 }))!.text).toBe("Вчера осталось ₴340.");
    expect(dayPhrase(input({ yesterday: yesterday({ spent: 200_000 }), streak: 2 }))!.text).toBe("Вчера ровно в лимит. Уже 2 дня в лимите.");
  });

  it("an overspent yesterday is said calmly", () => {
    expect(dayPhrase(input({ yesterday: yesterday({ spent: 259_800, status: "over" }), streak: 0 }))).toEqual({
      text: "Вчера вышло на ₴598 больше лимита. Сегодня новый день.",
      action: { kind: "calendar" },
    });
  });

  it("a day with no limit says nothing, and neither does a quiet day with no history", () => {
    expect(dayPhrase(input({ yesterday: yesterday({ limit: null, status: "no_limit" }) }))).toBeNull();
    // The day the shortage came on arrives without a limit: it is not said to be over anything.
    expect(dayPhrase(input({ yesterday: yesterday({ limit: null, spent: 259_800, status: "no_limit", shortageStart: true }) }))).toBeNull();
    expect(dayPhrase(input())).toBeNull();
    // Yesterday's figures from another day are not yesterday's.
    expect(dayPhrase(input({ yesterday: yesterday({ date: "2026-11-09" }) }))).toBeNull();
  });
});
