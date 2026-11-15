import {
  AdvisorySeverities,
  type AdvisoryInfo,
  type AdvisorySeverity,
  type PackagesVulnerabilitiesResult
} from "@nuget-code/protocol";

const RANK: Record<AdvisorySeverity, number> = {
  [AdvisorySeverities.critical]: 4,
  [AdvisorySeverities.high]: 3,
  [AdvisorySeverities.moderate]: 2,
  [AdvisorySeverities.low]: 1,
  [AdvisorySeverities.unknown]: 0
};

/** The known vulnerabilities of the resolved packages, to be asked by package id and version. */
export type AdvisoryIndex = ReadonlyMap<string, readonly AdvisoryInfo[]>;

const keyOf = (id: string, version: string): string => `${id.toLowerCase()}|${version.toLowerCase()}`;

export function advisoryIndex(result: PackagesVulnerabilitiesResult | undefined): AdvisoryIndex {
  return new Map((result?.packages ?? []).map((item) => [keyOf(item.id, item.version), item.advisories]));
}

/** The advisories about a package in any of the given versions, each once, the worst first. */
export function advisoriesFor(index: AdvisoryIndex, id: string, versions: readonly string[]): AdvisoryInfo[] {
  const found = new Map<string, AdvisoryInfo>();
  for (const version of versions) {
    for (const advisory of index.get(keyOf(id, version)) ?? []) {
      found.set(advisory.url, advisory);
    }
  }

  return [...found.values()].sort(
    (left, right) => RANK[right.severity] - RANK[left.severity] || left.url.localeCompare(right.url)
  );
}

/** The worst severity among advisories; undefined when there is none. */
export function highestSeverity(advisories: readonly AdvisoryInfo[]): AdvisorySeverity | undefined {
  return advisories.reduce<AdvisorySeverity | undefined>(
    (worst, advisory) => (worst === undefined || RANK[advisory.severity] > RANK[worst] ? advisory.severity : worst),
    undefined
  );
}

/** High and critical are shown as errors; the rest as warnings. */
export function isSevere(severity: AdvisorySeverity): boolean {
  return RANK[severity] >= RANK[AdvisorySeverities.high];
}

/** What the shield of a package line says: how many advisories there are and how bad the worst is. */
export function shieldOf(advisories: readonly AdvisoryInfo[]): { label: string; severe: boolean } | undefined {
  const worst = highestSeverity(advisories);
  if (worst === undefined) {
    return undefined;
  }

  return {
    label:
      advisories.length === 1
        ? `1 known vulnerability (${worst})`
        : `${advisories.length} known vulnerabilities, the worst is ${worst}`,
    severe: isSevere(worst)
  };
}

/** A short name for an advisory, to tell one from another in a list: the last part of its address. */
export function advisoryName(advisory: AdvisoryInfo): string {
  const parts = advisory.url.split(/[/?#]/).filter((part) => part !== "");
  return parts.at(-1) ?? advisory.url;
}
