import { createHash } from "node:crypto";
import { workspace, type Memento } from "vscode";
import type { NuGetPackageItem, PackageManagerState } from "#contracts";
import { createFolderSizeCache } from "../../../manager/src/folders.js";
import type { FolderSizeCache } from "../../../manager/src/types.js";

export const folderSizeCacheKey = "nuget-code.packageManager.folderSizeCache";
const packageStateCacheKeyPrefix =
  "nuget-code.packageManager.packageStateCache";

interface PackageStateCache {
  entries: Record<string, PackageStateCacheEntry>;
}

export interface PackageStateCacheEntry {
  fingerprint?: string | undefined;
  installedPackages: NuGetPackageItem[];
  implicitPackages: NuGetPackageItem[];
  availablePackages: NuGetPackageItem[];
  packageDetails?: Record<string, NuGetPackageItem> | undefined;
  hasUpgrades: boolean;
  updatedAt: string;
}

export function hydrateCachedPackages(
  state: PackageManagerState,
  entry: PackageStateCacheEntry | undefined,
  options: { preserveSelection?: boolean | undefined } = {},
): PackageManagerState {
  if (!entry) {
    return state;
  }

  return {
    ...state,
    installedPackages: entry.installedPackages,
    installedPackagesStatus: "ready",
    implicitPackages: entry.implicitPackages,
    implicitPackagesStatus: "ready",
    availablePackages: entry.availablePackages,
    selectedPackageId: options.preserveSelection
      ? state.selectedPackageId
      : undefined,
    hasUpgrades: entry.hasUpgrades,
  };
}

export function readPackageCacheEntry(
  storage: Memento,
  state: PackageManagerState,
): PackageStateCacheEntry | undefined {
  return storage.get<PackageStateCache>(packageCacheStorageKey(), {
    entries: {},
  }).entries[packageCacheEntryKey(state)];
}

export async function persistPackageCache(
  storage: Memento,
  state: PackageManagerState,
  options: {
    fingerprint?: string | undefined;
    packageDetails?: Record<string, NuGetPackageItem> | undefined;
  } = {},
): Promise<void> {
  const key = packageCacheStorageKey();
  const cache = storage.get<PackageStateCache>(key, {
    entries: {},
  });

  await storage.update(key, {
    ...cache,
    entries: {
      ...cache.entries,
      [packageCacheEntryKey(state)]: {
        fingerprint: options.fingerprint,
        installedPackages: state.installedPackages,
        implicitPackages: state.implicitPackages,
        availablePackages: state.availablePackages,
        packageDetails: options.packageDetails,
        hasUpgrades: state.hasUpgrades,
        updatedAt: new Date().toISOString(),
      },
    },
  });
}

export async function persistFolderSizeCache(
  storage: Memento,
  folders: PackageManagerState["folders"],
): Promise<void> {
  const cache = storage.get<FolderSizeCache>(folderSizeCacheKey, {});
  await storage.update(
    folderSizeCacheKey,
    createFolderSizeCache(cache, folders),
  );
}

function packageCacheStorageKey(): string {
  return `${packageStateCacheKeyPrefix}:${workspaceCacheId()}`;
}

function packageCacheEntryKey(state: PackageManagerState): string {
  return JSON.stringify({
    targetId: state.selectedTargetId,
    feedId: state.selectedFeedId,
    search: state.search,
    includePrerelease: state.includePrerelease,
  });
}

function workspaceCacheId(): string {
  const source =
    workspace.workspaceFile?.fsPath ??
    workspace.workspaceFolders
      ?.map((folder) => folder.uri.toString())
      .sort()
      .join("|") ??
    "empty-workspace";

  return createHash("sha256").update(source).digest("hex");
}
