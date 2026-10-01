import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sha256, verifyVsix } from "./artifact.ts";
import {
  assertArtifactMatches,
  validatePreparedRelease,
  type PreparedRelease,
} from "./identity.ts";
import {
  classifyMarketplace,
  validateReceipt,
  type PublicationReceipt,
} from "./recovery.ts";
import { git } from "./git.ts";

export function command(
  executable: string,
  args: string[],
  cwd: string,
  allowFailure = false,
): string {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32" && executable === "pnpm",
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure)
    throw new Error(`${executable} ${args[0]} failed: ${result.stderr.trim()}`);
  return result.status === 0 ? result.stdout.trim() : "";
}

export function marketplaceVersions(repo: string): readonly string[] {
  const output = command(
    "pnpm",
    [
      "--dir",
      "packages/extension",
      "exec",
      "vsce",
      "show",
      "baliestri.nuget-code",
      "--json",
    ],
    repo,
  );
  const info = JSON.parse(output) as { versions?: { version: string }[] };
  if (!Array.isArray(info.versions))
    throw new Error("Marketplace version list unavailable.");
  return info.versions.map((item) => item.version);
}

export function marketplaceHasVersion(repo: string, version: string): boolean {
  return marketplaceVersions(repo).includes(version);
}

export async function publishMarketplace(
  repo: string,
  manifestPath: string,
  prepared: PreparedRelease,
  receiptPath: string,
): Promise<PublicationReceipt> {
  const artifact = await verifyVsix(manifestPath);
  assertArtifactMatches(prepared, artifact);
  const existing = (await fs
    .readFile(receiptPath, "utf8")
    .then(JSON.parse, () => null)) as unknown;
  const state = classifyMarketplace(
    marketplaceHasVersion(repo, artifact.version),
    existing,
    prepared,
    artifact,
  );
  if (state === "verified")
    return validateReceipt(existing, prepared, artifact);
  if (state === "ambiguous")
    throw new Error(
      "Marketplace version exists without matching receipt; publication outcome is ambiguous.",
    );
  const vsixPath = path.join(path.dirname(manifestPath), artifact.vsixName);
  command(
    "pnpm",
    [
      "--dir",
      "packages/extension",
      "exec",
      "vsce",
      "publish",
      "--packagePath",
      vsixPath,
    ],
    repo,
  );
  if (!marketplaceHasVersion(repo, artifact.version))
    throw new Error("Marketplace did not confirm the published version.");
  const receipt = {
    version: artifact.version,
    sourceSha: artifact.sourceSha,
    sha256: artifact.sha256,
    runId: artifact.runId,
    runAttempt: artifact.runAttempt,
  };
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export async function classifyGithubRelease(
  repo: string,
  manifestPath: string,
  prepared: PreparedRelease,
): Promise<"absent" | "verified" | "conflicting"> {
  validatePreparedRelease(prepared);
  const artifact = await verifyVsix(manifestPath);
  assertArtifactMatches(prepared, artifact);
  const tag = git(repo, [
    "ls-remote",
    "origin",
    `refs/tags/${prepared.tag}`,
  ]).split(/\s/)[0];
  if (tag && tag !== prepared.sourceSha) return "conflicting";
  const view = spawnSync(
    "gh",
    ["release", "view", prepared.tag, "--json", "tagName,assets"],
    { cwd: repo, encoding: "utf8", shell: false },
  );
  if (view.error) throw view.error;
  if (view.status !== 0) {
    if (/release not found|HTTP 404/i.test(view.stderr)) return "absent";
    throw new Error(`Cannot inspect GitHub Release: ${view.stderr.trim()}`);
  }
  const output = view.stdout.trim();
  const release = JSON.parse(output) as {
    tagName: string;
    assets: { name: string }[];
  };
  if (
    release.tagName !== prepared.tag ||
    !tag ||
    !release.assets.some((item) => item.name === artifact.vsixName) ||
    !release.assets.some((item) => item.name === "artifact.json")
  )
    return "conflicting";
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-release-check-"));
  try {
    command(
      "gh",
      [
        "release",
        "download",
        prepared.tag,
        "--pattern",
        artifact.vsixName,
        "--dir",
        temp,
      ],
      repo,
    );
    command(
      "gh",
      [
        "release",
        "download",
        prepared.tag,
        "--pattern",
        "artifact.json",
        "--dir",
        temp,
      ],
      repo,
    );
    if ((await sha256(path.join(temp, artifact.vsixName))) !== artifact.sha256)
      return "conflicting";
    const attached = JSON.parse(
      await fs.readFile(path.join(temp, "artifact.json"), "utf8"),
    );
    return JSON.stringify(attached) === JSON.stringify(artifact)
      ? "verified"
      : "conflicting";
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

export async function createGithubRelease(
  repo: string,
  manifestPath: string,
  prepared: PreparedRelease,
  receiptPath: string,
): Promise<void> {
  const artifact = await verifyVsix(manifestPath);
  assertArtifactMatches(prepared, artifact);
  validateReceipt(
    JSON.parse(await fs.readFile(receiptPath, "utf8")),
    prepared,
    artifact,
  );
  const state = await classifyGithubRelease(repo, manifestPath, prepared);
  if (state === "verified") return;
  if (state === "conflicting")
    throw new Error(
      "Existing GitHub Release conflicts with the validated VSIX.",
    );
  if (
    git(repo, ["ls-remote", "origin", `refs/tags/${prepared.tag}`]).split(
      /\s/,
    )[0] !== prepared.sourceSha
  )
    throw new Error("Remote release tag does not match prepared SHA.");
  const dir = path.dirname(manifestPath);
  const checksum = path.join(dir, "SHA256SUMS");
  const notes = path.join(dir, "release-notes.md");
  await fs.writeFile(checksum, `${artifact.sha256}  ${artifact.vsixName}\n`);
  await fs.writeFile(
    notes,
    `NuGet Manager ${artifact.version}\n\nRequires VS Code 1.100.0 or newer. Supports .NET SDK 8, 9 and 10. This release includes the verified package manager, sources editor and update behavior.\n\nSource commit: ${artifact.sourceSha}\n`,
  );
  command(
    "gh",
    [
      "release",
      "create",
      prepared.tag,
      "--verify-tag",
      "--title",
      prepared.tag,
      "--notes-file",
      notes,
      path.join(dir, artifact.vsixName),
      checksum,
      manifestPath,
    ],
    repo,
  );
  if (
    (await classifyGithubRelease(repo, manifestPath, prepared)) !== "verified"
  )
    throw new Error(
      "GitHub Release assets did not match the validated artifact.",
    );
}
