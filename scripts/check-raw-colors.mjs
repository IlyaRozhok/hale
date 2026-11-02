// Fails when raw colour literals appear in apps/*/src. Colours must come from packages/tokens.
import { readdirSync, readFileSync, statSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, extname } from "node:path";

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css"]);
const RAW_COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_])|\brgba?\(/;

/** @param {string} dir @returns {Generator<string>} */
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (EXTENSIONS.has(extname(name))) yield path;
  }
}

/** @param {string} root @returns {string[]} */
export function findRawColors(root) {
  const apps = join(root, "apps");
  if (!existsSync(apps)) return [];
  /** @type {string[]} */
  const hits = [];
  for (const app of readdirSync(apps)) {
    const src = join(apps, app, "src");
    if (!existsSync(src)) continue;
    for (const file of walk(src)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (RAW_COLOR.test(line)) hits.push(`${relative(root, file)}:${i + 1}`);
        });
    }
  }
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const hits = findRawColors(process.argv[2] ?? process.cwd());
  if (hits.length > 0) {
    console.error("Raw colours found (use packages/tokens):");
    for (const h of hits) console.error(`  ${h}`);
    process.exit(1);
  }
}
