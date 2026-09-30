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

export function createEmptyUpdateProjection(): PackageManagerState["updates"] {
  return {
    context: {
      targetId: "",
      projectPaths: [],
      feedUrls: [],
      includePrerelease: false,
      revision: "pending",
    },
    evaluation: { candidates: [], blocked: [] },
  };
}

export function createInitialPackageManagerState(
  defaults: PackageManagerDefaults,
  logs: LogEntry[],
): PackageManagerState {
  return {
    flows: createReadFlowStates(),
    updates: createEmptyUpdateProjection(),
    packageDetails: null,
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
    updates: createEmptyUpdateProjection(),
    packageDetails: null,
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
