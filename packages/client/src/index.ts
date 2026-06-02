import { loadSources } from "#client/config";
import {
  calculateFolderSizes,
  clearCacheFolders,
  loadCacheFolders,
} from "#client/folders";
import {
  checkFeedHealth,
  enrichPackageAvailability,
  applyOutdatedPackageVersions,
  loadListedPackageInventory,
  loadOutdatedPackageVersions,
  loadPackageDetails,
  loadPackageInventory,
  searchPackages,
} from "#client/packages";
import {
  findCredentialProvider,
  getFeedAuthorizationHeader,
} from "#client/credentials";

export * from "#client/cli";
export * from "#client/config";
export * from "#client/credentials";
export * from "#client/folders";
export * from "#client/packages";
export * from "#client/types";

export const NuGetClient = {
  loadSources,
  calculateFolderSizes,
  checkFeedHealth,
  clearCacheFolders,
  enrichPackageAvailability,
  applyOutdatedPackageVersions,
  findCredentialProvider,
  getFeedAuthorizationHeader,
  loadListedPackageInventory,
  loadCacheFolders,
  loadOutdatedPackageVersions,
  loadPackageDetails,
  loadPackageInventory,
  searchPackages,
};
