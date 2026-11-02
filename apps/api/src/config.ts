import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "must be at least 32 characters"),
  OWNER_PASSWORD_HASH: z.string().startsWith("$argon2", "must be an argon2 hash"),
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
