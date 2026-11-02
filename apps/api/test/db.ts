import { randomBytes } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";

/**
 * Creates an empty, uniquely named database on the shared embedded Postgres
 * (started once by global-setup.ts) and returns its connection URL.
 * Tests that need the schema should then run migrations against it.
 */
export async function createTestDatabase(): Promise<string> {
  const adminUrl = inject("pgAdminUrl");
  const name = `t_${randomBytes(6).toString("hex")}`;
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}
