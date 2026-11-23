import { describe, expect, it } from "vitest";
import { FORBIDDEN_WORDS, dueNotifications, type NotifyState, type TaxPayment } from "./schedule";

// Kyiv is UTC+2 in November, so 10:00 Kyiv is 08:00Z and 21:00 Kyiv is 19:00Z.
const kyiv = (date: string, hhmm: string): Date => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(`${date}T${String(h! - 2).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
};

const tax = (over: Partial<TaxPayment> = {}): TaxPayment => ({
  id: 1, name: "Единый налог", amount: 1_234_500, currency: "UAH", dueOn: "2026-11-20", paid: false, ...over,
});

const base = (over: Partial<NotifyState> = {}): NotifyState => ({
  taxes: [], leftToday: 10_000, dailyLimit: 100_000, badCases: [], questions: [],
  syncedAt: null, sentKeys: new Set(), ordinarySentToday: false, shortageStart: false, ...over,
});

const keys = (s: NotifyState, d: string, t: string) => dueNotifications(s, kyiv(d, t)).map((n) => n.key);

describe("tax reminders", () => {
  it("fire on 13, 19 and 20 Nov at 10:00 for a 20 Nov due date", () => {
    const s = base({ taxes: [tax()] });
    expect(keys(s, "2026-11-13", "09:59")).toEqual([]);
    expect(keys(s, "2026-11-13", "10:00")).toEqual(["tax:1:d7"]);
    expect(keys(s, "2026-11-19", "10:00")).toEqual(["tax:1:d1"]);
    expect(keys(s, "2026-11-20", "10:00")).toEqual(["tax:1:d0"]);
    expect(keys(s, "2026-11-14", "12:00")).toEqual([]);
  });

  it("stay silent once sent, and for paid payments", () => {
    expect(keys(base({ taxes: [tax()], sentKeys: new Set(["tax:1:d7"]) }), "2026-11-13", "10:15")).toEqual([]);
    expect(keys(base({ taxes: [tax({ paid: true })] }), "2026-11-13", "10:00")).toEqual([]);
  });

  it("paying after the first one cancels the rest", () => {
    const s = base({ taxes: [tax({ paid: true })], sentKeys: new Set(["tax:1:d7"]) });
    expect(keys(s, "2026-11-19", "10:00")).toEqual([]);
    expect(keys(s, "2026-11-20", "10:00")).toEqual([]);
    expect(keys(s, "2026-11-21", "10:00")).toEqual([]);
  });

  it("skip a reminder whose day passed and do not back-fill", () => {
    const s = base({ taxes: [tax()] });
    expect(keys(s, "2026-11-19", "10:00")).toEqual(["tax:1:d1"]);
    expect(keys(s, "2026-11-14", "10:00")).toEqual([]);
  });

  it("send one 'deadline passed' reminder the next day, then stop", () => {
    const s = base({ taxes: [tax()] });
    expect(keys(s, "2026-11-21", "10:00")).toEqual(["tax:1:over"]);
    expect(keys(base({ taxes: [tax()], sentKeys: new Set(["tax:1:over"]) }), "2026-11-21", "12:00")).toEqual([]);
    expect(keys(s, "2026-11-22", "10:00")).toEqual([]);
    expect(keys(base({ taxes: [tax({ paid: true })] }), "2026-11-21", "10:00")).toEqual([]);
  });

  it("state the tax name, sum and due date", () => {
    const [n] = dueNotifications(base({ taxes: [tax()] }), kyiv("2026-11-13", "10:00"));
    const text = `${n!.title} ${n!.body}`;
    expect(n!.kind).toBe("tax");
    expect(text).toContain("Единый налог");
    expect(text).toContain("₴12 345");
    expect(n!.body).toBe("Единый налог: ₴12 345 к уплате до 20 ноя, через 7 дней.");
  });

  it("write the due date as the app does, with the year when it is the next one", () => {
    const body = (d: string, dueOn: string) => dueNotifications(base({ taxes: [tax({ dueOn })] }), kyiv(d, "10:00"))[0]!.body;
    expect(body("2026-11-19", "2026-11-20")).toBe("Единый налог: ₴12 345 к уплате до 20 ноя, срок завтра.");
    expect(body("2026-11-20", "2026-11-20")).toBe("Единый налог: ₴12 345, срок уплаты сегодня, 20 ноя.");
    expect(body("2026-11-21", "2026-11-20")).toBe("Единый налог: ₴12 345, срок прошёл 20 ноя.");
    expect(body("2026-12-29", "2027-01-05")).toBe("Единый налог: ₴12 345 к уплате до 5 янв 2027, через 7 дней.");
  });

  it("do not count against the one-ordinary-a-day limit", () => {
    const s = base({ taxes: [tax()], ordinarySentToday: true });
    expect(keys(s, "2026-11-13", "10:00")).toEqual(["tax:1:d7"]);
  });
});

describe("over limit", () => {
  const over = base({ leftToday: -25_000 });
  it("comes once at 21:00 and not without an overspend", () => {
    expect(keys(over, "2026-11-05", "20:59")).toEqual([]);
    expect(keys(over, "2026-11-05", "21:00")).toEqual(["over_limit:2026-11-05"]);
    expect(keys(base({ leftToday: 0 }), "2026-11-05", "21:00")).toEqual([]);
    expect(keys({ ...over, sentKeys: new Set(["over_limit:2026-11-05"]) }, "2026-11-05", "21:15")).toEqual([]);
  });

  it("is dropped when its evening has passed", () => {
    expect(keys(over, "2026-11-06", "10:00")).toEqual([]);
  });

  it("mentions the amount over", () => {
    const [n] = dueNotifications(over, kyiv("2026-11-05", "21:00"));
    expect(n!.body).toContain("₴250");
  });

  it("stays silent on the day the shortage came on, and comes the next day if that one is over too", () => {
    // Decision 6.7 of the audit: the transition day is not judged by any limit.
    expect(keys({ ...over, shortageStart: true }, "2026-11-05", "21:00")).toEqual([]);
    expect(keys({ ...over, shortageStart: true }, "2026-11-05", "23:45")).toEqual([]);
    expect(keys(over, "2026-11-06", "21:00")).toEqual(["over_limit:2026-11-06"]);
  });

  it("on the transition day lets the next ordinary candidate through instead", () => {
    const s = base({ leftToday: -25_000, shortageStart: true, syncedAt: "2026-11-01T08:00:00Z", ordinarySentToday: false });
    expect(keys(s, "2026-11-05", "21:00")).toEqual(["sync_broken:2026-11-01"]);
  });
});

describe("ordinary limit and priority", () => {
  const all = base({
    leftToday: -1,
    badCases: [{ id: "loan:3", text: "Взят займ ₴5 000 (03.11): столько не хватало." }],
    questions: [
      { id: "usdc_arrived:7", kind: "usdc_arrived", text: "Пришло на Binance?" },
      { id: "income_date:9", kind: "income_date", text: "Когда ожидается следующий доход?" },
    ],
    syncedAt: "2026-11-10T08:00:00Z",
  });

  it("lists all fresh ordinary candidates in priority order", () => {
    expect(keys(all, "2026-11-21", "21:30")).toEqual([
      "bad:loan:3", "over_limit:2026-11-21", "usdc:7:2026-11-21", "income_date:2026-11", "sync_broken:2026-11-10",
    ]);
  });

  it("drops what was sent, so the next one leads", () => {
    const first = (st: NotifyState, t: string) => keys(st, "2026-11-21", t)[0];
    expect(first(all, "21:30")).toBe("bad:loan:3");
    expect(first({ ...all, sentKeys: new Set(["bad:loan:3"]) }, "21:30")).toBe("over_limit:2026-11-21");
    const noOver = { ...all, leftToday: 5, sentKeys: new Set(["bad:loan:3"]) };
    expect(first(noOver, "12:00")).toBe("usdc:7:2026-11-21");
    const noUsdc = { ...noOver, questions: all.questions.slice(1) };
    expect(first(noUsdc, "12:00")).toBe("income_date:2026-11");
    expect(keys({ ...noUsdc, questions: [] }, "2026-11-21", "12:00")).toEqual(["sync_broken:2026-11-10"]);
  });

  it("sends nothing ordinary when one already went today, except the over-limit evening; lower ones wait", () => {
    expect(keys({ ...all, ordinarySentToday: true }, "2026-11-21", "21:30")).toEqual(["over_limit:2026-11-21"]);
    expect(keys({ ...all, ordinarySentToday: true }, "2026-11-21", "12:00")).toEqual([]);
    const sent = new Set(["over_limit:2026-11-21"]);
    expect(keys({ ...all, ordinarySentToday: true, sentKeys: sent }, "2026-11-21", "21:30")).toEqual([]);
    expect(keys({ ...all, sentKeys: new Set(["bad:loan:3"]), leftToday: 5 }, "2026-11-22", "10:00")[0]).toBe("usdc:7:2026-11-22");
  });

  it("holds ordinary notifications until 10:00", () => {
    expect(keys(all, "2026-11-21", "09:00")).toEqual([]);
  });
});

describe("bad case", () => {
  it("comes once per key", () => {
    const s = base({ badCases: [{ id: "bridge_over_plan", text: "Минус вышел за план моста на ₴300." }] });
    expect(keys(s, "2026-11-05", "11:00")).toEqual(["bad:bridge_over_plan"]);
    expect(keys({ ...s, sentKeys: new Set(["bad:bridge_over_plan"]) }, "2026-11-05", "11:30")).toEqual([]);
  });

  it("is absent when there are no bad cases", () => {
    expect(keys(base(), "2026-11-05", "11:00")).toEqual([]);
  });
});

describe("USDC question", () => {
  const q = { id: "usdc_arrived:7", kind: "usdc_arrived", text: "Пришло на Binance?" };
  it("repeats daily at 10:00 while unconfirmed, a new key each day", () => {
    const s = base({ questions: [q] });
    expect(keys(s, "2026-11-15", "10:00")).toEqual(["usdc:7:2026-11-15"]);
    expect(keys(s, "2026-11-16", "10:00")).toEqual(["usdc:7:2026-11-16"]);
    expect(keys({ ...s, sentKeys: new Set(["usdc:7:2026-11-16"]) }, "2026-11-16", "14:00")).toEqual([]);
  });
  it("stops once confirmed (no question) and returns next month with a new event", () => {
    expect(keys(base(), "2026-11-17", "10:00")).toEqual([]);
    const dec = base({ questions: [{ ...q, id: "usdc_arrived:12" }] });
    expect(keys(dec, "2026-12-15", "10:00")).toEqual(["usdc:12:2026-12-15"]);
  });
});

describe("sync_broken", () => {
  it("fires once after more than 24 hours without sync", () => {
    const stale = base({ syncedAt: "2026-11-10T07:00:00Z" });
    expect(keys(stale, "2026-11-11", "10:00")).toEqual(["sync_broken:2026-11-10"]);
    expect(keys({ ...stale, sentKeys: new Set(["sync_broken:2026-11-10"]) }, "2026-11-12", "10:00")).toEqual([]);
  });
  it("names the last sync day as the app writes dates", () => {
    const [n] = dueNotifications(base({ syncedAt: "2026-11-10T07:00:00Z" }), kyiv("2026-11-11", "10:00"));
    expect(n!.body).toBe("Данные из monobank не обновлялись больше суток, последний раз 10 ноя. Цифры на экране могут отставать.");
  });
  it("is silent within 24 hours or when never synced", () => {
    expect(keys(base({ syncedAt: "2026-11-10T09:00:00Z" }), "2026-11-11", "10:00")).toEqual([]);
    expect(keys(base({ syncedAt: null }), "2026-11-11", "10:00")).toEqual([]);
  });
});

describe("tone", () => {
  it("never uses reproachful words", () => {
    const s = base({
      taxes: [tax()],
      leftToday: -500,
      badCases: [{ id: "loan:1", text: "Взят займ ₴5 000 (03.11): столько не хватало." }],
      questions: [
        { id: "usdc_arrived:7", kind: "usdc_arrived", text: "Пришло на Binance?" },
        { id: "income_date:9", kind: "income_date", text: "Когда ожидается следующий доход?" },
      ],
      syncedAt: "2026-11-01T08:00:00Z",
    });
    const texts: string[] = [];
    const tries: [string, string, Partial<NotifyState>?][] = [
      ["2026-11-13", "10:00"], ["2026-11-19", "10:00"], ["2026-11-20", "10:00"], ["2026-11-21", "10:00"],
      ["2026-11-05", "21:00", { sentKeys: new Set(["bad:loan:1"]) }],
      ["2026-11-05", "12:00", { sentKeys: new Set(["bad:loan:1"]) }],
      ["2026-11-05", "12:00", { sentKeys: new Set(["bad:loan:1"]), questions: s.questions.slice(1) }],
      ["2026-11-05", "12:00", { sentKeys: new Set(["bad:loan:1"]), questions: [] }],
    ];
    for (const [d, t, o] of tries) for (const n of dueNotifications({ ...s, ...o }, kyiv(d, t))) texts.push(`${n.title} ${n.body}`.toLowerCase());
    expect(texts.length).toBeGreaterThanOrEqual(7);
    for (const text of texts) for (const w of FORBIDDEN_WORDS) expect(text).not.toContain(w);
  });
});
