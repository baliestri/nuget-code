// @ts-check

import { defineConfig } from "eslint/config";
import eslint from "../../eslint.config.mjs";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import eslintPluginVue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint,
  {
    settings: {
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        }),
      ],
    },
  },
  {
    extends: [...eslintPluginVue.configs["flat/recommended"]],
    files: ["**/*.vue"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      "vue/html-self-closing": "off",
      "vue/max-attributes-per-line": "off",
      "vue/no-v-html": "off",
      "vue/require-default-prop": "off",
      "vue/singleline-html-element-content-newline": "off",
    },
  },
);
