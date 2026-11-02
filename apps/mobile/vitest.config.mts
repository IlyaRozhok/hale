import { defineConfig } from "vitest/config";

// Logic modules under src/ must stay free of native imports so they run in plain node.
export default defineConfig({
  test: { name: "mobile", include: ["src/**/*.test.ts"] },
});
