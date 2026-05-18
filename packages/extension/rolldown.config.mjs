import { defineConfig } from "rolldown";
import { resolve } from "node:path";
import process from "node:process";

const production = process.env.NODE_ENV === "production";

export default defineConfig({
  input: resolve(import.meta.dirname, "src/index.ts"),
  output: {
    file: resolve(import.meta.dirname, "dist/extension.js"),
    format: "cjs",
    sourcemap: !production,
    cleanDir: false,
    minify: production,
    codeSplitting: false,
    keepNames: false,
    strict: true,
    banner: "#!/usr/bin/env node",
  },
  logLevel: "info",
  tsconfig: true,
  platform: "node",
  external: ["vscode"],
});
