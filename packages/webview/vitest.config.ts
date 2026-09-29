import { defineConfig } from "vitest/config";
import { packageSourceAliases, sourceAliases } from "../../vitest.shared";

export default defineConfig({
  resolve: {
    alias: [
      ...packageSourceAliases("webview", new URL("./src/", import.meta.url)),
      ...sourceAliases(new URL("../../", import.meta.url)),
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
