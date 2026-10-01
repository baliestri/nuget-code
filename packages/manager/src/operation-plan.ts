import type {
  MutationPlan,
  MutationStep,
  UpgradeContext,
  UpgradeEvaluation,
} from "#contracts";
import { executableCandidates } from "#manager/upgrade-policy";
import { normalizeCatalogFeedUrl } from "#manager/package-catalog";
import { parseNuGetVersion } from "#manager/nuget-version";

export function createUpgradePlan(
  id: string,
  context: UpgradeContext,
  evaluation: UpgradeEvaluation,
): MutationPlan {
  const steps = executableCandidates(evaluation).map(
    (candidate): MutationStep => ({
      id: candidate.key,
      kind: "package",
      action: "update",
      packageId: candidate.packageId,
      projectPaths: [candidate.projectPath],
      version: candidate.version,
      feedUrls: [...candidate.feedUrls],
    }),
  );
  return freezeMutationPlan({
    id,
    targetId: context.targetId,
    contextRevision: context.revision,
    steps: steps.sort((a, b) => a.id.localeCompare(b.id)),
  });
}
export function freezeMutationPlan(plan: MutationPlan): MutationPlan {
  return Object.freeze({
    ...plan,
    steps: Object.freeze(
      plan.steps.map((step) =>
        Object.freeze({
          ...step,
          projectPaths: Object.freeze([...step.projectPaths]),
          feedUrls: Object.freeze([...step.feedUrls]),
          ...(step.cachePaths
            ? { cachePaths: Object.freeze([...step.cachePaths]) }
            : {}),
        }),
      ),
    ),
  });
}
function intent(plan: MutationPlan): string {
  const rows = plan.steps.flatMap((step) =>
    (step.kind === "clear-cache"
      ? (step.cachePaths ?? [])
      : step.projectPaths
    ).map((project) =>
      JSON.stringify([
        step.kind,
        step.action,
        step.packageId?.toLowerCase(),
        step.version
          ? (parseNuGetVersion(step.version)?.normalized.toLowerCase() ??
            step.version)
          : null,
        project,
        step.feedUrls.map((url) => normalizeCatalogFeedUrl(url) ?? url).sort(),
      ]),
    ),
  );
  return JSON.stringify([plan.targetId, [...new Set(rows)].sort()]);
}
export function sameMutationIntent(
  left: MutationPlan,
  right: MutationPlan,
): boolean {
  return intent(left) === intent(right);
}
