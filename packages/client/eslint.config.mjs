// @ts-check

import { defineConfig } from "eslint/config";
import eslint from "../../eslint.config.mjs";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";

export default defineConfig(eslint, {
  settings: {
    "import-x/resolver-next": [
      createTypeScriptImportResolver({
        alwaysTryTypes: true,
        project: "./tsconfig.json",
      }),
    ],
  },
});
