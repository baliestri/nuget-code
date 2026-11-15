import { defineConfig } from "vitest/config";

// Unit tests only. test/integration needs the editor and runs with another runner (vscode-test), so the
// shared configuration, which also looks under test/, is not used here.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
