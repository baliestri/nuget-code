import { LogEntry } from "#contracts/logging";
import {
  PackageManagerTab,
  PackageManagerCommand,
  PackageListStatus,
  PackageManagerOperationMessage,
  PackageManagerState,
} from "#contracts/package-manager";
import { NuGetCacheFolder, NuGetPackageItem } from "#contracts/nuget";

export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "setActiveTab"; tab: PackageManagerTab }
  | { type: "selectTarget"; targetId: string }
  | { type: "selectFeed"; feedId: string }
  | { type: "setSearch"; search: string }
  | { type: "setIncludePrerelease"; includePrerelease: boolean }
  | { type: "selectPackage"; packageId: string }
  | { type: "loadPackageDetails"; packageId: string; feedId: string }
  | { type: "selectSource"; sourceId: string }
  | { type: "toggleFolder"; folderId: string }
  | {
      type: "runCommand";
      command: PackageManagerCommand;
      version?: string | undefined;
      feedId?: string | undefined;
      projectPaths?: string[] | undefined;
    };

export type ExtensionToWebviewMessage =
  | { type: "state"; state: PackageManagerState }
  | ({ type: "operationStarted" } & PackageManagerOperationMessage)
  | ({ type: "operationFinished" } & PackageManagerOperationMessage)
  | ({
      type: "operationFailed";
      error: string;
    } & PackageManagerOperationMessage)
  | {
      type: "availablePackagesChanged";
      requestId: number;
      availablePackages: NuGetPackageItem[];
      selectedPackageId?: string | undefined;
    }
  | {
      type: "packageInventoryChanged";
      requestId: number;
      installedPackages: NuGetPackageItem[];
      implicitPackages: NuGetPackageItem[];
      installedPackagesStatus: PackageListStatus;
      implicitPackagesStatus: PackageListStatus;
      selectedPackageId?: string | undefined;
      hasUpgrades: boolean;
    }
  | {
      type: "packageAvailabilityChanged";
      requestId: number;
      installedPackages: NuGetPackageItem[];
      implicitPackages: NuGetPackageItem[];
      hasUpgrades: boolean;
    }
  | {
      type: "packageDetailsChanged";
      requestId: number;
      packageId: string;
      feedId: string;
      packageItem?: NuGetPackageItem | undefined;
    }
  | { type: "foldersChanged"; folders: NuGetCacheFolder[] }
  | { type: "log"; entry: LogEntry }
  | { type: "logs"; entries: LogEntry[] };
