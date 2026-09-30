import { mergeConfig } from "vitest/config";
import clientIntegration from "../client/vitest.integration.config";
import { packageSourceAliases } from "../../vitest.shared";

export default mergeConfig(clientIntegration, {
  resolve: {
    alias: packageSourceAliases(
      "extension",
      new URL("./src/", import.meta.url),
    ),
  },
  test: { include: ["src/**/*.integration.test.ts"] },
});
