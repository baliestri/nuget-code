/*
 * Builds the VSIX of one target:
 *
 *   pnpm package <target> [--backend <executable>] [--out <directory>]
 *
 * Without --backend the backend is published with NativeAOT for the target, which only works on the
 * target's own operating system. With it, an executable published elsewhere is packaged as it is.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findTarget, TARGETS, type Target } from "./targets";

const repository = fileURLToPath(new URL("../", import.meta.url));
const extension = join(repository, "apps", "extension");
const backendProject = join(repository, "backend", "src", "NuGet.VisualStudioCode");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  console.log(`> ${command} ${args.join(" ")}`);
  // pnpm is a .cmd shim on Windows, which only a shell can start. A shell takes one command line, and the
  // arguments here are fixed by this script.
  const viaShell = process.platform === "win32" && command === "pnpm";
  const result = viaShell
    ? spawnSync([command, ...args].join(" "), { cwd, env, stdio: "inherit", shell: true })
    : spawnSync(command, [...args], { cwd, env, stdio: "inherit" });
  if (result.status !== 0) {
    fail(`${command} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : (args[index + 1] ?? fail(`${name} needs a value.`));
}

/** Publishes the backend for the target and returns the executable. */
function publish(target: Target): string {
  const env = { ...process.env };
  // The NativeAOT linker step finds the C++ tools through vswhere, which is not on PATH by default.
  const installer = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer";
  if (process.platform === "win32" && existsSync(installer)) {
    env["PATH"] = `${installer}${delimiter}${env["PATH"] ?? ""}`;
  }

  run("dotnet", ["publish", backendProject, "-c", "Release", "-r", target.rid, "-nologo"], repository, env);
  return join(backendProject, "bin", "Release", "net10.0", target.rid, "publish", target.executable);
}

const args = process.argv.slice(2);
const name = args[0] ?? fail(`Usage: pnpm package <target> [--backend <executable>] [--out <directory>]`);
const target =
  findTarget(name) ?? fail(`Unknown target '${name}'. Targets: ${TARGETS.map((item) => item.vsce).join(", ")}`);
const out = resolve(option(args, "--out") ?? join(repository, "release-artifacts"));
const given = option(args, "--backend");

const backend = given === undefined ? publish(target) : resolve(given);
if (!existsSync(backend)) {
  fail(`The backend executable was not found: ${backend}`);
}

// Emptied first, so a VSIX never carries the binary of another target.
const bin = join(extension, "bin");
rmSync(bin, { recursive: true, force: true });
mkdirSync(join(bin, target.vsce), { recursive: true });
const packaged = join(bin, target.vsce, target.executable);
copyFileSync(backend, packaged);
if (process.platform !== "win32") {
  chmodSync(packaged, 0o755);
}

const production = { ...process.env, NODE_ENV: "production" };
// Removed first, so the view in the VSIX is the one built now and never one left by an earlier build.
const view = join(extension, "dist", "webview");
rmSync(view, { recursive: true, force: true });
run("pnpm", ["--filter", "@nuget-code/webview", "build"], repository, production);
for (const file of ["main.js", "main.css", "codicon.ttf"]) {
  if (!existsSync(join(view, file))) {
    fail(`The view was not built: ${join(view, file)} is missing.`);
  }
}

run("pnpm", ["exec", "rolldown", "-c"], extension, production);

const version = (JSON.parse(readFileSync(join(extension, "package.json"), "utf8")) as { version: string }).version;
mkdirSync(out, { recursive: true });
const vsix = join(out, `nuget-code-${target.vsce}-${version}.vsix`);
const quoted = process.platform === "win32" ? `"${vsix}"` : vsix;
run("pnpm", ["exec", "vsce", "package", "--target", target.vsce, "--no-dependencies", "--out", quoted], extension);

console.log(`${vsix} (${(statSync(vsix).size / 1024 / 1024).toFixed(1)} MB)`);
