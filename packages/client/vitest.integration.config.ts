import { defineConfig } from "vitest/config";
import { packageSourceAliases, sourceAliases } from "../../vitest.shared";

const major = Number(process.env.SDK_MAJOR);
if (!Number.isInteger(major) || major < 8) {
  throw new Error(
    "Set SDK_MAJOR to the installed .NET SDK major to test (8, 9, 10 or later).",
  );
}

export default defineConfig({
  resolve: {
    alias: [
      ...packageSourceAliases("client", new URL("./src/", import.meta.url)),
      ...sourceAliases(new URL("../../", import.meta.url)),
    ],
  },
  test: {
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 120_000,
    env: {
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
      DOTNET_NOLOGO: "1",
      MSBUILDDISABLENODEREUSE: "1",
    },
  },
});
