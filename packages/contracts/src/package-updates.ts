/** One evaluated package reference in one project/framework. */
export interface InstalledReference {
  referenceId: string;
  packageId: string;
  projectPath: string;
  framework: string;
  requestedVersion: string | null;
  resolvedVersion: string | null;
  direct: boolean;
  declarationPath: string | null;
  affectedProjectPaths: readonly string[];
}

export interface CatalogVersion {
  version: string;
  feedUrls: readonly string[];
  /** Listing status applies to every feed in this entry, not other sources. */
  listed: boolean;
}

export interface PackageCatalog {
  iconUrl?: string | undefined;
  packageId: string;
  versions: readonly CatalogVersion[];
  complete: boolean;
  revision: string;
}

export type CompatibilityResult =
  | { status: "compatible"; diagnostics: readonly string[] }
  | { status: "incompatible"; diagnostics: readonly string[] }
  | { status: "unverified"; reason: string; diagnostics: readonly string[] };

export interface CompatibilityEvidence {
  contextRevision: string;
  result: CompatibilityResult;
}

/** Evidence for the exact host-prepared edit intent; required by the mutation executor. */
export interface PlannedCompatibilityEvidence extends CompatibilityEvidence {
  candidateKey: string;
  planRevision: string;
}

export interface UpgradeContext {
  targetId: string;
  projectPaths: readonly string[];
  feedUrls: readonly string[];
  includePrerelease: boolean;
  revision: string;
}

export interface UpgradeCandidate {
  key: string;
  packageId: string;
  projectPath: string;
  referenceIds: readonly string[];
  version: string;
  feedUrls: readonly string[];
  compatibility: CompatibilityResult;
}

export interface UpgradeBlock {
  packageId: string;
  projectPath: string;
  reason:
    | "invalid-version"
    | "incomplete-catalog"
    | "shared-scope"
    | "no-upgrade"
    | "incompatible"
    | "unverified";
}

/** Internal policy input; serialize evidence explicitly at message boundaries. */
export interface UpgradeInput {
  inventory: readonly InstalledReference[];
  catalogs: readonly PackageCatalog[];
  context: UpgradeContext;
  evidence: ReadonlyMap<string, CompatibilityEvidence>;
}

export interface UpgradeEvaluation {
  candidates: readonly UpgradeCandidate[];
  blocked: readonly UpgradeBlock[];
}

/** Facts captured together, independent of the current search or preview filter. */
export interface InventorySnapshot {
  targetId: string;
  projectPaths: readonly string[];
  revision: string;
  references: readonly InstalledReference[];
  projectRevisions: Readonly<Record<string, string | null>>;
  inputPaths: readonly string[];
}

export interface UpdateProjection {
  context: UpgradeContext;
  evaluation: UpgradeEvaluation;
}
