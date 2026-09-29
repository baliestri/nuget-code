import { configDefaults, defineConfig } from "vitest/config";
import { packageSourceAliases, sourceAliases } from "../../vitest.shared";

export default defineConfig({
  resolve: {
    alias: [
      ...packageSourceAliases("client", new URL("./src/", import.meta.url)),
      ...sourceAliases(new URL("../../", import.meta.url)),
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
