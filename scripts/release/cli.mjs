import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareRelease } from "./prepare.ts";
import { promoteRelease } from "./promote.ts";
import { syncDevelop } from "./sync.ts";
import { verifyVsix } from "./artifact.ts";
import { assertArtifactMatches, validatePreparedRelease } from "./identity.ts";
import { git, gitSucceeds } from "./git.ts";
import { classifyMarketplace, recoverySteps } from "./recovery.ts";
import {
  classifyGithubRelease,
  createGithubRelease,
  marketplaceHasVersion,
  marketplaceVersions,
  publishMarketplace,
} from "./publish.ts";
import { assertVersionIncreases, parseReleaseVersion } from "./version.ts";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const [action, ...args] = process.argv.slice(2);
const preparedFrom = (artifact) =>
  validatePreparedRelease({
    version: artifact.version,
    sourceSha: artifact.sourceSha,
    branch: `release/v${artifact.version}`,
    tag: `v${artifact.version}`,
  });
const checked = async (file) => {
  const manifestPath = path.resolve(file);
  const artifact = await verifyVsix(manifestPath);
  const prepared = preparedFrom(artifact);
  assertArtifactMatches(prepared, artifact);
  return { manifestPath, artifact, prepared };
};
if (action === "prepare") {
  if (args.length !== 2)
    throw new Error("Usage: cli.mjs prepare <version> <event-sha>");
  parseReleaseVersion(args[0]);
  for (const published of marketplaceVersions(repo)) {
    if (/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(published))
      assertVersionIncreases(args[0], published);
  }
  const prepared = await prepareRelease(repo, args[0], args[1]);
  console.log(JSON.stringify(prepared));
} else if (action === "promote") {
  if (args.length !== 3)
    throw new Error("Usage: cli.mjs promote <manifest> <ci-sha> <package-sha>");
  const { prepared } = await checked(args[0]);
  promoteRelease(repo, prepared, [args[1], args[2]]);
  console.log(`Promoted ${prepared.sourceSha} to main and ${prepared.tag}.`);
} else if (action === "marketplace") {
  if (args.length !== 2)
    throw new Error("Usage: cli.mjs marketplace <manifest> <receipt-path>");
  const { manifestPath, prepared } = await checked(args[0]);
  const receipt = await publishMarketplace(
    repo,
    manifestPath,
    prepared,
    path.resolve(args[1]),
  );
  console.log(JSON.stringify(receipt));
} else if (action === "github") {
  if (args.length !== 2)
    throw new Error("Usage: cli.mjs github <manifest> <receipt-path>");
  const { manifestPath, prepared } = await checked(args[0]);
  await createGithubRelease(
    repo,
    manifestPath,
    prepared,
    path.resolve(args[1]),
  );
  console.log(`GitHub Release ${prepared.tag} verified.`);
} else if (action === "sync") {
  if (args.length !== 1) throw new Error("Usage: cli.mjs sync <manifest>");
  const { prepared } = await checked(args[0]);
  const result = syncDevelop(repo, prepared);
  if (result === "conflict")
    throw new Error(
      "Develop sync has conflicts; published release remains valid.",
    );
  console.log(result);
} else if (action === "plan-recovery") {
  if (args.length !== 2)
    throw new Error(
      "Usage: cli.mjs plan-recovery <manifest> <receipt-or-missing-path>",
    );
  const { manifestPath, artifact, prepared } = await checked(args[0]);
  git(repo, ["fetch", "origin", "main", "develop", prepared.branch, "--tags"]);
  const main = git(repo, ["rev-parse", "origin/main"]);
  const tag = git(
    repo,
    ["rev-parse", `refs/tags/${prepared.tag}^{commit}`],
    true,
  );
  if (
    (tag && tag !== prepared.sourceSha) ||
    (main === prepared.sourceSha && tag !== prepared.sourceSha) ||
    (tag === prepared.sourceSha && main !== prepared.sourceSha)
  )
    throw new Error("Main and tag have conflicting release identities.");
  const receipt = await fs
    .readFile(path.resolve(args[1]), "utf8")
    .then(JSON.parse, () => null);
  const marketplace = classifyMarketplace(
    marketplaceHasVersion(repo, prepared.version),
    receipt,
    prepared,
    artifact,
  );
  const githubRelease = await classifyGithubRelease(
    repo,
    manifestPath,
    prepared,
  );
  const developContainsRelease = gitSucceeds(repo, [
    "merge-base",
    "--is-ancestor",
    prepared.sourceSha,
    "origin/develop",
  ]);
  const steps = recoverySteps({
    promoted: tag === prepared.sourceSha && main === prepared.sourceSha,
    marketplace,
    githubRelease,
    developContainsRelease,
  });
  console.log(JSON.stringify({ artifact, steps }));
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      `source_sha=${prepared.sourceSha}\nversion=${prepared.version}\n${["promote", "publish-marketplace", "create-github-release", "sync"].map((step) => `${step.replaceAll("-", "_")}=${steps.includes(step)}`).join("\n")}\n`,
    );
  }
} else {
  throw new Error("Unknown release action.");
}
