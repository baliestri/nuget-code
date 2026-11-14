/*
 * Builds the view into the extension:
 *
 *   tsx build.ts            apps/extension/dist/webview/{main.js, main.css, codicon.ttf}
 *   tsx build.ts --watch    the same, rebuilt on change
 *   tsx build.ts --dev      dev/dist: the development page that runs in a browser with sample data
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, watch as fsWatch } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type BuildOptions } from "rolldown";

const here = dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes("--dev");
const watching = process.argv.includes("--watch");
const out = dev ? join(here, "dev", "dist") : join(here, "..", "extension", "dist", "webview");
const production = !dev && !watching;

const options: BuildOptions = {
  input: join(here, dev ? "dev/main.tsx" : "src/main.tsx"),
  platform: "browser",
  onwarn: (warning, warn) => {
    // Libraries mark their modules "use client" for server rendering, which means nothing in one bundle.
    if (warning.code !== "MODULE_LEVEL_DIRECTIVE") {
      warn(warning);
    }
  },
  transform: {
    jsx: "react-jsx",
    define: { "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development") }
  },
  output: {
    file: join(out, "main.js"),
    format: "iife",
    minify: production,
    sourcemap: !production
  }
};

function styles(): void {
  // The classes are found by scanning the sources; the result is one static style sheet, which is what the
  // view's content security policy allows.
  const result = spawnSync(
    ["pnpm", "exec", "tailwindcss", "-i", "src/styles.css", "-o", `"${join(out, "main.css")}"`]
      .concat(production ? ["--minify"] : [])
      .join(" "),
    { cwd: here, stdio: "inherit", shell: true }
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  // The editor's icon set: its classes go into the same style sheet, and its font next to it, which is
  // where the classes look for it.
  appendFileSync(join(out, "main.css"), readFileSync(require.resolve("@vscode/codicons/dist/codicon.css"), "utf8"));
}

const require = createRequire(import.meta.url);
mkdirSync(out, { recursive: true });
copyFileSync(require.resolve("@vscode/codicons/dist/codicon.ttf"), join(out, "codicon.ttf"));

async function run(): Promise<void> {
  await build(options);
  styles();
  console.log(`built ${out}`);
}

await run();
if (watching) {
  // Rebuilds shortly after the last change under src/.
  let timer: NodeJS.Timeout | undefined;
  fsWatch(join(here, "src"), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run().catch((error: unknown) => console.error(error)), 150);
  });
}
