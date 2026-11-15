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

  it("splits OWNER_NAMES on semicolons and defaults to none", () => {
    expect(loadConfig(valid).OWNER_NAMES).toEqual([]);
    expect(loadConfig({ ...valid, OWNER_NAMES: " Test Owner; Owner Test ;" }).OWNER_NAMES).toEqual([
      "Test Owner",
      "Owner Test",
    ]);
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

  it("treats MONOBANK_TOKEN as optional", () => {
    expect(loadConfig(valid).MONOBANK_TOKEN).toBeUndefined();
    expect(loadConfig({ ...valid, MONOBANK_TOKEN: "" }).MONOBANK_TOKEN).toBeUndefined();
    expect(loadConfig({ ...valid, MONOBANK_TOKEN: "tok" }).MONOBANK_TOKEN).toBe("tok");
  });
});

describe("loadConfig webhook settings", () => {
  it("leaves MONO_WEBHOOK_SECRET and PUBLIC_URL optional, empty counts as unset", () => {
    const cfg = loadConfig({ ...valid, MONO_WEBHOOK_SECRET: "", PUBLIC_URL: "" });
    expect(cfg.MONO_WEBHOOK_SECRET).toBeUndefined();
    expect(cfg.PUBLIC_URL).toBeUndefined();
  });

  it("accepts a secret and a public URL, rejects a short secret or a bad URL", () => {
    const cfg = loadConfig({
      ...valid,
      MONO_WEBHOOK_SECRET: "s".repeat(24),
      PUBLIC_URL: "https://hale.example.com/",
    });
    expect(cfg.MONO_WEBHOOK_SECRET).toBe("s".repeat(24));
    expect(cfg.PUBLIC_URL).toBe("https://hale.example.com");
    expect(() => loadConfig({ ...valid, MONO_WEBHOOK_SECRET: "short" })).toThrow(/MONO_WEBHOOK_SECRET/);
    expect(() => loadConfig({ ...valid, PUBLIC_URL: "not a url" })).toThrow(/PUBLIC_URL/);
  });
});

describe("loadConfig ledger check (Б11)", () => {
  it("keeps the nightly check off unless LEDGER_CHECK_ENABLED says true", () => {
    expect(loadConfig(valid).LEDGER_CHECK_ENABLED).toBeUndefined(); // unset: off, as the service reads it
    expect(loadConfig({ ...valid, LEDGER_CHECK_ENABLED: "" }).LEDGER_CHECK_ENABLED).toBe(false);
    expect(loadConfig({ ...valid, LEDGER_CHECK_ENABLED: "false" }).LEDGER_CHECK_ENABLED).toBe(false);
    expect(loadConfig({ ...valid, LEDGER_CHECK_ENABLED: "0" }).LEDGER_CHECK_ENABLED).toBe(false);
    expect(loadConfig({ ...valid, LEDGER_CHECK_ENABLED: "true" }).LEDGER_CHECK_ENABLED).toBe(true);
    expect(loadConfig({ ...valid, LEDGER_CHECK_ENABLED: "1" }).LEDGER_CHECK_ENABLED).toBe(true);
  });

  it("rejects a value it cannot read rather than guess", () => {
    expect(() => loadConfig({ ...valid, LEDGER_CHECK_ENABLED: "yes please" })).toThrow(/LEDGER_CHECK_ENABLED/);
  });
});
