import { git, gitSucceeds } from "./git.ts";
import { assertPromotion, type PreparedRelease } from "./identity.ts";

export function promoteRelease(
  repo: string,
  prepared: PreparedRelease,
  gateShas: readonly string[],
): void {
  git(repo, ["fetch", "origin", "main", prepared.branch, "--tags"]);
  const tagSha =
    git(repo, ["rev-parse", `refs/tags/${prepared.tag}^{commit}`], true) ||
    null;
  assertPromotion({
    prepared,
    checkedOutSha: git(repo, ["rev-parse", "HEAD"]),
    branchSha: git(repo, [
      "rev-parse",
      `refs/remotes/origin/${prepared.branch}`,
    ]),
    mainIsAncestor: gitSucceeds(repo, [
      "merge-base",
      "--is-ancestor",
      "origin/main",
      prepared.sourceSha,
    ]),
    tagSha,
    gateShas,
  });
  if (!tagSha) git(repo, ["tag", prepared.tag, prepared.sourceSha]);
  git(repo, [
    "push",
    "--atomic",
    "origin",
    `${prepared.sourceSha}:refs/heads/main`,
    `refs/tags/${prepared.tag}:refs/tags/${prepared.tag}`,
  ]);
}
