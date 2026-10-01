// @ts-check

import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import importX from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";

export default defineConfig(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", ".vscode-test/**"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "import-x": importX,
    },

    rules: {
      "import-x/no-unresolved": "error",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintPluginPrettierRecommended,
);
