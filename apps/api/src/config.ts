import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "must be at least 32 characters"),
  OWNER_PASSWORD_HASH: z.string().startsWith("$argon2", "must be an argon2 hash"),
  // Optional at boot: the owner adds it later; MonoClient throws if it is missing when called.
  MONOBANK_TOKEN: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  // Both optional: reconcile and webhook install skip (one log line) while any is unset.
  // The secret sits in a URL path, so it is limited to URL-safe characters.
  MONO_WEBHOOK_SECRET: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().regex(/^[A-Za-z0-9_-]{24,}$/, "must be 24+ URL-safe characters (A-Z a-z 0-9 _ -)").optional(),
  ),
  PUBLIC_URL: z.preprocess(
    (v) => (v === "" ? undefined : typeof v === "string" ? v.replace(/\/+$/, "") : v),
    z.url().optional(),
  ),
  // Owner's names as the bank prints them, ";"-separated; lets classify() recognise transfers
  // from the owner's own accounts. Optional.
  OWNER_NAMES: z.preprocess(
    (v) => (typeof v === "string" ? v.split(";").map((n) => n.trim()).filter(Boolean) : []),
    z.array(z.string()),
  ),
  // Task Б11: the nightly ledger check (05:00 Kyiv) runs only when this is "true" or "1". Off by default: the
  // owner turns it on when he deploys. Unset stays undefined, which means off, so a config built in code (tests)
  // may leave it out.
  LEDGER_CHECK_ENABLED: z.preprocess(
    (v) => (v === "" ? "false" : typeof v === "string" ? v.trim().toLowerCase() : v),
    z
      .enum(["true", "1", "false", "0"])
      .transform((v) => v === "true" || v === "1")
      .optional(),
  ),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
});

export type AppConfig = z.infer<typeof schema>;

/** Validates the environment once at startup; throws naming every bad variable. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${details}`);
  }
  return result.data;
}
