import type { InstalledReference, NuGetPackageItem } from "#contracts";
import type { PackageInventory } from "#client/package-types";
import {
  readTargetPackageList,
  type PackageInventoryOptions,
} from "#client/package-list-reader";
import {
  compareNuGetVersions,
  mergeInstalled,
  parseNuGetVersion,
  prependVersion,
} from "#manager";

export async function loadInstalledReferences(
  options: PackageInventoryOptions,
): Promise<InstalledReference[]> {
  const listed = await readTargetPackageList(options, false);
  const references: InstalledReference[] = [];
  for (const project of listed.projects ?? []) {
    for (const framework of project.frameworks ?? []) {
      for (const [direct, packages] of [
        [true, framework.topLevelPackages],
        [false, framework.transitivePackages],
      ] as const) {
        for (const item of packages ?? []) {
          references.push({
            referenceId: JSON.stringify([
              project.path,
              framework.framework,
              item.id.toLowerCase(),
              direct,
            ]),
            packageId: item.id,
            projectPath: project.path,
            framework: framework.framework,
            requestedVersion: item.requestedVersion ?? null,
            resolvedVersion: item.resolvedVersion ?? null,
            direct,
            declarationPath: null,
            affectedProjectPaths: [],
          });
        }
      }
    }
  }
  return references;
}

/** Legacy display adapter; new policy consumers use the reference facts above. */
export async function loadListedPackageInventory(
  options: PackageInventoryOptions,
): Promise<PackageInventory> {
  const references = await loadInstalledReferences(options);
  return {
    installed: mergeInstalled(
      references.filter((r) => r.direct).map(toPackageItem),
    ),
    implicit: mergeInstalled(
      references.filter((r) => !r.direct).map(toPackageItem),
    ),
  };
}

function toPackageItem(reference: InstalledReference): NuGetPackageItem {
  const version =
    reference.resolvedVersion ?? reference.requestedVersion ?? undefined;
  const implicit = !reference.direct;
  return {
    id: `${reference.projectPath}:${implicit ? "implicit:" : ""}${reference.framework}:${reference.packageId}`,
    name: reference.packageId,
    projectPaths: [reference.projectPath],
    projectStates: [
      {
        projectPath: reference.projectPath,
        installedVersion: version,
        implicit,
      },
    ],
    installedVersion: version,
    implicit,
    versions: version
      ? [{ version, source: implicit ? "Transitive" : "Installed" }]
      : [],
    dependencyGroups: [],
  };
}

export async function loadPackageInventory(
  options: PackageInventoryOptions,
): Promise<PackageInventory> {
  const [listed, outdated] = await Promise.all([
    loadListedPackageInventory(options),
    loadOutdatedPackageVersions(options),
  ]);
  return applyOutdatedPackageVersions(listed, outdated);
}

export async function loadOutdatedPackageVersions(
  options: PackageInventoryOptions,
): Promise<Map<string, string>> {
  const listed = await readTargetPackageList(options, true);
  const updates = new Map<string, string>();
  for (const project of listed.projects ?? []) {
    for (const framework of project.frameworks ?? []) {
      for (const item of [
        ...(framework.topLevelPackages ?? []),
        ...(framework.transitivePackages ?? []),
      ]) {
        if (!item.latestVersion || !parseNuGetVersion(item.latestVersion))
          continue;
        const key = item.id.toLowerCase();
        const current = updates.get(key);
        if (!current || compareNuGetVersions(item.latestVersion, current) > 0)
          updates.set(key, item.latestVersion);
      }
    }
  }
  return updates;
}

/** Compatibility adapter only: availability is not proof of an executable upgrade. */
export function applyOutdatedPackageVersions(
  inventory: PackageInventory,
  outdated: Map<string, string>,
): PackageInventory {
  return {
    installed: inventory.installed.map((item) => {
      const update = outdated.get(item.name.toLowerCase());
      return update
        ? {
            ...item,
            availableVersion: update,
            versions: prependVersion(item.versions, {
              version: update,
              source: item.sourceName ?? "NuGet",
            }),
          }
        : item;
    }),
    implicit: inventory.implicit,
  };
}
