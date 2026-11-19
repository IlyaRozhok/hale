import { describe, expect, it } from "vitest";
import type { CalendarDayDto, CategoryDto, ObservationDto, TodayDto } from "@hale/contracts";
import { dayPhrase, observationRef, observationText } from "./dayPhrase";

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

  it("then a loan whose return date has passed, the oldest one, which opens the loans (Б7)", () => {
    const loansDue = [{ id: 4, amount: 300_000, dueOn: "2026-11-11" }, { id: 3, amount: 500_000, dueOn: "2026-11-09" }];
    expect(dayPhrase(input({ questions: 2, upcoming: [pay({ dueOn: "2026-11-11" })], loansDue }))).toEqual({
      text: "Займ ₴5,000 ждёт возврата с 9 ноя. Отметьте, если уже вернули.",
      action: { kind: "loans" },
    });
  });

  it("then a loan due today, already inside the limit (Б7)", () => {
    expect(dayPhrase(input({ questions: 2, loansDue: [{ id: 3, amount: 500_000, dueOn: "2026-11-11" }] }))).toEqual({
      text: "Сегодня срок вернуть займ ₴5,000. Он уже учтён в лимите.",
      action: { kind: "loans" },
    });
  });

  it("an overdue payment still comes before a loan to return (Б7)", () => {
    const late = pay({ dueOn: "2026-11-06" });
    expect(dayPhrase(input({ upcoming: [late], loansDue: [{ id: 3, amount: 500_000, dueOn: "2026-11-01" }] }))!.action).toEqual({ kind: "pay", payment: late });
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
    // Pins the server contract, no new code: the day the shortage came on arrives without a limit, so it is not said to be over anything.
    expect(dayPhrase(input({ yesterday: yesterday({ limit: null, spent: 259_800, status: "no_limit", shortageStart: true }) }))).toBeNull();
    expect(dayPhrase(input())).toBeNull();
    // Yesterday's figures from another day are not yesterday's.
    expect(dayPhrase(input({ yesterday: yesterday({ date: "2026-11-09" }) }))).toBeNull();
  });

  describe("an observation (В7)", () => {
    const spike = (over: Partial<ObservationDto> = {}): ObservationDto => ({
      kind: "spike", period: "month", category: "cafe", spent: 482_000, usual: 310_000, amount: null, from: "2026-11-01", to: "2026-11-11", ...over,
    });
    const subs: ObservationDto = { kind: "subscriptions", period: null, category: null, spent: null, usual: null, amount: 51_900, from: "2026-11-11", to: "2026-11-17" };

    it("takes the place of yesterday, and opens what it is about", () => {
      const o = spike();
      expect(dayPhrase(input({ yesterday: yesterday(), streak: 5, observation: o }))).toEqual({
        text: "Кафе и рестораны с начала ноября ₴4,820. Обычно к этому дню около ₴3,100.",
        action: { kind: "observation", observation: o },
      });
      // A quiet day with no history says it too.
      expect(dayPhrase(input({ observation: o }))!.action).toEqual({ kind: "observation", observation: o });
    });

    it("comes last: a plan, a payment, a loan or a question is said instead", () => {
      const o = spike();
      expect(dayPhrase(input({ needsPlan: true, observation: o }))!.action.kind).toBe("bridge");
      expect(dayPhrase(input({ upcoming: [pay({ dueOn: "2026-11-06" })], observation: o }))!.action.kind).toBe("pay");
      expect(dayPhrase(input({ loansDue: [{ id: 3, amount: 500_000, dueOn: "2026-11-11" }], observation: o }))!.action.kind).toBe("loans");
      expect(dayPhrase(input({ questions: 1, observation: o }))!.action.kind).toBe("questions");
      expect(dayPhrase(input({ upcoming: [pay({ dueOn: "2026-11-12" })], observation: o }))!.action.kind).toBe("pay");
    });

    it("names the week, the subscriptions and the owner's own category in whole phrases", () => {
      const categories: CategoryDto[] = [{ key: "c_1", name: "Кот", icon: "paw", system: false }];
      expect(observationText(spike({ period: "week", category: "groceries", spent: 214_000, usual: 140_000, from: "2026-11-05" }), undefined, "2026-11-11")).toBe(
        "Продукты за неделю ₴2,140. Обычно около ₴1,400.",
      );
      expect(observationText(spike({ category: "c_1" }), categories, "2026-11-11")).toBe("Кот с начала ноября ₴4,820. Обычно к этому дню около ₴3,100.");
      expect(observationText(subs, undefined, "2026-11-11")).toBe("На этой неделе спишутся подписки: около ₴519.");
      expect(dayPhrase(input({ observation: subs }))!.action).toEqual({ kind: "observation", observation: subs });
    });

    it("never says more, too much or over, and never exclaims", () => {
      for (const o of [spike(), spike({ period: "week" }), subs]) {
        expect(observationText(o, undefined, "2026-11-11")).not.toMatch(/больше|слишком|превыси|!/);
      }
    });

    it("keeps a month's spike to itself in the first three days of the month; a week's is said", () => {
      const early = input({ today: "2026-12-03", yesterday: yesterday({ date: "2026-12-02" }), streak: 2 });
      const month = spike({ from: "2026-12-01", to: "2026-12-03" });
      // Yesterday is said, as on any day without an observation.
      expect(dayPhrase({ ...early, observation: month })!.text).toBe("Вчера осталось ₴340. Уже 2 дня в лимите.");
      expect(observationText(month, undefined, "2026-12-03")).toBeNull();
      expect(observationText(spike({ from: "2026-12-01", to: "2026-12-04" }), undefined, "2026-12-04")).toBe("Кафе и рестораны с начала декабря ₴4,820. Обычно к этому дню около ₴3,100.");
      expect(dayPhrase({ ...early, observation: spike({ period: "week", from: "2026-11-27", to: "2026-12-03" }) })!.text).toBe("Кафе и рестораны за неделю ₴4,820. Обычно около ₴3,100.");
    });

    it("is named to the server by its kind and category", () => {
      expect(observationRef(spike())).toEqual({ kind: "spike", category: "cafe" });
      expect(observationRef(subs)).toEqual({ kind: "subscriptions", category: null });
      expect(observationRef(spike({ category: null }))).toBeNull();
    });

    it("an incomplete observation says nothing", () => {
      expect(observationText(spike({ spent: null }), undefined, "2026-11-11")).toBeNull();
      expect(observationText({ ...subs, amount: null }, undefined, "2026-11-11")).toBeNull();
      expect(dayPhrase(input({ observation: null }))).toBeNull();
    });
  });
});
