import { describe, expect, it } from "vitest";
import type { InsightsMonthDto } from "@hale/contracts";
import { monthSection } from "./monthSection";

type Category = InsightsMonthDto["categories"][number];
const cat = (category: string, spent: number, previousSpent = spent, count = 1): Category => ({ category, spent, previousSpent, count });

/** 1–16 November against 1–16 October, as `insightsFixture` of the screens' tests: ₴18,220 against ₴18,040. */
const month = (over: Partial<InsightsMonthDto> = {}): InsightsMonthDto => ({
  month: "2026-11",
  through: "2026-11-16",
  previous: { from: "2026-10-01", to: "2026-10-16" },
  spent: 1_822_000,
  previousSpent: 1_804_000,
  categories: [
    cat("groceries", 880_000, 900_000, 12),
    cat("cafe", 320_000, 210_000, 14),
    cat("transport", 215_000, 245_000, 8),
    cat("subscriptions", 164_000, 164_000, 4),
    cat("leisure", 138_000, 180_000, 3),
    cat("health", 60_000, 0),
    cat("utilities", 40_000, 50_000),
    cat("telecom", 30_000, 30_000),
    cat("shopping", 0, 30_000, 0),
    cat("refund", -25_000, -5_000),
  ],
  ...over,
});
const section = (over: Partial<InsightsMonthDto> = {}) => monthSection(month(over), null)!;
const share = (over: Partial<InsightsMonthDto>, key: string) => section(over).shares.find((s) => s.key === key)!;

describe("monthSection (ЧЛ7)", () => {
  describe("when there is a section at all", () => {
    it("none while «Итоги» are loading or failed, and none from an older server", () => {
      expect(monthSection(undefined, null)).toBeNull();
      expect(monthSection(null, null)).toBeNull();
    });

    it("none in a month with no spending", () => {
      expect(monthSection(month({ spent: 0, categories: [] }), null)).toBeNull();
      expect(monthSection(month({ spent: 0, categories: [cat("shopping", 0, 30_000, 0)] }), null)).toBeNull();
    });

    it("none when refunds took back all that was spent: there is no sum to show shares of", () => {
      expect(monthSection(month({ spent: 0, categories: [cat("cafe", 20_000), cat("refund", -20_000)] }), null)).toBeNull();
      expect(monthSection(month({ spent: -5_000, categories: [cat("cafe", 20_000), cat("refund", -25_000)] }), null)).toBeNull();
      expect(monthSection(month({ spent: -5_000, categories: [cat("refund", -5_000)] }), null)).toBeNull();
    });
  });

  describe("the sum and the average", () => {
    it("the title is the month, the total is the server's `spent`, as «Итоги» show it", () => {
      const s = section();
      expect(s.title).toBe("Ноябрь");
      expect(s.total).toBe(1_822_000);
    });

    it("the average is over the days counted so far, the last one included", () => {
      // ₴18,220 over 16 days.
      expect(section().average).toBe("в среднем ₴1,139 в день");
      expect(section({ through: "2026-11-01", spent: 45_000, categories: [cat("cafe", 45_000)] }).average).toBe("в среднем ₴450 в день");
      expect(section({ through: "2026-11-30" }).average).toBe("в среднем ₴607 в день");
    });
  });

  describe("the comparison with the month before", () => {
    it("says by how many percent the month is above or below the same days", () => {
      expect(section().comparison).toEqual({ direction: "up", text: "1% к октябрю", label: "На 1% больше, чем в октябре за те же дни" });
      expect(section({ previousSpent: 1_918_000 }).comparison).toEqual({ direction: "down", text: "5% к октябрю", label: "На 5% меньше, чем в октябре за те же дни" });
    });

    it("leaves «за те же дни» out when the month before is counted whole", () => {
      const whole = { through: "2026-11-30", previous: { from: "2026-10-01", to: "2026-10-31" }, previousSpent: 911_000 };
      expect(section(whole).comparison).toEqual({ direction: "up", text: "100% к октябрю", label: "На 100% больше, чем в октябре" });
      // 31 March against the whole of February, which is shorter.
      const march = { month: "2026-03", through: "2026-03-31", previous: { from: "2026-02-01", to: "2026-02-28" }, previousSpent: 3_644_000 };
      expect(section(march).comparison).toEqual({ direction: "down", text: "50% к февралю", label: "На 50% меньше, чем в феврале" });
    });

    it("says «как в октябре» when the difference rounds to nothing", () => {
      expect(section({ previousSpent: 1_822_000 }).comparison).toEqual({ direction: "same", text: "как в октябре", label: "Как в октябре за те же дни" });
      expect(section({ previousSpent: 1_825_000 }).comparison?.direction).toBe("same");
    });

    it("is absent when nothing was spent in the month before: there is nothing to take a percent of", () => {
      expect(section({ previousSpent: 0 }).comparison).toBeNull();
      expect(section({ previousSpent: -5_000 }).comparison).toBeNull();
    });

    it("names January's month before, December", () => {
      const jan = { month: "2027-01", through: "2027-01-10", previous: { from: "2026-12-01", to: "2026-12-10" } };
      expect(section(jan).title).toBe("Январь");
      expect(section(jan).comparison?.text).toBe("1% к декабрю");
    });
  });

  describe("the shares of the bar", () => {
    it("are the four largest categories and «Остальное», largest first", () => {
      const s = section();
      expect(s.shares.map((x) => [x.key, x.name, x.amount])).toEqual([
        ["groceries", "Продукты", 880_000],
        ["cafe", "Кафе и рестораны", 320_000],
        ["transport", "Транспорт", 215_000],
        ["subscriptions", "Подписки", 164_000],
        // Досуг, Здоровье, Коммунальные, Связь.
        ["rest", "Остальное", 268_000],
      ]);
    });

    it("the rule for refunds: a category at or below zero is no share, and the shares are of the sum of the others", () => {
      const s = section();
      // «Возвраты» (−₴250) and the category spent on only in October are not in the bar, nor inside «Остальное».
      expect(s.shares.some((x) => x.key === "refund" || x.key === "shopping")).toBe(false);
      const shown = s.shares.reduce((sum, x) => sum + x.amount, 0);
      // The shares add up to what was spent before refunds; the total above the bar is after them.
      expect(shown).toBe(1_847_000);
      expect(shown - s.total).toBe(25_000);
      // Percents are of the bar, not of the total: 880 / 1,847.
      expect(s.shares.map((x) => x.percent)).toEqual([48, 17, 12, 9, 15]);
    });

    it("a category whose refunds outweigh its purchases is left out like «Возвраты»", () => {
      const s = section({ spent: 90_000, categories: [cat("cafe", 100_000), cat("shopping", -10_000)] });
      expect(s.shares.map((x) => [x.key, x.percent])).toEqual([["cafe", 100]]);
    });

    it("up to five categories are all named: «Остальное» is never one category", () => {
      const five = [cat("groceries", 500_000), cat("cafe", 400_000), cat("transport", 300_000), cat("leisure", 200_000), cat("health", 100_000)];
      expect(section({ spent: 1_500_000, categories: five }).shares.map((x) => x.key)).toEqual(["groceries", "cafe", "transport", "leisure", "health"]);
      expect(section({ spent: 900_000, categories: five.slice(0, 2) }).shares.map((x) => x.key)).toEqual(["groceries", "cafe"]);
      const six = [...five, cat("telecom", 50_000)];
      expect(section({ spent: 1_550_000, categories: six }).shares.map((x) => [x.key, x.amount])).toEqual([
        ["groceries", 500_000],
        ["cafe", 400_000],
        ["transport", 300_000],
        ["leisure", 200_000],
        ["rest", 150_000],
      ]);
    });

    it("sorts by the sum itself, whatever order the server sent", () => {
      const s = section({ spent: 600_000, categories: [cat("cafe", 100_000), cat("refund", -10_000), cat("groceries", 510_000)] });
      expect(s.shares.map((x) => x.key)).toEqual(["groceries", "cafe"]);
    });

    it("names a category as the owner's list names it", () => {
      const list = [{ key: "cafe", name: "Кофе" }] as never;
      expect(monthSection(month(), list)!.shares[1]!.name).toBe("Кофе");
    });
  });

  describe("the mark «above the month before»", () => {
    const one = (spent: number, previousSpent: number) => share({ spent, categories: [cat("cafe", spent, previousSpent)] }, "cafe").above;

    it("needs more than a quarter above and at least ₴500 above", () => {
      // ₴3,200 against ₴2,100.
      expect(share({}, "cafe").above).toBe(true);
      expect(share({}, "groceries").above).toBe(false);
      expect(share({}, "subscriptions").above).toBe(false);
    });

    it("a quarter exactly is not enough, a kopeck over it is", () => {
      expect(one(250_000, 200_000)).toBe(false);
      expect(one(250_001, 200_000)).toBe(true);
    });

    it("a large share of a small sum is not marked: under ₴500 the difference is noise", () => {
      expect(one(90_000, 45_000)).toBe(false);
      expect(one(89_999, 40_000)).toBe(false);
      expect(one(90_000, 40_000)).toBe(true);
    });

    it("a category new this month is marked from ₴500", () => {
      expect(one(50_000, 0)).toBe(true);
      expect(one(49_999, 0)).toBe(false);
      // Refunds outweighed the purchases the month before: counted as nothing spent.
      expect(one(50_000, -30_000)).toBe(true);
    });

    it("«Остальное» is never marked", () => {
      expect(share({}, "rest").above).toBe(false);
    });
  });

  describe("the phrase about a share", () => {
    it("says the sum and how it stands against the same days of the month before", () => {
      expect(share({}, "cafe").phrase).toBe("Кафе и рестораны — ₴3,200, на ₴1,100 больше, чем в октябре за те же дни");
      expect(share({}, "groceries").phrase).toBe("Продукты — ₴8,800, на ₴200 меньше, чем в октябре за те же дни");
      expect(share({}, "subscriptions").phrase).toBe("Подписки — ₴1,640, как в октябре за те же дни");
    });

    it("a difference under a hryvnia is «как в октябре»", () => {
      const s = share({ spent: 100_040, categories: [cat("cafe", 100_040, 100_000)] }, "cafe");
      expect(s.phrase).toBe("Кафе и рестораны — ₴1,000, как в октябре за те же дни");
    });

    it("a category new this month says there was no such spending", () => {
      const s = share({ spent: 60_000, categories: [cat("health", 60_000, 0)] }, "health");
      expect(s.phrase).toBe("Здоровье — ₴600, в октябре за те же дни таких трат не было");
    });

    it("leaves «за те же дни» out when the month before is counted whole", () => {
      const whole = { through: "2026-11-30", previous: { from: "2026-10-01", to: "2026-10-31" } };
      expect(share(whole, "cafe").phrase).toBe("Кафе и рестораны — ₴3,200, на ₴1,100 больше, чем в октябре");
      expect(share(whole, "groceries").phrase).toBe("Продукты — ₴8,800, на ₴200 меньше, чем в октябре");
      expect(share(whole, "subscriptions").phrase).toBe("Подписки — ₴1,640, как в октябре");
      expect(share({ ...whole, spent: 60_000, categories: [cat("health", 60_000, 0)] }, "health").phrase).toBe("Здоровье — ₴600, в октябре таких трат не было");
    });

    it("«Остальное» says how many categories it holds, in the right form of the word", () => {
      expect(share({}, "rest").phrase).toBe("Остальное — ₴2,680 в 4 категориях");
      const many = (n: number) => Array.from({ length: n }, (_, i) => cat(`c${i}`, 100_000 - i));
      expect(share({ spent: 600_000, categories: many(6) }, "rest").phrase).toBe("Остальное — ₴2,000 в 2 категориях");
      expect(share({ spent: 2_500_000, categories: many(25) }, "rest").phrase).toBe("Остальное — ₴20,997 в 21 категории");
      expect(share({ spent: 1_500_000, categories: many(15) }, "rest").phrase).toBe("Остальное — ₴10,999 в 11 категориях");
    });
  });

  describe("what a share is called aloud", () => {
    it("the name, the sum and its percent of the bar; a marked one says so in words, not only by the arrow", () => {
      expect(share({}, "groceries").label).toBe("Продукты, ₴8,800, 48% трат");
      expect(share({}, "cafe").label).toBe("Кафе и рестораны, ₴3,200, 17% трат, заметно больше, чем в октябре");
      expect(share({}, "rest").label).toBe("Остальное, ₴2,680, 15% трат");
    });
  });
});
