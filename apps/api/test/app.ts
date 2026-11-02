import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import argon2 from "argon2";
import { AppModule } from "../src/app.module";
import type { AppConfig } from "../src/config";
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

export async function makeConfig(databaseUrl: string): Promise<AppConfig> {
  return {
    DATABASE_URL: databaseUrl,
    JWT_SECRET: "test-secret-test-secret-test-secret-1234",
    OWNER_PASSWORD_HASH: await argon2.hash(TEST_PASSWORD),
    PORT: 0,
  };
}

export async function createTestApp(databaseUrl: string): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(await makeConfig(databaseUrl))],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}
