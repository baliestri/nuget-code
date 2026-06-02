export interface PackageManagerDefaults {
  defaultFeed: string;
  includePrerelease: boolean;
}

export interface FolderSizeCacheEntry {
  sizeBytes: number;
  calculatedAt: string;
}

export type FolderSizeCache = Record<string, FolderSizeCacheEntry>;

export type ProjectVersionAction = "add" | "update" | "downgrade" | "remove";
