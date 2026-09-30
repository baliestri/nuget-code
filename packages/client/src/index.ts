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
  loadInstalledReferences,
  loadOutdatedPackageVersions,
  loadPackageDetails,
  loadPackageCatalog,
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
export * from "#client/dotnet-sdk";
export * from "#client/folders";
export * from "#client/packages";
export * from "#client/package-version-edits";
export * from "#client/project-evaluation";
export * from "#client/compatibility-sandbox";
export * from "#client/package-compatibility";
export { ProjectContextError } from "#client/project-context";
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
  loadInstalledReferences,
  loadCacheFolders,
  loadOutdatedPackageVersions,
  loadPackageDetails,
  loadPackageCatalog,
  loadPackageInventory,
  searchPackages,
};
