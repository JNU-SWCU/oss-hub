import { defineConfig } from "eslint/config";
import nextPlugin from "@next/eslint-plugin-next";
import typescriptParser from "@typescript-eslint/parser";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: nextPlugin.configs.recommended.rules,
  },
  {
    ignores: [".next/**", "coverage/**", "node_modules/**"],
  },
]);
