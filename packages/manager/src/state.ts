import type { LogEntry, PackageManagerState } from "#contracts";
import { allFeeds } from "#manager/constants";
import type { PackageManagerDefaults } from "#manager/types";

export function createReadFlowStates(): PackageManagerState["flows"] {
  return {
    inventory: { status: "idle", stale: false, error: null },
    search: { status: "idle", stale: false, error: null },
    catalog: { status: "idle", stale: false, error: null },
    details: { status: "idle", stale: false, error: null },
  };
}

export function createInitialPackageManagerState(
  defaults: PackageManagerDefaults,
  logs: LogEntry[],
): PackageManagerState {
  return {
    flows: createReadFlowStates(),
    activeTab: "packages",
    targets: [],
    selectedTargetId: "",
    feeds: [allFeeds],
    selectedFeedId: defaults.defaultFeed,
    includePrerelease: defaults.includePrerelease,
    search: "",
    installedPackages: [],
    installedPackagesStatus: "idle",
    implicitPackages: [],
    implicitPackagesStatus: "idle",
    availablePackages: [],
    sources: [],
    folders: [],
    logs,
    hasUpgrades: false,
  };
}

export function createEmptyPackageManagerState(): PackageManagerState {
  return {
    flows: createReadFlowStates(),
    activeTab: "packages",
    targets: [],
    selectedTargetId: "",
    feeds: [],
    selectedFeedId: "",
    includePrerelease: false,
    search: "",
    installedPackages: [],
    installedPackagesStatus: "idle",
    implicitPackages: [],
    implicitPackagesStatus: "idle",
    availablePackages: [],
    sources: [],
    folders: [],
    logs: [],
    hasUpgrades: false,
  };
}
