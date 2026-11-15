import { defineConfig } from "rolldown";

const production = process.env["NODE_ENV"] === "production";

/*
 * One CommonJS file. `vscode` is provided by the editor at runtime; everything else, the workspace
 * packages and vscode-jsonrpc included, is bundled, so the VSIX ships no node_modules.
 */
export default defineConfig({
  input: "src/extension.ts",
  platform: "node",
  external: ["vscode"],
  output: {
    file: "dist/extension.js",
    format: "cjs",
    sourcemap: !production,
    minify: production
  }
});
