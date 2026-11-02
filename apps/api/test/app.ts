import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import argon2 from "argon2";
import { AppModule } from "../src/app.module";
import type { AppConfig } from "../src/config";
import { MonoClient } from "../src/mono/mono.client";
import { createDataSource } from "../src/db/data-source";
import { createTestDatabase } from "./db";

export const TEST_PASSWORD = "correct horse battery staple";

/** Fresh migrated database, returns its URL. */
export async function createMigratedDatabase(): Promise<string> {
  const url = await createTestDatabase();
  const ds = createDataSource(url);
  await ds.initialize();
  await ds.runMigrations();
  await ds.destroy();
  return url;
}

export async function makeConfig(
  databaseUrl: string,
  over: Partial<AppConfig> = {},
): Promise<AppConfig> {
  return {
    DATABASE_URL: databaseUrl,
    JWT_SECRET: "test-secret-test-secret-test-secret-1234",
    OWNER_PASSWORD_HASH: await argon2.hash(TEST_PASSWORD),
    OWNER_NAMES: [],
    PORT: 0,
    ...over,
  };
}

export interface TestAppOptions {
  config?: Partial<AppConfig>;
  /** Replaces MonoClient so no test ever reaches the real monobank. */
  client?: unknown;
  /** Replaces providers by token (e.g. the Expo fetch). */
  overrides?: [unknown, unknown][];
}

export async function createTestApp(
  databaseUrl: string,
  opts: TestAppOptions = {},
): Promise<INestApplication> {
  const builder = Test.createTestingModule({
    imports: [AppModule.forRoot(await makeConfig(databaseUrl, opts.config))],
  });
  if (opts.client) builder.overrideProvider(MonoClient).useValue(opts.client);
  for (const [token, value] of opts.overrides ?? []) builder.overrideProvider(token as never).useValue(value);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}
