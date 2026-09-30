import { LogEntry } from "#contracts/logging";
import {
  NuGetCacheFolder,
  NuGetConfigFile,
  NuGetPackageItem,
  PackageFeed,
} from "#contracts/nuget";
import { WorkspaceTarget } from "#contracts/workspace";
import type { LoadState, ReadFlow } from "#contracts/package-loads";
import type {
  UpdateProjection,
  InstalledReference,
  PackageCatalog,
} from "#contracts/package-updates";
import type { MutationOperation } from "#contracts/operations";

export type PackageManagerTab = "packages" | "sources" | "folders" | "logs";
export type PackageListStatus = "idle" | "loading" | "ready" | "failed";

export interface PackageManagerState {
  sourceEditor?: import("#contracts/nuget").SourceEditorState;
  flows: Record<ReadFlow, LoadState>;
  updates: UpdateProjection;
  operations: readonly MutationOperation[];
  installedReferences: readonly InstalledReference[];
  catalogs: readonly PackageCatalog[];
  packageDetails?:
    | {
        packageId: string;
        feedId: string;
        version?: string | undefined;
        packageItem: NuGetPackageItem;
      }
    | null
    | undefined;
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
