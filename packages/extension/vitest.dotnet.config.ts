import { mergeConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import clientIntegration from "../client/vitest.integration.config";
import { packageSourceAliases } from "../../vitest.shared";

export default mergeConfig(clientIntegration, {
  resolve: {
    alias: [
      {
        find: "vscode",
        replacement: fileURLToPath(
          new URL("./src/test/vscode.ts", import.meta.url),
        ).replaceAll("\\", "/"),
      },
      ...packageSourceAliases("extension", new URL("./src/", import.meta.url)),
    ],
  },
  test: { include: ["src/**/*.integration.test.ts"] },
});
