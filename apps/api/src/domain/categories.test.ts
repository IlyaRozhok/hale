import { describe, expect, it } from "vitest";
import { storedCategory } from "./categories";

describe("storedCategory (В5)", () => {
  const deleted = new Set(["cafe", "c_1a2b3c4d5e6f"]);

  it("keeps a category the owner has not deleted", () => {
    expect(storedCategory("groceries", deleted)).toBe("groceries");
    expect(storedCategory("uncategorized", deleted)).toBe("uncategorized");
  });

  it("files a deleted category as «Без категории»", () => {
    expect(storedCategory("cafe", deleted)).toBe("uncategorized");
    expect(storedCategory("c_1a2b3c4d5e6f", deleted)).toBe("uncategorized");
  });

  it("leaves the categories of other types alone: they are not in the list", () => {
    for (const c of ["tax", "debt", "loan", "cash", "transfer", "own", "income"]) expect(storedCategory(c, deleted)).toBe(c);
  });
});
