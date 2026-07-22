// Flat ESLint config shared across the monorepo (ESLint 9).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-test/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/*.config.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // React apps: hooks + fast-refresh rules, browser globals.
  {
    files: ["apps/web-*/**/*.{ts,tsx}", "packages/ui-primitives/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  // Node-side code (API + configs).
  {
    files: ["apps/api/**/*.ts", "**/*.config.{ts,mts}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // Keep Prettier last so it disables stylistic rules.
  prettier,
);
