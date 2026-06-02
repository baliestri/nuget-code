import type { NuGetPackageItem, PackageManagerState } from "#contracts";
import { applyAvailablePackageMetadata, replacePackage } from "#manager/merge";

export function applyPackageDetails(
  state: PackageManagerState,
  packageItem: NuGetPackageItem,
): PackageManagerState {
  return {
    ...state,
    installedPackages: replacePackage(state.installedPackages, packageItem),
    implicitPackages: replacePackage(state.implicitPackages, packageItem),
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
    installedPackages: applyAvailablePackageMetadata(
      inventory.installed,
      availablePackages,
    ),
    installedPackagesStatus: "ready",
    implicitPackages: applyAvailablePackageMetadata(
      inventory.implicit,
      availablePackages,
    ),
    implicitPackagesStatus: "ready",
    availablePackages,
    selectedPackageId: state.selectedPackageId,
    hasUpgrades: inventory.installed.some((item) => item.availableVersion),
  };
}

export function applyAvailablePackages(
  state: PackageManagerState,
  availablePackages: NuGetPackageItem[],
): PackageManagerState {
  return {
    ...state,
    installedPackages: applyAvailablePackageMetadata(
      state.installedPackages,
      availablePackages,
    ),
    implicitPackages: applyAvailablePackageMetadata(
      state.implicitPackages,
      availablePackages,
    ),
    availablePackages,
    selectedPackageId: state.selectedPackageId,
  };
}
