import fs from "node:fs/promises";
import path from "node:path";
import { git, gitSucceeds } from "./git.ts";
import { assertVersionIncreases, parseReleaseVersion } from "./version.ts";
import { validatePreparedRelease, type PreparedRelease } from "./identity.ts";

export async function prepareRelease(
  repo: string,
  requested: string,
  eventSha: string,
): Promise<PreparedRelease> {
  const version = parseReleaseVersion(requested);
  if (!/^[0-9a-f]{40}$/.test(eventSha))
    throw new Error("Expected the dispatch commit SHA.");
  git(repo, ["fetch", "origin", "develop", "main", "--tags"]);
  if (git(repo, ["symbolic-ref", "--short", "HEAD"]) !== "develop")
    throw new Error("Release preparation must start on develop.");
  if (git(repo, ["status", "--porcelain"]))
    throw new Error("Release preparation requires a clean tree.");
  const head = git(repo, ["rev-parse", "HEAD"]);
  if (head !== eventSha || git(repo, ["rev-parse", "origin/develop"]) !== head)
    throw new Error("Develop or dispatch SHA moved.");
  if (
    !gitSucceeds(repo, ["merge-base", "--is-ancestor", "origin/main", "HEAD"])
  )
    throw new Error("Main is not an ancestor of develop.");
  const branch = `release/v${version}`;
  const tag = `v${version}`;
  if (
    gitSucceeds(repo, ["show-ref", "--verify", `refs/heads/${branch}`]) ||
    git(repo, ["ls-remote", "--heads", "origin", branch]) ||
    gitSucceeds(repo, ["show-ref", "--verify", `refs/tags/${tag}`])
  )
    throw new Error("Release branch or tag already exists.");
  const manifestPath = path.join(repo, "packages", "extension", "package.json");
  const text = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(text) as { version: string };
  assertVersionIncreases(version, manifest.version);
  git(repo, ["checkout", "-b", branch]);
  const updated = text.replace(
    /("version"\s*:\s*")[^"]+(?=")/,
    (_, prefix: string) => `${prefix}${version}`,
  );
  if (updated === text)
    throw new Error("Extension version field was not updated.");
  await fs.writeFile(manifestPath, updated);
  git(repo, ["add", "--", "packages/extension/package.json"]);
  git(repo, ["commit", "-m", `chore(release): prepare v${version}`]);
  const prepared = validatePreparedRelease({
    version,
    sourceSha: git(repo, ["rev-parse", "HEAD"]),
    branch,
    tag,
  });
  git(repo, ["push", "origin", `HEAD:refs/heads/${branch}`]);
  return prepared;
}
