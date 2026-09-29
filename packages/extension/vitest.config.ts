import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { packageSourceAliases, sourceAliases } from "../../vitest.shared";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "vscode",
        replacement: fileURLToPath(
          new URL("./src/test/vscode.ts", import.meta.url),
        ).replaceAll("\\", "/"),
      },
      ...packageSourceAliases("extension", new URL("./src/", import.meta.url)),
      ...packageSourceAliases(
        "client",
        new URL("../client/src/", import.meta.url),
      ),
      ...sourceAliases(new URL("../../", import.meta.url)),
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
