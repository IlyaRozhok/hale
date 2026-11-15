import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Clock, KYIV_TZ, kyivDaySql, kyivInstantSql } from "./clock";

const api = fileURLToPath(new URL("../..", import.meta.url));
const owner = join("src", "time", "clock.ts");

function sources(dir: string): string[] {
  return readdirSync(join(api, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(dir, f));
}

describe("time zone", () => {
  it("is named only in src/time/clock.ts", () => {
    const named = [...sources("src"), ...sources("test")].filter(
      (f) => f !== owner && readFileSync(join(api, f), "utf8").includes(KYIV_TZ),
    );
    expect(named).toEqual([]);
    expect(readFileSync(join(api, owner), "utf8")).toContain(KYIV_TZ);
  });

  it("builds the SQL for a Kyiv day and a Kyiv instant", () => {
    expect(kyivDaySql("t.occurred_at")).toBe(`(t.occurred_at AT TIME ZONE '${KYIV_TZ}')::date`);
    expect(kyivInstantSql("$1::timestamp")).toBe(`$1::timestamp AT TIME ZONE '${KYIV_TZ}'`);
  });
});

describe("Clock", () => {
  it("returns the fixed instant when set, the wall clock otherwise", () => {
    const clock = new Clock();
    const before = Date.now();
    const wall = clock.now().getTime();
    expect(wall).toBeGreaterThanOrEqual(before);
    clock.fixed = new Date("2026-11-15T10:00:00Z");
    expect(clock.now()).toEqual(new Date("2026-11-15T10:00:00Z"));
  });
});
