import { createDataSource } from "./data-source";

// Usage: tsx src/db/mig.ts run|revert  (reads DATABASE_URL from the environment)
const cmd = process.argv[2];
if (cmd !== "run" && cmd !== "revert") {
  console.error("usage: mig.ts run|revert");
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const ds = createDataSource(url);
await ds.initialize();
try {
  if (cmd === "run") {
    const done = await ds.runMigrations();
    console.log(`applied: ${done.map((m) => m.name).join(", ") || "none"}`);
  } else {
    await ds.undoLastMigration();
    console.log("reverted last migration");
  }
} finally {
  await ds.destroy();
}
