import { LogEntry } from "#contracts/logging";
import {
  NuGetCacheFolder,
  NuGetConfigFile,
  NuGetPackageItem,
  PackageFeed,
} from "#contracts/nuget";
import { WorkspaceTarget } from "#contracts/workspace";
import type { LoadState, ReadFlow } from "#contracts/package-loads";

export type PackageManagerTab = "packages" | "sources" | "folders" | "logs";
export type PackageListStatus = "idle" | "loading" | "ready" | "failed";

export interface PackageManagerState {
  flows: Record<ReadFlow, LoadState>;
  activeTab: PackageManagerTab;
  targets: WorkspaceTarget[];
  selectedTargetId: string;
  feeds: PackageFeed[];
  selectedFeedId: string;
  includePrerelease: boolean;
  search: string;
  installedPackages: NuGetPackageItem[];
  installedPackagesStatus: PackageListStatus;
  implicitPackages: NuGetPackageItem[];
  implicitPackagesStatus: PackageListStatus;
  availablePackages: NuGetPackageItem[];
  selectedPackageId?: string | undefined;
  sources: NuGetConfigFile[];
  selectedSourceId?: string | undefined;
  folders: NuGetCacheFolder[];
  logs: LogEntry[];
  hasUpgrades: boolean;
}

export type PackageManagerOperationKind =
  | "workspace"
  | "sources"
  | "availablePackages"
  | "packageInventory"
  | "restore"
  | "upgrade"
  | "addPackage"
  | "removePackage"
  | "folders"
  | "clearCaches";

export interface PackageManagerOperationMessage {
  operationId: string;
  kind: PackageManagerOperationKind;
  label: string;
  requestId?: number | undefined;
}

export type PackageManagerCommand =
  | "restore"
  | "refreshPackages"
  | "upgradePackages"
  | "reloadSources"
  | "recalculateCacheSizes"
  | "openCacheFolder"
  | "clearSelectedCaches"
  | "openPackageManagerConsole"
  | "openSettings"
  | "addPackage"
  | "upgradeSelectedPackage"
  | "removePackage"
  | "clearLogs"
  | "refreshLogs";
