import type {
  NuGetConfigFile,
  NuGetPackageItem,
  PackageManagerState,
  WorkspaceTarget,
} from "#contracts";
import { mergeAvailableFeeds } from "#manager/merge";

export function selectedTarget(
  state: PackageManagerState,
): WorkspaceTarget | undefined {
  return state.targets.find((target) => target.id === state.selectedTargetId);
}

export const getSelectedTarget = selectedTarget;

export function selectedPackage(
  state: PackageManagerState,
  packageId = state.selectedPackageId,
): NuGetPackageItem | undefined {
  const packages = [
    ...state.installedPackages,
    ...state.implicitPackages,
    ...state.availablePackages,
  ];
  const selected = packages.find((item) => item.id === packageId);
  if (!selected) {
    return undefined;
  }

  const installed = state.installedPackages.find(
    (item) => item.name.toLowerCase() === selected.name.toLowerCase(),
  );
  if (!installed || installed.id === selected.id) {
    return selected;
  }

  return {
    ...selected,
    installedVersion: installed.installedVersion,
    projectPaths: installed.projectPaths,
    projectStates: installed.projectStates,
    availableFeeds: mergeAvailableFeeds(
      selected.availableFeeds,
      installed.availableFeeds,
    ),
  };
}

export const getSelectedPackage = selectedPackage;

export function selectedSource(
  state: PackageManagerState,
): NuGetConfigFile | undefined {
  return state.sources.find((source) => source.id === state.selectedSourceId);
}
