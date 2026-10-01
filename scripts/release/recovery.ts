import type { ReleaseArtifact } from "./artifact.ts";
import { assertArtifactMatches, type PreparedRelease } from "./identity.ts";

export interface ReleaseProgress {
  promoted: boolean;
  marketplace: "absent" | "verified" | "ambiguous";
  openVsx: "absent" | "verified" | "ambiguous";
  githubRelease: "absent" | "verified" | "conflicting";
  developContainsRelease: boolean;
}
export type RecoveryStep =
  | "promote"
  | "publish-marketplace"
  | "publish-openvsx"
  | "create-github-release"
  | "sync";

export function recoverySteps(
  progress: ReleaseProgress,
): readonly RecoveryStep[] {
  if (progress.marketplace === "ambiguous")
    throw new Error(
      "Marketplace version exists without matching publication evidence; verify manually.",
    );
  if (progress.openVsx === "ambiguous")
    throw new Error(
      "Open VSX version exists without matching publication evidence; verify manually.",
    );
  if (progress.githubRelease === "conflicting")
    throw new Error("GitHub Release identity or assets conflict.");
  if (
    !progress.promoted &&
    (progress.marketplace === "verified" ||
      progress.openVsx === "verified" ||
      progress.githubRelease === "verified" ||
      progress.developContainsRelease)
  )
    throw new Error("Publication state conflicts with the release tag.");
  if (
    progress.githubRelease === "verified" &&
    (progress.marketplace !== "verified" || progress.openVsx !== "verified")
  )
    throw new Error(
      "GitHub Release exists before both registry publications are verified.",
    );
  const steps: RecoveryStep[] = [];
  if (!progress.promoted) steps.push("promote");
  if (progress.marketplace === "absent") steps.push("publish-marketplace");
  if (progress.openVsx === "absent") steps.push("publish-openvsx");
  if (progress.githubRelease === "absent") steps.push("create-github-release");
  if (!progress.developContainsRelease) steps.push("sync");
  return steps;
}

export interface PublicationReceipt {
  version: string;
  sourceSha: string;
  sha256: string;
  runId: string;
  runAttempt: number;
}

export function validateReceipt(
  value: unknown,
  prepared: PreparedRelease,
  artifact: ReleaseArtifact,
  registry = "Marketplace",
): PublicationReceipt {
  assertArtifactMatches(prepared, artifact);
  if (!value || typeof value !== "object")
    throw new Error(`Missing ${registry} publication receipt.`);
  const receipt = value as Record<string, unknown>;
  if (
    receipt.version !== prepared.version ||
    receipt.sourceSha !== prepared.sourceSha ||
    receipt.sha256 !== artifact.sha256 ||
    receipt.runId !== artifact.runId ||
    receipt.runAttempt !== artifact.runAttempt
  )
    throw new Error(`${registry} receipt does not match original artifact.`);
  return receipt as unknown as PublicationReceipt;
}

export function classifyMarketplace(
  versionPresent: boolean,
  receipt: unknown,
  prepared: PreparedRelease,
  artifact: ReleaseArtifact,
): ReleaseProgress["marketplace"] {
  return classifyPublication(
    "Marketplace",
    versionPresent,
    receipt,
    prepared,
    artifact,
  );
}

export function classifyOpenVsx(
  versionPresent: boolean,
  receipt: unknown,
  prepared: PreparedRelease,
  artifact: ReleaseArtifact,
): ReleaseProgress["openVsx"] {
  return classifyPublication(
    "Open VSX",
    versionPresent,
    receipt,
    prepared,
    artifact,
  );
}

function classifyPublication(
  registry: string,
  versionPresent: boolean,
  receipt: unknown,
  prepared: PreparedRelease,
  artifact: ReleaseArtifact,
): "absent" | "verified" | "ambiguous" {
  if (!versionPresent) {
    if (receipt)
      throw new Error(
        `Publication receipt exists but ${registry} version is absent.`,
      );
    return "absent";
  }
  if (!receipt) return "ambiguous";
  validateReceipt(receipt, prepared, artifact, registry);
  return "verified";
}
