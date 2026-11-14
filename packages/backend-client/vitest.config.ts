import { defineConfig, mergeConfig } from "vitest/config";
import { shared } from "../../vitest.shared";

// The contract tests start real backend processes, each of which starts `dotnet`: one file at a time.
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      globalSetup: "./test/support/globalSetup.ts",
      testTimeout: 180_000,
      hookTimeout: 180_000,
      fileParallelism: false
    }
  })
);
