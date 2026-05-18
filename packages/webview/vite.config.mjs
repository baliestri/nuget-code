import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import { resolve } from "node:path";

const production = process.env.NODE_ENV === "production";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    outDir: resolve(import.meta.dirname, "../extension/dist"),
    emptyOutDir: false,
    sourcemap: !production,
    rolldownOptions: {
      input: resolve(import.meta.dirname, "src/index.ts"),
      logLevel: "info",
      platform: "browser",
      tsconfig: true,
      output: {
        keepNames: false,
        minify: production,
        format: "iife",
        strict: true,
        entryFileNames: "webview.js",
        assetFileNames: "assets/[name][extname]",
        cleanDir: true,
        codeSplitting: false,
      },
    },
  },
});
