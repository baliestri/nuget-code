import { defineConfig } from "vitest/config";
import { sourceAliases } from "../../vitest.shared";

export default defineConfig({
  resolve: {
    alias: sourceAliases(new URL("../../", import.meta.url)),
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
