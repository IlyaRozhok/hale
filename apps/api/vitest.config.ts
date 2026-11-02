import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// Nest/TypeORM rely on decorators; esbuild (vitest default) cannot emit
// decorator metadata, so SWC compiles the TypeScript instead.
export default defineConfig({
  test: {
    name: "api",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
