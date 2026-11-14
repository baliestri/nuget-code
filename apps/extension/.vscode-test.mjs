import { defineConfig } from "@vscode/test-cli";

// The workspace is written by test/integration/prepare.ts before the editor starts.
export default defineConfig({
  files: "out/integration/**/*.test.js",
  workspaceFolder: ".vscode-test/workspace",
  launchArgs: ["--disable-workspace-trust", "--disable-extensions"],
  mocha: {
    ui: "bdd",
    timeout: 240_000
  }
});
