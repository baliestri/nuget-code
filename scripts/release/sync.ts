import { git, gitSucceeds } from "./git.ts";
import { validatePreparedRelease, type PreparedRelease } from "./identity.ts";

export function syncDevelop(
  repo: string,
  prepared: PreparedRelease,
): "already-contained" | "synced" | "conflict" {
  validatePreparedRelease(prepared);
  git(repo, ["fetch", "origin", "develop", "main"]);
  if (git(repo, ["rev-parse", "origin/main"]) !== prepared.sourceSha)
    throw new Error("Main does not point to the release SHA.");
  if (
    gitSucceeds(repo, [
      "merge-base",
      "--is-ancestor",
      prepared.sourceSha,
      "origin/develop",
    ])
  )
    return "already-contained";
  git(repo, ["checkout", "-B", `sync/v${prepared.version}`, "origin/develop"]);
  if (
    !gitSucceeds(repo, ["merge", "--no-ff", "--no-edit", prepared.sourceSha])
  ) {
    git(repo, ["merge", "--abort"], true);
    return "conflict";
  }
  git(repo, ["push", "origin", "HEAD:refs/heads/develop"]);
  return "synced";
}
