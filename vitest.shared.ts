import { defineConfig } from "vitest/config";

/** What every package's vitest configuration starts from. */
export const shared = defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"]
  }
});
