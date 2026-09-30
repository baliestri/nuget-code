import { createHash } from "node:crypto";
import { workspace, type Memento } from "vscode";
import type { NuGetPackageItem, PackageManagerState } from "#contracts";
import { createFolderSizeCache } from "../../../manager/src/folders.js";
import type { FolderSizeCache } from "../../../manager/src/types.js";
import { MemoryCache, cachePolicy } from "#client/cache";
import { CacheStore } from "#extension/webview/cache-store";

export const folderSizeCacheKey = "nuget-code.packageManager.folderSizeCache";
const packageStateCacheKeyPrefix =
  "nuget-code.packageManager.packageStateCache";

export interface PackageStateCacheEntry {
  fingerprint?: string | undefined;
  installedPackages: NuGetPackageItem[];
  implicitPackages: NuGetPackageItem[];
  availablePackages: NuGetPackageItem[];
  packageDetails?: Record<string, NuGetPackageItem> | undefined;
  detailExpirations?: Record<string, number> | undefined;
  metadataRevision?: string | undefined;
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

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const packageDetailCacheIdentity = (key: string) => digest(key);
interface InventoryPartition {
  fingerprint?: string | undefined;
  installedPackages: NuGetPackageItem[];
  implicitPackages: NuGetPackageItem[];
}
interface DetailPartition {
  item: NuGetPackageItem;
  expiresAt: number;
}

/** Adapter for the legacy display model; inventory facts are independent of every search/filter. */
export class PackageCache {
  private readonly searches: MemoryCache;
  private revision: () => string = () => "";
  constructor(
    private readonly store: CacheStore,
    private readonly now: () => number = Date.now,
    private readonly configurationRevision: () => string = () => "",
  ) {
    this.searches = new MemoryCache(
      cachePolicy.searchKeys,
      now,
      cachePolicy.workspaceBytes,
    );
  }
  private context(state: PackageManagerState): string {
    return digest(
      JSON.stringify([
        workspaceCacheId(),
        this.revision(),
        this.configurationRevision(),
        state.feeds.map((feed) => [
          feed.id,
          feed.url,
          feed.enabled,
          feed.sourceConfigId,
        ]),
      ]),
    );
  }
  setConfigurationRevision(revision: () => string): void {
    this.revision = revision;
    this.searches.clear();
  }
  async read(
    state: PackageManagerState,
  ): Promise<PackageStateCacheEntry | undefined> {
    const inventoryKey = `inventory:${workspaceCacheId()}:${state.selectedTargetId}`;
    const inventory = await this.store.get<InventoryPartition>(
      inventoryKey,
      true,
    );
    if (!inventory) return undefined;
    if (
      !inventory.value ||
      !Array.isArray(inventory.value.installedPackages) ||
      !Array.isArray(inventory.value.implicitPackages) ||
      ![
        ...inventory.value.installedPackages,
        ...inventory.value.implicitPackages,
      ].every(isPackageItem)
    ) {
      await this.store.invalidate(inventoryKey);
      return undefined;
    }
    const context = this.context(state);
    const metadataRevision = this.revision();
    const search = this.searches.get<NuGetPackageItem[]>(
      `${context}:${packageCacheEntryKey(state)}`,
      false,
    );
    const index = await this.store.get<string[]>(
      `details-index:${context}`,
      false,
    );
    const packageDetails: Record<string, NuGetPackageItem> = {};
    const detailExpirations: Record<string, number> = {};
    if (Array.isArray(index?.value))
      for (const key of index.value.slice(-500)) {
        if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) continue;
        const entry = await this.store.get<DetailPartition>(
          `detail:${context}:${key}`,
          false,
        );
        if (
          entry &&
          isPackageItem(entry.value?.item) &&
          Number.isFinite(entry.value.expiresAt) &&
          entry.value.expiresAt > this.now()
        ) {
          packageDetails[key] = entry.value.item;
          detailExpirations[key] = entry.value.expiresAt;
        }
      }
    return {
      ...inventory.value,
      availablePackages: search?.value ?? [],
      packageDetails,
      detailExpirations,
      metadataRevision,
      hasUpgrades: false,
      updatedAt: new Date(inventory.savedAt).toISOString(),
    };
  }
  async persist(
    state: PackageManagerState,
    options: {
      fingerprint?: string | undefined;
      packageDetails?: Record<string, NuGetPackageItem> | undefined;
      detailExpirations?: Record<string, number> | undefined;
    } = {},
  ): Promise<void> {
    const now = this.now();
    const context = this.context(state);
    const put = (
      key: string,
      value: unknown,
      expiresAt: number | null,
      revision: string,
    ) =>
      this.store.put({
        schema: 2,
        key,
        value,
        revision,
        savedAt: now,
        accessedAt: now,
        expiresAt,
      });
    if (
      options.fingerprint &&
      state.installedPackagesStatus === "ready" &&
      state.implicitPackagesStatus === "ready"
    )
      await put(
        `inventory:${workspaceCacheId()}:${state.selectedTargetId}`,
        {
          fingerprint: options.fingerprint,
          installedPackages: state.installedPackages.map(inventoryFact),
          implicitPackages: state.implicitPackages.map(inventoryFact),
        },
        null,
        options.fingerprint,
      );
    this.searches.put({
      schema: 2,
      key: `${context}:${packageCacheEntryKey(state)}`,
      value: state.availablePackages,
      revision: context,
      savedAt: now,
      accessedAt: now,
      expiresAt: now + cachePolicy.searchTtlMs,
    });
    const previous = await this.store.get<string[]>(
      `details-index:${context}`,
      false,
    );
    const keys = new Set(
      Array.isArray(previous?.value)
        ? previous.value.filter(
            (key) => typeof key === "string" && /^[a-f0-9]{64}$/.test(key),
          )
        : [],
    );
    for (const [rawKey, item] of Object.entries(
      options.packageDetails ?? {},
    ).slice(-500)) {
      const expiresAt =
        options.detailExpirations?.[rawKey] ?? now + cachePolicy.metadataTtlMs;
      if (expiresAt <= now || !persistable(item)) continue;
      const key = /^[a-f0-9]{64}$/.test(rawKey)
        ? rawKey
        : packageDetailCacheIdentity(rawKey);
      keys.delete(key);
      keys.add(key);
      await put(
        `detail:${context}:${key}`,
        { item, expiresAt },
        expiresAt,
        context,
      );
    }
    await put(
      `details-index:${context}`,
      [...keys].slice(-500),
      now + cachePolicy.metadataTtlMs,
      context,
    );
  }
  flush(): Promise<void> {
    return this.store.flush();
  }
}

function inventoryFact(item: NuGetPackageItem): NuGetPackageItem {
  return {
    id: item.id,
    name: item.name,
    installedVersion: item.installedVersion,
    projectPaths: item.projectPaths,
    projectStates: item.projectStates,
    implicit: item.implicit,
    versions: item.installedVersion
      ? [{ version: item.installedVersion, source: "Installed" }]
      : [],
    dependencyGroups: [],
  };
}
function isPackageItem(value: unknown): value is NuGetPackageItem {
  if (!value || typeof value !== "object") return false;
  const item = value as NuGetPackageItem;
  const optionalString = (value: unknown) =>
    value === undefined || typeof value === "string";
  if (
    ![
      item.installedVersion,
      item.availableVersion,
      item.sourceName,
      item.sourceUrl,
      item.iconUrl,
      item.description,
      item.authors,
      item.published,
      item.alternatePackage,
    ].every(optionalString)
  )
    return false;
  if (
    [item.implicit, item.deprecated].some(
      (value) => value !== undefined && typeof value !== "boolean",
    )
  )
    return false;
  if (
    item.tags !== undefined &&
    (!Array.isArray(item.tags) ||
      !item.tags.every((tag) => typeof tag === "string"))
  )
    return false;
  if (
    item.projectStates !== undefined &&
    (!Array.isArray(item.projectStates) ||
      !item.projectStates.every(
        (state) =>
          state &&
          typeof state.projectPath === "string" &&
          optionalString(state.installedVersion) &&
          (state.implicit === undefined || typeof state.implicit === "boolean"),
      ))
  )
    return false;
  if (
    item.availableFeeds !== undefined &&
    (!Array.isArray(item.availableFeeds) ||
      !item.availableFeeds.every(
        (feed) =>
          feed &&
          [feed.id, feed.name, feed.displayName, feed.url, feed.color].every(
            (value) => typeof value === "string",
          ),
      ))
  )
    return false;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    Array.isArray(item.projectPaths) &&
    item.projectPaths.every((entry) => typeof entry === "string") &&
    Array.isArray(item.versions) &&
    item.versions.every(
      (entry) =>
        entry &&
        typeof entry.version === "string" &&
        typeof entry.source === "string" &&
        optionalString(entry.published),
    ) &&
    Array.isArray(item.dependencyGroups) &&
    item.dependencyGroups.every(
      (entry) =>
        entry &&
        typeof entry.framework === "string" &&
        Array.isArray(entry.dependencies) &&
        entry.dependencies.every(
          (dependency) =>
            dependency &&
            typeof dependency.id === "string" &&
            typeof dependency.versionRange === "string",
        ),
    )
  );
}
function persistable(item: NuGetPackageItem): boolean {
  // A cache miss is preferable to serializing credentials carried in feed/resource URLs.
  return [
    item.sourceUrl,
    item.iconUrl,
    ...(item.availableFeeds ?? []).map((feed) => feed.url),
  ].every((value) => {
    if (!value || !/^https?:\/\//i.test(value)) return true;
    try {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        ![...url.searchParams.keys()].some((key) =>
          /token|secret|password|signature|^sig$|api.?key|credential/i.test(
            key,
          ),
        )
      );
    } catch {
      return false;
    }
  });
}

export async function migrateLegacyPackageCache(
  storage: Memento,
): Promise<void> {
  for (const key of storage.keys())
    if (
      key === packageStateCacheKeyPrefix ||
      (key.startsWith(`${packageStateCacheKeyPrefix}:`) &&
        /^[a-f0-9]{64}$/.test(key.slice(packageStateCacheKeyPrefix.length + 1)))
    )
      await storage.update(key, undefined);
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
