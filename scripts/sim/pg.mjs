// A throwaway local Postgres for the simulator stand (the same embedded-postgres the tests use).
// Usage: node scripts/sim/pg.mjs <data dir> <port>. Prints PG_READY, then runs until it is killed.
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const mod = require("embedded-postgres");
const EmbeddedPostgres = mod.default ?? mod;

const [dir, port] = process.argv.slice(2);
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
