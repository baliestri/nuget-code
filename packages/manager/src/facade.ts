import { allFeeds } from "#manager/constants";
import { selectInitialFeed } from "#manager/feeds";
import {
  applyCachedFolderSizes,
  createFolderSizeCache,
  toggleSingleFolderSelection,
} from "#manager/folders";
import {
  applyAvailablePackages,
  applyPackageInventory,
} from "#manager/state-updates";
import { getSelectedPackage, getSelectedTarget } from "#manager/selection";
import { createInitialPackageManagerState } from "#manager/state";

export const PackageManagementCore = {
  feeds: {
    allFeeds,
    selectInitialFeed,
  },
  folders: {
    applyCachedFolderSizes,
    createFolderSizeCache,
    toggleSingleFolderSelection,
  },
  selection: {
    getSelectedPackage,
    getSelectedTarget,
  },
  state: {
    applyAvailablePackages,
    applyPackageInventory,
    createInitialPackageManagerState,
  },
  allFeeds,
  applyAvailablePackages,
  applyCachedFolderSizes,
  applyPackageInventory,
  createFolderSizeCache,
  createInitialPackageManagerState,
  getSelectedPackage,
  getSelectedTarget,
  selectInitialFeed,
  toggleSingleFolderSelection,
};
