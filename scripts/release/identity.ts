import { parseReleaseVersion } from "./version.ts";
import type { ReleaseArtifact } from "./artifact.ts";

const fullSha = /^[0-9a-f]{40}$/;
export interface PreparedRelease {
  version: string;
  sourceSha: string;
  branch: string;
  tag: string;
}

export function validatePreparedRelease(value: unknown): PreparedRelease {
  if (!value || typeof value !== "object")
    throw new Error("Missing prepared release.");
  const item = value as Record<string, unknown>;
  if (typeof item.version !== "string")
    throw new Error("Missing release version.");
  parseReleaseVersion(item.version);
  if (typeof item.sourceSha !== "string" || !fullSha.test(item.sourceSha))
    throw new Error("Invalid release SHA.");
  if (
    item.branch !== `release/v${item.version}` ||
    item.tag !== `v${item.version}`
  )
    throw new Error("Release branch or tag differs from version.");
  return item as unknown as PreparedRelease;
}

export function assertArtifactMatches(
  prepared: PreparedRelease,
  artifact: ReleaseArtifact,
): void {
  validatePreparedRelease(prepared);
  if (
    artifact.version !== prepared.version ||
    artifact.sourceSha !== prepared.sourceSha
  )
    throw new Error("Artifact does not match prepared release.");
}

export function assertPromotion(input: {
  prepared: PreparedRelease;
  checkedOutSha: string;
  branchSha: string;
  mainIsAncestor: boolean;
  tagSha: string | null;
  gateShas: readonly string[];
}): void {
  const prepared = validatePreparedRelease(input.prepared);
  if (
    input.checkedOutSha !== prepared.sourceSha ||
    input.branchSha !== prepared.sourceSha
  )
    throw new Error("Prepared branch or checkout moved.");
  if (!input.mainIsAncestor)
    throw new Error("Main diverged; fast-forward promotion is unavailable.");
  if (input.tagSha && input.tagSha !== prepared.sourceSha)
    throw new Error("Release tag points to another SHA.");
  if (
    input.gateShas.length < 2 ||
    input.gateShas.some((sha) => sha !== prepared.sourceSha)
  )
    throw new Error("Release gates did not validate the prepared SHA.");
}
