import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const valid = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  JWT_SECRET: "x".repeat(32),
  OWNER_PASSWORD_HASH: "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA",
};

const without = (key: keyof typeof valid) => {
  const env: Record<string, string> = { ...valid };
  delete env[key];
  return env;
};

describe("loadConfig", () => {
  it("parses a complete environment", () => {
    const cfg = loadConfig(valid);
    expect(cfg.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(cfg.PORT).toBe(3000);
  });

  it("throws when JWT_SECRET is missing", () => {
    expect(() => loadConfig(without("JWT_SECRET"))).toThrow(/JWT_SECRET/);
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => loadConfig(without("DATABASE_URL"))).toThrow(/DATABASE_URL/);
  });

  it("throws when OWNER_PASSWORD_HASH is missing", () => {
    expect(() => loadConfig(without("OWNER_PASSWORD_HASH"))).toThrow(/OWNER_PASSWORD_HASH/);
  });
});
