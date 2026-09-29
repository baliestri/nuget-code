import type {
  CompatibilityResult,
  InstalledReference,
  UpgradeBlock,
  UpgradeCandidate,
  UpgradeEvaluation,
  UpgradeInput,
} from "#contracts";
import {
  mergeCatalogs,
  normalizeCatalogFeedUrl,
} from "#manager/package-catalog";
import {
  compareNuGetVersions,
  parseNuGetVersion,
} from "#manager/nuget-version";

function ordered(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function candidateKey(
  candidate: Pick<
    UpgradeCandidate,
    "packageId" | "projectPath" | "referenceIds" | "version" | "feedUrls"
  >,
): string {
  const version = parseNuGetVersion(candidate.version);
  if (!version)
    throw new RangeError("A candidate must have a concrete NuGet version.");
  return JSON.stringify([
    candidate.packageId.toLowerCase(),
    candidate.projectPath,
    ordered(candidate.referenceIds),
    version.normalized.toLowerCase(),
    ordered(
      candidate.feedUrls
        .map(normalizeCatalogFeedUrl)
        .filter((url): url is string => url !== undefined),
    ),
  ]);
}

function unverified(reason: string): CompatibilityResult {
  return { status: "unverified", reason, diagnostics: [] };
}

function referenceScope(
  group: readonly InstalledReference[],
  inventory: readonly InstalledReference[],
) {
  const declarations = new Set(
    group.map((r) => r.declarationPath).filter((p): p is string => p !== null),
  );
  const packageId = group[0]!.packageId.toLowerCase();
  const related = inventory.filter(
    (r) =>
      r.direct &&
      r.packageId.toLowerCase() === packageId &&
      (r.projectPath === group[0]!.projectPath ||
        (r.declarationPath !== null && declarations.has(r.declarationPath))),
  );
  const projects = new Set(
    related.flatMap((r) => [r.projectPath, ...r.affectedProjectPaths]),
  );
  const known = related.every(
    (r) =>
      r.declarationPath !== null &&
      r.affectedProjectPaths.includes(r.projectPath) &&
      r.affectedProjectPaths.every((project) =>
        related.some(
          (other) =>
            other.projectPath === project &&
            other.declarationPath === r.declarationPath,
        ),
      ),
  );
  return { references: related, projects, known };
}

/** Pure projection: available versions are never executable without matching evidence. */
export function evaluateUpgrades(input: UpgradeInput): UpgradeEvaluation {
  const selectedProjects = new Set(input.context.projectPaths);
  const selectedFeeds = new Set(
    input.context.feedUrls.map(normalizeCatalogFeedUrl).filter(Boolean),
  );
  const catalogs = new Map(
    mergeCatalogs(input.catalogs).map((c) => [c.packageId, c]),
  );
  const groups = new Map<string, InstalledReference[]>();
  for (const reference of input.inventory) {
    if (!reference.direct || !selectedProjects.has(reference.projectPath))
      continue;
    const key = JSON.stringify([
      reference.packageId.toLowerCase(),
      reference.projectPath,
    ]);
    const group = groups.get(key);
    if (group) group.push(reference);
    else groups.set(key, [reference]);
  }

  const candidates: UpgradeCandidate[] = [];
  const blocked: UpgradeBlock[] = [];
  for (const key of ordered([...groups.keys()])) {
    const group = groups.get(key)!;
    const packageId = group[0]!.packageId.toLowerCase();
    const projectPath = group[0]!.projectPath;
    const block = (reason: UpgradeBlock["reason"]) =>
      blocked.push({ packageId, projectPath, reason });
    const scope = referenceScope(group, input.inventory);
    if ([...scope.projects].some((project) => !selectedProjects.has(project))) {
      block("shared-scope");
      continue;
    }
    if (
      scope.references.some(
        (r) => !r.resolvedVersion || !parseNuGetVersion(r.resolvedVersion),
      )
    ) {
      block("invalid-version");
      continue;
    }
    const catalog = catalogs.get(packageId);
    if (!catalog) {
      block("incomplete-catalog");
      continue;
    }
    const eligible = catalog.versions
      .filter(
        (v) =>
          v.listed &&
          (input.context.includePrerelease ||
            !parseNuGetVersion(v.version)!.prerelease.length),
      )
      .map((v) => ({
        ...v,
        feedUrls: v.feedUrls.filter((url) => selectedFeeds.has(url)),
      }))
      .filter(
        (v) =>
          v.feedUrls.length > 0 &&
          scope.references.every(
            (r) => compareNuGetVersions(v.version, r.resolvedVersion!) > 0,
          ),
      )
      .sort((a, b) => compareNuGetVersions(b.version, a.version));
    let selected = false;
    for (const version of eligible) {
      const candidate: UpgradeCandidate = {
        key: "",
        packageId,
        projectPath,
        referenceIds: ordered(scope.references.map((r) => r.referenceId)),
        version: version.version,
        feedUrls: version.feedUrls,
        compatibility: unverified("compatibility-not-verified"),
      };
      candidate.key = candidateKey(candidate);
      const evidence = input.evidence.get(candidate.key);
      if (!catalog.complete)
        candidate.compatibility = unverified("incomplete-catalog");
      else if (!scope.known)
        candidate.compatibility = unverified("reference-scope-unknown");
      else if (evidence?.contextRevision === input.context.revision)
        candidate.compatibility = evidence.result;
      if (candidate.compatibility.status === "incompatible") continue;
      candidates.push(candidate);
      if (!catalog.complete) block("incomplete-catalog");
      else if (candidate.compatibility.status === "unverified")
        block("unverified");
      selected = true;
      break;
    }
    if (!selected)
      block(
        !catalog.complete
          ? "incomplete-catalog"
          : eligible.length
            ? "incompatible"
            : "no-upgrade",
      );
  }
  return { candidates, blocked };
}

export function executableCandidates(
  evaluation: UpgradeEvaluation,
): readonly UpgradeCandidate[] {
  return evaluation.candidates.filter(
    (candidate) => candidate.compatibility.status === "compatible",
  );
}
