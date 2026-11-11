// A throwaway local Postgres for the simulator stand (the same embedded-postgres the tests use).
// Usage: node scripts/sim/pg.mjs <data dir> <port>. Prints PG_READY, then runs until it is killed.
import { createRequire } from "node:module";

// The package belongs to apps/api: it is loaded from there, not from the repository root.
const load = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const mod = load("embedded-postgres");
const EmbeddedPostgres = mod.default ?? mod;

const [dir, port] = process.argv.slice(2);
if (!dir || !port) {
  console.error("usage: node scripts/sim/pg.mjs <data dir> <port>");
  process.exit(2);
}
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "hale", password: "hale", port: Number(port), persistent: false, onLog: () => {}, onError: () => {} });
await pg.initialise();
await pg.start();
await pg.createDatabase("hale");
console.log("PG_READY");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
setInterval(() => {}, 1 << 30);
