import { describe, expect, it } from "vitest";
import type { DailyStateDto, LimitPartsDto } from "@hale/contracts";
import { limitSheet, type LimitSheet } from "./limitSheet";

const TODAY = "2026-11-24";

/** The mockup's morning: ₴53,400 of own money, ₴25,200 free over 9 days, ₴2,800 a day. */
const parts = (over: Partial<LimitPartsDto> = {}): LimitPartsDto => ({
  own: 5_340_000,
  taxReserve: 640_000,
  obligationsDue: 2_180_000,
  goalDue: 0,
  borrowed: 0,
  free: 2_520_000,
  daysLeft: 9,
  share: 280_000,
  rule: "share",
  dailyLimit: 280_000,
  ...over,
});

/** A day's state around its parts: ₴760 spent unless said otherwise. */
const state = (p: LimitPartsDto | undefined, over: Partial<DailyStateDto> = {}): DailyStateDto => {
  const dailyLimit = p?.dailyLimit ?? 280_000;
  return { mode: "normal", daysLeft: 9, free: 2_444_000, dailyLimit, leftToday: dailyLimit - 76_000, level: 0.7, needsIncomeDate: false, bridge: null, parts: p, ...over };
};

const runway = (over: Partial<{ reserve: number; zeroOn: string | null; incomeOn: string | null }> = {}) => ({ reserve: 0, zeroOn: null, incomeOn: "2026-12-03", ...over });

const sheet = (p: LimitPartsDto, over: Partial<DailyStateDto> = {}, r: ReturnType<typeof runway> | null = runway()): LimitSheet => {
  const s = limitSheet(state(p, over), r, TODAY);
  if (!s) throw new Error("no sheet");
  return s;
};

/** What the rows say, top to bottom, as the sheet draws them. */
const rows = (s: LimitSheet): string[] => [
  `${s.own.label} ${s.own.value}`,
  ...s.terms.map((t) => `${t.label} ${t.value}`),
  `${s.free.label} ${s.free.value}`,
  ...(s.days ? [`${s.days.label} ${s.days.value}`] : []),
  ...(s.rule ? [s.rule.value === null ? s.rule.label : `${s.rule.label} ${s.rule.value}`] : []),
  `${s.spent.label} ${s.spent.value}`,
  `${s.total.label} ${s.total.value}`,
];

describe("limitSheet: no sheet", () => {
  it("an older server sends no parts", () => {
    expect(limitSheet(state(undefined), runway(), TODAY)).toBeNull();
  });

  it("a day with no limit", () => {
    expect(limitSheet(state(parts({ rule: "floor", free: 0, share: 0, dailyLimit: 0 })), runway(), TODAY)).toBeNull();
  });

  it("parts that do not give the figure on the screen are not shown at all", () => {
    expect(limitSheet(state(parts(), { dailyLimit: 300_000 }), runway(), TODAY)).toBeNull();
    expect(limitSheet(state(parts({ free: 2_500_000 })), runway(), TODAY)).toBeNull();
    expect(limitSheet(state(parts({ rule: "share", share: 270_000 })), runway(), TODAY)).toBeNull();
  });
});

describe("limitSheet: the terms", () => {
  it("the share as it is: the morning's own money, what is taken off, the days, no rule line", () => {
    const s = sheet(parts());
    expect(rows(s)).toEqual([
      "Свои деньги на утро ₴53,400",
      "отложено на налоги −₴6,400",
      "платежи и возврат займов до дохода −₴21,800",
      "свободно ₴25,200",
      "Свободное — на 9 дней по ₴2,800 в день",
      "Потрачено сегодня −₴760",
      "Сегодня можно ₴2,040",
    ]);
    expect(s.rule).toBeNull();
    expect(s.notes).toEqual([]);
    expect(s.bar).toBe(true);
    expect(s.free.short).toBe(false);
  });

  it("the shown terms add up: own − what is taken off = free", () => {
    for (const p of [parts(), parts({ own: 5_840_000, borrowed: 500_000 }), parts({ own: -300_000, taxReserve: 0, obligationsDue: 200_000, free: -500_000, share: -55_556, rule: "floor", dailyLimit: 45_000 })]) {
      const s = sheet(p);
      expect(s.own.amount - s.terms.reduce((sum, t) => sum + t.amount, 0)).toBe(s.free.amount);
      expect(s.own.amount).toBe(p.own);
      expect(s.free.amount).toBe(p.free);
    }
  });

  it("zero terms are left out: no goals today, no taxes for a person without them", () => {
    const s = sheet(parts({ own: 4_700_000, taxReserve: 0 }));
    expect(s.terms.map((t) => t.key)).toEqual(["due"]);
    expect(rows(s).join("\n")).not.toMatch(/цел|налог|долг/);
  });

  it("every term when there is one, in the order of the computation", () => {
    const s = sheet(parts({ own: 6_140_000, goalDue: 300_000, borrowed: 500_000 }));
    expect(s.terms.map((t) => `${t.label} ${t.value}`)).toEqual([
      "отложено на налоги −₴6,400",
      "платежи и возврат займов до дохода −₴21,800",
      "взносы в цели −₴3,000",
      "взято в долг −₴5,000",
    ]);
  });

  it("the payments line is not called by the name of the «Платежи» section", () => {
    const due = sheet(parts()).terms.find((t) => t.key === "due")!;
    expect(due.label).not.toBe("платежи");
    expect(due.label).not.toBe("платежи до дохода");
    expect(due.label).toMatch(/займ/);
  });

  it("spent and the total come from the state: the limit less what is left, and what is left", () => {
    const s = sheet(parts(), { leftToday: 123_400 });
    expect(s.spent.amount).toBe(280_000 - 123_400);
    expect(s.total.amount).toBe(123_400);
    expect(s.spent.value).toBe("−₴1,566");
    expect(s.total.value).toBe("₴1,234");
  });

  it("nothing spent yet", () => {
    const s = sheet(parts(), { leftToday: 280_000 });
    expect(s.spent.value).toBe("₴0");
    expect(s.total.value).toBe("₴2,800");
  });

  it("an overspent day agrees with the screen: «₴0», and what tomorrow brings", () => {
    const s = sheet(parts(), { leftToday: -60_100, level: 0 });
    expect(s.spent.value).toBe("−₴3,401");
    expect(s.total.amount).toBe(0);
    expect(s.total.value).toBe("₴0");
    expect(s.notes).toEqual(["Лимит на сегодня потрачен. Завтра снова ₴2,800."]);
  });

  it("exactly the limit spent: «₴0» and no phrase, the sum holds", () => {
    const s = sheet(parts(), { leftToday: 0, level: 0 });
    expect(s.total.value).toBe("₴0");
    expect(s.notes).toEqual([]);
  });
});

describe("limitSheet: the days", () => {
  it.each([
    [1, "Свободное — на 1 день"],
    [3, "Свободное — на 3 дня"],
    [9, "Свободное — на 9 дней"],
    [11, "Свободное — на 11 дней"],
    [14, "Свободное — на 14 дней"],
  ])("%i: a cell a day, in a whole phrase", (daysLeft, label) => {
    const share = Math.floor(2_520_000 / daysLeft);
    const s = sheet(parts({ daysLeft, share, dailyLimit: share }));
    expect(s.days).toMatchObject({ label, cells: daysLeft, start: "сегодня", note: null });
  });

  it("names the income's day under the last cell while the runway looks at the same income", () => {
    expect(sheet(parts()).days!.end).toBe("доход 3 дек");
    // The income came after the limit was fixed: the runway already looks at the next one.
    expect(sheet(parts(), {}, runway({ incomeOn: "2026-12-25" })).days!.end).toBeNull();
    expect(sheet(parts(), {}, null).days!.end).toBeNull();
  });

  it("more than 14 days: one line, no cells", () => {
    const s = sheet(parts({ daysLeft: 15, share: 168_000, dailyLimit: 168_000 }), {}, runway({ incomeOn: "2026-12-09" }));
    expect(s.days).toMatchObject({ label: "Свободное — на 15 дней", value: "по ₴1,680 в день", cells: null });
  });

  it("no income date: «на 30 дней» and one phrase why", () => {
    const s = sheet(parts({ daysLeft: 30, share: 84_000, dailyLimit: 84_000, noIncomeDate: true }), {}, runway({ incomeOn: null }));
    expect(s.days).toMatchObject({
      label: "Свободное — на 30 дней",
      value: "по ₴840 в день",
      cells: null,
      end: null,
      note: "Дата следующего дохода не указана, поэтому расчёт — на 30 дней.",
    });
    expect(s.terms.find((t) => t.key === "due")!.label).toBe("платежи и возврат займов за 30 дней");
    expect(rows(s).join("\n")).not.toMatch(/до дохода/);
  });
});

describe("limitSheet: the rule", () => {
  it("the cap below the share: «Ваш потолок трат» and the reserve the runway shows", () => {
    const s = sheet(parts({ rule: "cap", dailyLimit: 200_000 }), {}, runway({ reserve: 520_000 }));
    expect(s.rule).toEqual({ label: "Ваш потолок трат", value: "₴2,000 в день", text: null, plan: false });
    expect(s.notes).toEqual(["Потолок ниже расчёта, поэтому к доходу останется запас ₴5,200."]);
    expect(s.days!.value).toBe("по ₴2,800 в день");
    expect(s.total.value).toBe("₴1,240");
  });

  it("the cap below the share with no reserve to name: no phrase about it", () => {
    for (const r of [runway({ reserve: 0 }), runway({ reserve: -100_000 }), runway({ reserve: 520_000, incomeOn: null }), null]) {
      expect(sheet(parts({ rule: "cap", dailyLimit: 200_000 }), {}, r).notes).toEqual([]);
    }
  });

  it("the cap between the share and the recommended sum: the phrase about a reserve is not shown", () => {
    // ₴1,800 free over 9 days is ₴200 a day; the recommended sum is ₴450, the cap ₴300.
    const p = parts({ own: 3_000_000, free: 180_000, share: 20_000, rule: "cap", dailyLimit: 30_000 });
    const fresh = { leftToday: 30_000 };
    const s = sheet(p, fresh, runway({ reserve: 520_000 }));
    expect(s.rule).toMatchObject({ label: "Ваш потолок трат", value: "₴300 в день" });
    expect(s.notes.join(" ")).not.toMatch(/останется запас/);
    expect(s.notes).toEqual([]);
    // With the runway's zero day the phrase is about what will be missing.
    expect(sheet(p, fresh, runway({ reserve: -90_000, zeroOn: "2026-11-30" })).notes).toEqual([
      "Лимит выше, чем позволяют свободные деньги: недостающее понадобится к 30 ноя.",
    ]);
  });

  it("the default cap is not called «ваш»: it names the setting", () => {
    const s = sheet(parts({ rule: "cap", dailyLimit: 200_000, capDefault: true }), {}, runway({ reserve: 520_000 }));
    expect(s.rule).toMatchObject({ label: "Потолок трат по умолчанию", value: "₴2,000 в день" });
    expect(JSON.stringify(s)).not.toMatch(/ваш потолок/i);
    expect(s.notes).toEqual([
      "Потолок ниже расчёта, поэтому к доходу останется запас ₴5,200.",
      "Свой потолок можно задать в настройках, в строке «Сколько тратить в месяц».",
    ]);
  });

  it("the default cap under another rule is not mentioned", () => {
    expect(sheet(parts({ capDefault: true })).notes).toEqual([]);
  });

  it("the recommended sum above the share: one line, and when the missing money will be needed", () => {
    const p = parts({ own: 3_000_000, free: 180_000, share: 20_000, rule: "floor", dailyLimit: 45_000 });
    const s = sheet(p, { leftToday: 45_000 }, runway({ reserve: -200_000, zeroOn: "2026-11-28" }));
    expect(rows(s)).toEqual([
      "Свои деньги на утро ₴30,000",
      "отложено на налоги −₴6,400",
      "платежи и возврат займов до дохода −₴21,800",
      "свободно ₴1,800",
      "Свободное — на 9 дней по ₴200 в день",
      "Меньше ₴450 в день не ставим",
      "Потрачено сегодня ₴0",
      "Сегодня можно ₴450",
    ]);
    expect(s.notes).toEqual(["Лимит выше, чем позволяют свободные деньги: недостающее понадобится к 28 ноя."]);
    // No zero day ahead on the runway (or no runway): nothing is promised.
    expect(sheet(p, { leftToday: 45_000 }, runway()).notes).toEqual([]);
    expect(sheet(p, { leftToday: 45_000 }, runway({ zeroOn: TODAY })).notes).toEqual([]);
    expect(sheet(p, { leftToday: 45_000 }, null).notes).toEqual([]);
  });

  it("the shortage without a plan: own money and free below zero, said plainly, with no bar and no days", () => {
    const p = parts({ own: -300_000, taxReserve: 0, obligationsDue: 200_000, free: -500_000, share: -55_556, rule: "floor", dailyLimit: 45_000 });
    const s = sheet(p, { mode: "bridge", leftToday: 45_000 }, runway({ reserve: -900_000, zeroOn: "2026-11-25" }));
    expect(rows(s)).toEqual([
      "Свои деньги на утро −₴3,000",
      "платежи и возврат займов до дохода −₴2,000",
      "не хватает до дохода ₴5,000",
      "Меньше ₴450 в день не ставим",
      "Потрачено сегодня ₴0",
      "Сегодня можно ₴450",
    ]);
    expect(s.free.short).toBe(true);
    expect(s.bar).toBe(false);
    expect(s.days).toBeNull();
    expect(s.notes).toEqual(["Лимит выше, чем позволяют свободные деньги: недостающее понадобится к 25 ноя."]);
  });

  it("own money above zero and free below: no bar, the terms are not parts of a whole", () => {
    const s = sheet(parts({ own: 2_000_000, free: -820_000, share: -91_112, rule: "floor", dailyLimit: 45_000 }));
    expect(s.bar).toBe(false);
    expect(s.free).toMatchObject({ label: "не хватает до дохода", value: "₴8,200", short: true });
  });

  it("a confirmed plan: its sum, no «на утро», no bar, no days", () => {
    const p = parts({ own: 2_000_000, free: -820_000, share: -91_112, rule: "plan", dailyLimit: 60_000 });
    const s = sheet(p, { mode: "bridge", leftToday: 50_000 }, runway({ reserve: -900_000, zeroOn: "2026-11-25" }));
    expect(rows(s)).toEqual([
      "Свои деньги ₴20,000",
      "отложено на налоги −₴6,400",
      "платежи и возврат займов до дохода −₴21,800",
      "не хватает до дохода ₴8,200",
      "План до дохода ₴600 в день",
      "Потрачено сегодня −₴100",
      "Сегодня можно ₴500",
    ]);
    expect(s.rule).toMatchObject({ text: "Свободных денег до дохода нет. Лимит — сумма из плана до дохода.", plan: true });
    expect(JSON.stringify(s)).not.toMatch(/на утро/);
    expect(s.bar).toBe(false);
    expect(s.days).toBeNull();
    expect(s.notes).toEqual([]);
  });
});

describe("limitSheet: the day the shortage came on", () => {
  it("shows the morning's computation and the new limit from tomorrow, not an overspent day", () => {
    const s = sheet(parts(), { mode: "bridge", leftToday: -1_000_000, level: 0, shortageStart: { nextLimit: 45_000 } }, runway({ reserve: -900_000, zeroOn: "2026-11-25" }));
    expect(rows(s).slice(0, 5)).toEqual([
      "Свои деньги на утро ₴53,400",
      "отложено на налоги −₴6,400",
      "платежи и возврат займов до дохода −₴21,800",
      "свободно ₴25,200",
      "Свободное — на 9 дней по ₴2,800 в день",
    ]);
    expect(s.total.value).toBe("₴0");
    expect(s.notes).toEqual(["Новый лимит ₴450 действует с завтра"]);
  });

  it("once the day runs on the new limit there is no line about tomorrow", () => {
    const p = parts({ own: 2_000_000, free: -820_000, share: -91_112, rule: "floor", dailyLimit: 45_000 });
    expect(sheet(p, { mode: "bridge", leftToday: 20_000, shortageStart: {} }).notes).toEqual([]);
  });
});
