import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-raw-colors.mjs");
/** @type {string} */
let root = "";

/** @param {string} rel @param {string} content */
function write(rel, content) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
function run() {
  return spawnSync(process.execPath, [script, root], { encoding: "utf8" });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "colors-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("check-raw-colors", () => {
  it.each([
    ["short hex", "const c = '#fff';"],
    ["long hex", "const c = '#1a2B3c';"],
    ["rgb", "const c = 'rgb(0, 0, 0)';"],
    ["rgba", "const c = `rgba(0,0,0,.5)`;"],
  ])("fails with exit 1 and the file path for %s", (_n, body) => {
    write("apps/mobile/src/ui/Button.tsx", body);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain(join("apps", "mobile", "src", "ui", "Button.tsx"));
  });

  it("passes when apps/*/src has no raw colors", () => {
    write("apps/mobile/src/ui/Button.tsx", "const c = tokens.color.accent; // issue #12345678x");
    const r = run();
    expect(r.status).toBe(0);
  });

  it("does not check packages/tokens", () => {
    write("packages/tokens/src/colors.ts", "export const white = '#fff'; export const a = 'rgba(0,0,0,1)';");
    expect(run().status).toBe(0);
  });

  it("does not check files outside src", () => {
    write("apps/mobile/app.json", '{"backgroundColor": "#ffffff"}');
    expect(run().status).toBe(0);
  });

  it("passes when apps/ does not exist", () => {
    expect(run().status).toBe(0);
  });
});
