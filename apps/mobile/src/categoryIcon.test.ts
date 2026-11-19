import { describe, expect, it } from "vitest";
import { CATEGORY_ICONS } from "@hale/contracts";
import { categoryIcon, categoryIconOf, isCategoryIcon } from "./categoryIcon";

const spend = (category: string | null) => categoryIcon({ type: "spend", category });

describe("categoryIcon", () => {
  it("a purchase shows its category", () => {
    expect(spend("groceries")).toBe("cart");
    expect(spend("cafe")).toBe("coffee");
    expect(spend("transport")).toBe("car");
    expect(spend("health")).toBe("heart");
    expect(spend("utilities")).toBe("bolt");
    expect(spend("telecom")).toBe("phone");
    expect(spend("shopping")).toBe("bag");
    expect(spend("leisure")).toBe("ticket");
    expect(spend("subscriptions")).toBe("repeat");
    expect(spend("refund")).toBe("arrowIn");
  });

  it("an unknown or missing category is a plain circle", () => {
    expect(spend("uncategorized")).toBe("circle");
    expect(spend("something-new")).toBe("circle");
    expect(spend(null)).toBe("circle");
    expect(categoryIcon({ type: null, category: null })).toBe("circle");
  });

  it("other types show what kind of money movement it is", () => {
    expect(categoryIcon({ type: "cash_out", category: "cash" })).toBe("cash");
    expect(categoryIcon({ type: "cash_in", category: "cash" })).toBe("cash");
    expect(categoryIcon({ type: "own_transfer", category: "own" })).toBe("transfer");
    expect(categoryIcon({ type: "person_transfer", category: "transfer" })).toBe("transfer");
    expect(categoryIcon({ type: "obligation", category: "transfer" })).toBe("receipt");
    expect(categoryIcon({ type: "tax", category: "tax" })).toBe("receipt");
    expect(categoryIcon({ type: "debt_payment", category: "debt" })).toBe("receipt");
    expect(categoryIcon({ type: "income", category: "income" })).toBe("arrowIn");
    expect(categoryIcon({ type: "person_in", category: "transfer" })).toBe("arrowIn");
    expect(categoryIcon({ type: "loan_in", category: "loan" })).toBe("arrowIn");
  });

  it("takes a category's icon from the server's list, falling back to the built-in ones (В5)", () => {
    const list = [
      { key: "groceries", name: "Продукты", icon: "bag" as const, system: false },
      { key: "c_1", name: "Кот", icon: "paw" as const, system: false },
    ];
    expect(categoryIconOf("c_1", list)).toBe("paw");
    expect(categoryIconOf("groceries", list)).toBe("bag");
    expect(categoryIconOf("cafe", list)).toBe("coffee");
    expect(categoryIconOf("c_2", list)).toBe("circle");
    expect(categoryIconOf("groceries", undefined)).toBe("cart");
    expect(categoryIconOf(null, null)).toBe("circle");
    expect(categoryIcon({ type: "spend", category: "c_1" }, list)).toBe("paw");
    // Other types keep their kind of money movement whatever the list says.
    expect(categoryIcon({ type: "tax", category: "tax" }, list)).toBe("receipt");
  });

  it("an icon a newer server knows and this app does not draw falls back", () => {
    const list = [{ key: "c_1", name: "Кот", icon: "rocket" as never, system: false }];
    expect(categoryIconOf("c_1", list)).toBe("circle");
    for (const icon of CATEGORY_ICONS) expect(isCategoryIcon(icon)).toBe(true);
    expect(isCategoryIcon("rocket")).toBe(false);
  });
});
