// Runs a SQL file against the stand's database and prints the rows of its last statement.
// Usage: node scripts/sim/sql.mjs <file.sql> [database url]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// The package belongs to apps/api: it is loaded from there, not from the repository root.
const load = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const { Client } = load("pg");

const [file, url = `postgres://hale:hale@127.0.0.1:${process.env.SIM_PG_PORT ?? 55432}/hale`] = process.argv.slice(2);
if (!file) {
  console.error("usage: node scripts/sim/sql.mjs <file.sql> [database url]");
  process.exit(2);
}
const client = new Client({ connectionString: url });
await client.connect();
try {
  const res = await client.query(readFileSync(file, "utf8"));
  const last = Array.isArray(res) ? res[res.length - 1] : res;
  if (last?.rows?.length) console.log(JSON.stringify(last.rows));
} finally {
  await client.end();
}
