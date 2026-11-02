import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.expo/**", "apps/mobile/ios/**", "apps/mobile/android/**", "apps/mobile/*.js", "private/", "docs/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
  // jest.mock factories run before imports are hoisted, so they must use require().
  { files: ["apps/mobile/**/*.test.tsx"], rules: { "@typescript-eslint/no-require-imports": "off" } },
);
