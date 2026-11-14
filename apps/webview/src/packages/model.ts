import {
  PackageChangeKinds,
  type PackageChangeParams,
  type PackagesInstalledResult,
  type PackagesUpdatesResult,
  type ProjectInfo
} from "@nuget-code/protocol";
import { compareVersionTexts, isNewer, isPrerelease, newestVersion, parseVersion } from "../lib/nugetVersion";

/** One project's use of a package. */
export interface PackageUse {
  path: string;
  name: string;
  /** The version the project asks for, as written: a version, a range or a floating version. */
  requested?: string;
  /** The version the last restore resolved. */
  resolved?: string;
  restored: boolean;
  implicit: boolean;
}

/** One line of the installed list: a package, across the projects of the target that use it. */
export interface PackageRow {
  id: string;
  /** The versions in use, oldest first, without repetition. */
  versions: readonly string[];
  projects: readonly PackageUse[];
  /** Added by the SDK in every project that has it: there is no declaration to change. */
  implicit: boolean;
  restored: boolean;
  /** The newest version on the feeds considered. */
  latest?: string;
  hasUpdate: boolean;
}

export interface RowsInput {
  installed: PackagesInstalledResult;
  projects: readonly ProjectInfo[];
  /** A project path, or `null` for the whole solution. */
  target: string | null;
  updates?: PackagesUpdatesResult | undefined;
  /** A feed name, or `null` for every feed. */
  feed: string | null;
  prerelease: boolean;
}

const sameText = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

/** The installed packages of the target, one row per package id. */
export function buildRows(input: RowsInput): PackageRow[] {
  const byId = new Map<string, { id: string; uses: PackageUse[] }>();
  for (const project of input.installed.projects) {
    if (input.target !== null && !sameText(project.projectPath, input.target)) {
      continue;
    }

    const name =
      input.projects.find((item) => sameText(item.path, project.projectPath))?.name ?? baseName(project.projectPath);
    for (const item of project.packages) {
      const key = item.id.toLowerCase();
      const entry = byId.get(key) ?? { id: item.id, uses: [] };
      byId.set(key, entry);
      entry.uses.push({
        path: project.projectPath,
        name,
        restored: item.restored,
        implicit: item.implicit,
        ...(item.requestedVersion === undefined ? {} : { requested: item.requestedVersion }),
        ...(item.resolvedVersion === undefined ? {} : { resolved: item.resolvedVersion })
      });
    }
  }

  return [...byId.values()].map(({ id, uses }) => {
    const implicit = uses.every((use) => use.implicit);
    const latest = latestOf(id, input);
    const versions = [...new Set(uses.map(shownVersion).filter((version) => version !== undefined))].sort(
      compareVersionTexts
    );
    return {
      id,
      versions,
      projects: uses,
      implicit,
      restored: uses.every((use) => use.restored),
      ...(latest === undefined ? {} : { latest }),
      hasUpdate: !implicit && latest !== undefined && uses.some((use) => isOutdated(use, latest))
    };
  });
}

/** What a project's line shows as its version: what was restored, else what the project asks for. */
export function shownVersion(use: PackageUse): string | undefined {
  return use.resolved ?? use.requested;
}

/**
 * The version a project is compared by: the resolved one, else the requested one when it is a plain
 * version. A range or floating version that was never restored cannot be compared.
 */
function comparableVersion(use: PackageUse): string | undefined {
  if (use.resolved !== undefined) {
    return use.resolved;
  }

  return use.requested !== undefined && parseVersion(use.requested) !== undefined ? use.requested : undefined;
}

function isOutdated(use: PackageUse, latest: string): boolean {
  const current = comparableVersion(use);
  return !use.implicit && current !== undefined && isNewer(latest, current);
}

function latestOf(id: string, input: RowsInput): string | undefined {
  const known = input.updates?.packages.find((item) => sameText(item.id, id));
  if (known === undefined) {
    return undefined;
  }

  return newestVersion(
    known.versions
      .filter((item) => input.feed === null || sameText(item.feed, input.feed))
      .map((item) => item.version)
      .filter((version) => input.prerelease || !isPrerelease(version))
  );
}

function baseName(path: string): string {
  const file = path.split(/[\\/]/).at(-1) ?? path;
  return file.replace(/\.[^.]+$/, "");
}

const byId = (left: PackageRow, right: PackageRow): number => {
  const a = left.id.toLowerCase();
  const b = right.id.toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
};

/** Smart puts the packages that have an update first; both orders are alphabetical within that. */
export function sortRows(rows: readonly PackageRow[], mode: "smart" | "alphabetical"): PackageRow[] {
  return [...rows].sort((left, right) =>
    mode === "smart" && left.hasUpdate !== right.hasUpdate ? (left.hasUpdate ? -1 : 1) : byId(left, right)
  );
}

export function filterRows(rows: readonly PackageRow[], query: string): PackageRow[] {
  const text = query.trim().toLowerCase();
  return text === "" ? [...rows] : rows.filter((row) => row.id.toLowerCase().includes(text));
}

/** One update per selected package, to its newest version, in every project of the target that declares it. */
export function updateChanges(rows: readonly PackageRow[], selected: ReadonlySet<string>): PackageChangeParams[] {
  return rows
    .filter((row) => selected.has(row.id) && row.latest !== undefined && !row.implicit)
    .map((row) => ({
      kind: PackageChangeKinds.update,
      id: row.id,
      version: row.latest!,
      projects: row.projects.filter((use) => !use.implicit).map((use) => use.path)
    }));
}

export interface TargetOption {
  /** A project path, or `null` for the whole solution. */
  value: string | null;
  label: string;
  /** How many packages the project declares; absent for the solution. */
  count?: number;
  /** Why the project cannot be selected: it could not be evaluated. */
  error?: string;
}

/** The choices of the target selector: the solution, then each project with its package count. */
export function targetOptions(
  projects: readonly ProjectInfo[],
  installed: PackagesInstalledResult | undefined
): TargetOption[] {
  return [
    { value: null, label: "Solution" },
    ...projects.map((project) => {
      const packages = installed?.projects.find((item) => sameText(item.projectPath, project.path))?.packages ?? [];
      return {
        value: project.path,
        label: project.name,
        count: packages.filter((item) => !item.implicit).length,
        ...(project.error === undefined ? {} : { error: project.error })
      };
    })
  ];
}
