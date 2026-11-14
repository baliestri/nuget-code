import { defineConfig } from "rolldown";

// The smoke tests, bundled to CommonJS for the mocha that runs inside the editor.
export default defineConfig({
  input: "test/integration/extension.test.ts",
  platform: "node",
  external: ["vscode"],
  output: {
    file: "out/integration/extension.test.js",
    format: "cjs"
  }
});
