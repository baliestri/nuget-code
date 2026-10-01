import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  sha256,
  validateArtifactIdentity,
  verifyVsix,
} from "./release/artifact.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = path.join(root, "packages", "extension");
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key?.startsWith("--") || !value || args.has(key))
    throw new Error("Invalid build-vsix arguments.");
  args.set(key, value);
}
if (args.size !== 2 || !args.has("--version") || !args.has("--source-sha"))
  throw new Error(
    "Usage: build-vsix.mjs --version X.Y.Z --source-sha <40-hex>",
  );
const requestedVersion = args.get("--version");
const requestedSha = args.get("--source-sha");
const output = path.join(root, "release-artifacts");
const vsixName = `nuget-code-${requestedVersion}-${requestedSha}.vsix`;
validateArtifactIdentity({
  version: requestedVersion,
  sourceSha: requestedSha,
  vsixName,
  sha256: "0".repeat(64),
  runId: process.env.GITHUB_RUN_ID || "1",
  runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT || "1"),
});
const git = (...argv) =>
  execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== requestedSha)
  throw new Error("Checkout differs from requested source SHA.");
if (git("status", "--porcelain"))
  throw new Error("Release packaging requires a clean checkout.");
const manifest = JSON.parse(
  await fs.readFile(path.join(extension, "package.json"), "utf8"),
);
if (manifest.version !== requestedVersion)
  throw new Error("Extension version differs from requested version.");
// VSCE invokes vscode:prepublish once. Force Turbo's build cache off because the
// webview writes into the host package's dist directory, outside its own outputs.
await fs.rm(path.join(extension, "dist"), { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
execFileSync(
  "pnpm",
  [
    "exec",
    "vsce",
    "package",
    "--no-dependencies",
    "--out",
    path.join(output, vsixName),
  ],
  {
    cwd: extension,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, NODE_ENV: "production" },
  },
);
const artifact = validateArtifactIdentity({
  version: requestedVersion,
  sourceSha: requestedSha,
  vsixName,
  sha256: await sha256(path.join(output, vsixName)),
  runId: process.env.GITHUB_RUN_ID || "1",
  runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT || "1"),
});
const manifestPath = path.join(output, "artifact.json");
await fs.writeFile(manifestPath, `${JSON.stringify(artifact, null, 2)}\n`);
await verifyVsix(manifestPath);
console.log(manifestPath);
