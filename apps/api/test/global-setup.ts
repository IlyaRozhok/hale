import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

declare module "vitest" {
  export interface ProvidedContext {
    pgAdminUrl: string;
  }
}

/** Starts one embedded Postgres for the whole test run. */
export default async function setup(project: TestProject) {
  const dir = await mkdtemp(join(tmpdir(), "tablo-pg-"));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "tablo",
    password: "tablo",
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  project.provide("pgAdminUrl", `postgres://tablo:tablo@127.0.0.1:${port}/postgres`);
  return async () => {
    await pg.stop();
    await rm(dir, { recursive: true, force: true });
  };
}
