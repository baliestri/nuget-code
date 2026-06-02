import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const extensionSrc = sourcePath("./src/");
const clientSrc = sourcePath("../client/src/");
const contractsSrc = sourcePath("../contracts/src/");
const managerSrc = sourcePath("../manager/src/");

export default defineConfig({
  resolve: {
    alias: [
      { find: "vscode", replacement: `${extensionSrc}/test/vscode.ts` },
      { find: "#extension", replacement: `${extensionSrc}/index.ts` },
      { find: /^#extension\/(.*)$/, replacement: `${extensionSrc}/$1.ts` },
      { find: "#client", replacement: `${clientSrc}/index.ts` },
      { find: /^#client\/(.*)$/, replacement: `${clientSrc}/$1.ts` },
      { find: "#contracts", replacement: `${contractsSrc}/index.ts` },
      { find: /^#contracts\/(.*)$/, replacement: `${contractsSrc}/$1.ts` },
      { find: "#manager", replacement: `${managerSrc}/index.ts` },
      { find: /^#manager\/(.*)$/, replacement: `${managerSrc}/$1.ts` },
    ],
  },
});

function sourcePath(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url))
    .replaceAll("\\", "/")
    .replace(/\/$/, "");
}
