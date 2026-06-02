import type { NuGetCacheFolder, PackageManagerState } from "#contracts";
import type { FolderSizeCache } from "#manager/types";

export function toggleSingleFolderSelection(
  state: PackageManagerState,
  folderId: string,
): PackageManagerState {
  const selectedFolder = state.folders.find((folder) => folder.id === folderId);
  const shouldSelect = !selectedFolder?.selected;

  return {
    ...state,
    folders: state.folders.map((folder) =>
      folder.id === folderId
        ? { ...folder, selected: shouldSelect }
        : { ...folder, selected: false },
    ),
  };
}

export function applyCachedFolderSizes(
  folders: NuGetCacheFolder[],
  cache: FolderSizeCache,
): NuGetCacheFolder[] {
  return folders.map((folder) => {
    const cached = cache[folder.id];
    if (!cached) {
      return folder;
    }

    return {
      ...folder,
      sizeBytes: cached.sizeBytes,
      sizeCalculatedAt: cached.calculatedAt,
    };
  });
}

export function createFolderSizeCache(
  current: FolderSizeCache,
  folders: NuGetCacheFolder[],
): FolderSizeCache {
  const nextCache = { ...current };
  for (const folder of folders) {
    if (
      folder.sizeBytes === undefined ||
      folder.sizeCalculatedAt === undefined
    ) {
      continue;
    }

    nextCache[folder.id] = {
      sizeBytes: folder.sizeBytes,
      calculatedAt: folder.sizeCalculatedAt,
    };
  }
  return nextCache;
}
