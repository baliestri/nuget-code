import type {
  NuGetPackageItem,
  PackageManagerState,
  InventorySnapshot,
  UpdateProjection,
} from "#contracts";
import { mergeInstalled, replacePackage } from "#manager/merge";
import { executableCandidates } from "#manager/upgrade-policy";

export function applyUpdateProjection(
  state: PackageManagerState,
  updates: UpdateProjection,
): PackageManagerState {
  return {
    ...state,
    updates,
    hasUpgrades: executableCandidates(updates.evaluation).length > 0,
  };
}
export function referenceInventory(snapshot: InventorySnapshot): {
  installed: NuGetPackageItem[];
  implicit: NuGetPackageItem[];
} {
  const items = (direct: boolean) =>
    mergeInstalled(
      snapshot.references
        .filter(
          (reference) =>
            reference.direct === direct &&
            snapshot.projectPaths.includes(reference.projectPath),
        )
        .map(
          (reference): NuGetPackageItem => ({
            id: `${reference.projectPath}:${direct ? "" : "implicit:"}${reference.framework}:${reference.packageId}`,
            name: reference.packageId,
            installedVersion: reference.resolvedVersion ?? undefined,
            projectPaths: [reference.projectPath],
            projectStates: [
              {
                projectPath: reference.projectPath,
                installedVersion: reference.resolvedVersion ?? undefined,
                implicit: !direct,
              },
            ],
            versions: reference.resolvedVersion
              ? [{ version: reference.resolvedVersion, source: "Installed" }]
              : [],
            dependencyGroups: [],
            implicit: !direct,
          }),
        ),
    );
  return { installed: items(true), implicit: items(false) };
}

/** Details are presentation metadata, never a writer of installed facts or automatic candidates. */
export function presentPackageDetails(
  base: NuGetPackageItem,
  details: NuGetPackageItem,
): NuGetPackageItem {
  return {
    ...details,
    id: base.id,
    name: base.name,
    installedVersion: base.installedVersion,
    availableVersion: base.availableVersion,
    projectPaths: base.projectPaths,
    projectStates: base.projectStates,
    implicit: base.implicit,
  };
}

export function applyPackageDetails(
  state: PackageManagerState,
  packageItem: NuGetPackageItem,
): PackageManagerState {
  return {
    ...state,
    availablePackages: replacePackage(state.availablePackages, packageItem),
  };
}

export function applyPackageInventory(
  state: PackageManagerState,
  inventory: {
    installed: NuGetPackageItem[];
    implicit: NuGetPackageItem[];
  },
  availablePackages: NuGetPackageItem[],
): PackageManagerState {
  return {
    ...state,
    installedPackages: inventory.installed,
    installedPackagesStatus: "ready",
    implicitPackages: inventory.implicit,
    implicitPackagesStatus: "ready",
    availablePackages,
    selectedPackageId: state.selectedPackageId,
    hasUpgrades: executableCandidates(state.updates.evaluation).length > 0,
  };
}

export function applyAvailablePackages(
  state: PackageManagerState,
  availablePackages: NuGetPackageItem[],
): PackageManagerState {
  return {
    ...state,
    availablePackages,
    selectedPackageId: state.selectedPackageId,
  };
}
