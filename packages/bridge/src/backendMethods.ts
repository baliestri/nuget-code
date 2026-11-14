import type {
  Empty,
  FeedInfo,
  FolderSizeParams,
  FolderSizeResult,
  FoldersClearParams,
  FoldersClearResult,
  FoldersListResult,
  OperationResult,
  PackageDetailsResult,
  PackagesDetailsParams,
  PackagesInstalledResult,
  PackagesInstallParams,
  PackagesPlanParams,
  PackagesPlanResult,
  PackagesRemoveParams,
  PackagesSearchParams,
  PackagesSearchResult,
  PackagesUpdateParams,
  PackagesUpdatesParams,
  PackagesUpdatesResult,
  RestoreRunParams,
  SourceRemoveParams,
  SourceSetPropertyParams,
  SourcesListResult,
  SourceWriteParams
} from "@nuget-code/protocol";

/**
 * The backend methods the view may call, under the names the backend client gives them. Starting and
 * stopping the backend and opening or closing a solution are not here: the view does not control the
 * session, the extension host does.
 */
export interface BackendMethods {
  installedPackages: { params: Empty; result: PackagesInstalledResult };
  packageUpdates: { params: PackagesUpdatesParams; result: PackagesUpdatesResult };
  searchPackages: { params: PackagesSearchParams; result: PackagesSearchResult };
  packageDetails: { params: PackagesDetailsParams; result: PackageDetailsResult };
  planPackages: { params: PackagesPlanParams; result: PackagesPlanResult };
  installPackage: { params: PackagesInstallParams; result: OperationResult };
  updatePackages: { params: PackagesUpdateParams; result: OperationResult };
  removePackage: { params: PackagesRemoveParams; result: OperationResult };
  restore: { params: RestoreRunParams; result: OperationResult };
  cancelOperation: { params: Empty; result: Empty };
  listSources: { params: Empty; result: SourcesListResult };
  addSource: { params: SourceWriteParams; result: FeedInfo };
  updateSource: { params: SourceWriteParams; result: FeedInfo };
  removeSource: { params: SourceRemoveParams; result: Empty };
  setSourceProperty: { params: SourceSetPropertyParams; result: Empty };
  listFolders: { params: Empty; result: FoldersListResult };
  folderSize: { params: FolderSizeParams; result: FolderSizeResult };
  clearFolders: { params: FoldersClearParams; result: FoldersClearResult };
}

export type BackendMethod = keyof BackendMethods;

const allowed: { readonly [M in BackendMethod]: true } = {
  installedPackages: true,
  packageUpdates: true,
  searchPackages: true,
  packageDetails: true,
  planPackages: true,
  installPackage: true,
  updatePackages: true,
  removePackage: true,
  restore: true,
  cancelOperation: true,
  listSources: true,
  addSource: true,
  updateSource: true,
  removeSource: true,
  setSourceProperty: true,
  listFolders: true,
  folderSize: true,
  clearFolders: true
};

/** Every method of `BackendMethods`; the host refuses anything else. */
export const ALLOWED_BACKEND_METHODS = Object.keys(allowed) as readonly BackendMethod[];

export function isBackendMethod(name: unknown): name is BackendMethod {
  return typeof name === "string" && Object.hasOwn(allowed, name);
}
