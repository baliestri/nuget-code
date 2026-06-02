import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type {
  ExtensionToWebviewMessage,
  NuGetPackageItem,
  PackageManagerCommand,
  WebviewToExtensionMessage,
} from "#contracts";
import { useVsCodeApi } from "#webview/composables/useVsCodeApi";
import {
  applyAvailablePackageMetadata,
  applyPackageDetails,
  createEmptyPackageManagerState,
  defaultPackageVersion,
  defaultSelectedProjectPaths,
  detailFeedId,
  packageVersions,
  projectSelectionKey,
  globalProjectActions,
  selectedPackage,
  selectedTarget,
  sameProjectPath,
  updatePackageProjectStates,
} from "#manager";

export const usePackageManagerStore = defineStore("packageManager", () => {
  const { postMessage } = useVsCodeApi();
  const model = ref(createEmptyPackageManagerState());
  const selectedVersion = ref("");
  const selectedVersionDirty = ref(false);
  const selectedPackageId = ref<string | undefined>();
  const selectedDetailFeedId = ref("");
  const lastDetailsRequestKey = ref("");
  const selectedProjectPaths = ref<string[]>([]);
  const selectedProjectPathsKey = ref("");
  const pendingSearch = ref<string | undefined>();
  let searchTimeout: ReturnType<typeof window.setTimeout> | undefined;

  const selectedTargetValue = computed(() => selectedTarget(model.value));
  const currentPackage = computed(() =>
    selectedPackage(
      model.value,
      selectedPackageId.value ?? model.value.selectedPackageId,
    ),
  );

  function post(message: WebviewToExtensionMessage): void {
    postMessage(message);
  }

  function connect(): () => void {
    window.addEventListener("message", handleExtensionMessage);
    post({ type: "ready" });

    return () => {
      clearSearchTimeout();
      window.removeEventListener("message", handleExtensionMessage);
    };
  }

  function setSearch(search: string): void {
    model.value = { ...model.value, search };
    pendingSearch.value = search;
    clearSearchTimeout();
    searchTimeout = window.setTimeout(() => {
      pendingSearch.value = undefined;
      post({ type: "setSearch", search });
    }, 1000);
  }

  function clearSearchTimeout(): void {
    if (searchTimeout === undefined) {
      return;
    }
    window.clearTimeout(searchTimeout);
    searchTimeout = undefined;
  }

  function selectTargetId(targetId: string): void {
    selectedPackageId.value = undefined;
    selectedVersion.value = "";
    selectedVersionDirty.value = false;
    selectedProjectPaths.value = [];
    selectedProjectPathsKey.value = "";
    model.value = {
      ...model.value,
      selectedTargetId: targetId,
      selectedPackageId: undefined,
    };
    post({ type: "selectTarget", targetId });
    syncPackageControls();
  }

  function selectFeedId(feedId: string): void {
    model.value = { ...model.value, selectedFeedId: feedId };
    post({ type: "selectFeed", feedId });
    syncPackageControls();
  }

  function setIncludePrerelease(includePrerelease: boolean): void {
    model.value = { ...model.value, includePrerelease };
    lastDetailsRequestKey.value = "";
    post({ type: "setIncludePrerelease", includePrerelease });
    syncPackageControls();
  }

  function selectSourceId(sourceId: string): void {
    model.value = { ...model.value, selectedSourceId: sourceId };
    post({ type: "selectSource", sourceId });
  }

  function toggleFolder(folderId: string): void {
    post({ type: "toggleFolder", folderId });
  }

  function runCommand(
    command: PackageManagerCommand,
    options: {
      version?: string | undefined;
      feedId?: string | undefined;
      projectPaths?: string[] | undefined;
    } = {},
  ): void {
    post({ type: "runCommand", command, ...options });
  }

  function selectPackageItem(packageItem: NuGetPackageItem): void {
    selectedPackageId.value = packageItem.id;
    const selected =
      selectedPackage(model.value, packageItem.id) ?? packageItem;
    selectedVersionDirty.value = false;
    selectedVersion.value = defaultPackageVersion(selected);
    selectedDetailFeedId.value = detailFeedId(selected, model.value);
    selectedProjectPaths.value = defaultSelectedProjectPaths(
      selected,
      selectedTarget(model.value),
    );
    selectedProjectPathsKey.value = projectSelectionKey(
      selected,
      selectedTarget(model.value),
    );
    post({ type: "selectPackage", packageId: packageItem.id });
    requestPackageDetails(selected, selectedDetailFeedId.value);
  }

  function setSelectedVersion(version: string): void {
    selectedVersion.value = version;
    selectedVersionDirty.value = true;
  }

  function setSelectedDetailFeed(feedId: string): void {
    selectedDetailFeedId.value = feedId;
    const selected = currentPackage.value;
    if (selected) {
      requestPackageDetails(selected, feedId);
    }
  }

  function setProjectSelected(projectPath: string, checked: boolean): void {
    const selected = new Set(selectedProjectPaths.value);
    if (checked) {
      selected.add(projectPath);
    } else {
      selected.delete(projectPath);
    }
    selectedProjectPaths.value = Array.from(selected);
  }

  function selectedProjectPathsForTarget(): string[] {
    const allowedProjectPaths = new Set(
      selectedTargetValue.value?.projectPaths ?? [],
    );
    return selectedProjectPaths.value.filter((projectPath) =>
      allowedProjectPaths.has(projectPath),
    );
  }

  function getGlobalProjectActions(
    packageItem: NuGetPackageItem,
    version: string,
    projectPaths: string[],
  ): Record<"add" | "update" | "downgrade" | "remove", string[]> {
    return globalProjectActions(packageItem, version, projectPaths);
  }

  function runPackageCommandForProjects(
    command: "addPackage" | "upgradeSelectedPackage" | "removePackage",
    version: string,
    feedId: string,
    projectPaths: string[],
  ): void {
    if (projectPaths.length === 0) {
      return;
    }
    if (command === "removePackage") {
      markProjectsUninstalled(projectPaths);
    } else {
      markProjectsInstalled(projectPaths, version);
    }
    post({
      type: "runCommand",
      command,
      version,
      feedId,
      projectPaths,
    });
  }

  function markProjectsInstalled(
    projectPaths: string[],
    version: string,
  ): void {
    const selected = new Set(selectedProjectPaths.value);
    for (const projectPath of projectPaths) {
      selected.add(projectPath);
    }
    selectedProjectPaths.value = Array.from(selected);
    updateCurrentPackageProjectState(projectPaths, version);
  }

  function markProjectsUninstalled(projectPaths: string[]): void {
    const removed = new Set(projectPaths);
    selectedProjectPaths.value = selectedProjectPaths.value.filter(
      (projectPath) =>
        !Array.from(removed).some((removedPath) =>
          sameProjectPath(removedPath, projectPath),
        ),
    );
    updateCurrentPackageProjectState(projectPaths, undefined);
  }

  function updateCurrentPackageProjectState(
    projectPaths: string[],
    version: string | undefined,
  ): void {
    const current = currentPackage.value;
    if (!current) {
      return;
    }

    model.value = {
      ...model.value,
      installedPackages: updatePackageProjectStates(
        model.value.installedPackages,
        current.name,
        projectPaths,
        version,
      ),
      implicitPackages: updatePackageProjectStates(
        model.value.implicitPackages,
        current.name,
        projectPaths,
        version,
      ),
      availablePackages: updatePackageProjectStates(
        model.value.availablePackages,
        current.name,
        projectPaths,
        version,
      ),
    };
  }

  function handleExtensionMessage(
    event: MessageEvent<ExtensionToWebviewMessage>,
  ): void {
    const message = event.data;
    switch (message.type) {
      case "state":
        model.value = {
          ...message.state,
          search: pendingSearch.value ?? message.state.search,
        };
        selectedPackageId.value = message.state.selectedPackageId;
        syncPackageControls();
        return;
      case "availablePackagesChanged":
        model.value = {
          ...model.value,
          availablePackages: message.availablePackages,
          installedPackages: applyAvailablePackageMetadata(
            model.value.installedPackages,
            message.availablePackages,
          ),
          implicitPackages: applyAvailablePackageMetadata(
            model.value.implicitPackages,
            message.availablePackages,
          ),
          selectedPackageId: message.selectedPackageId,
        };
        if (message.selectedPackageId !== undefined) {
          selectedPackageId.value = message.selectedPackageId;
        }
        syncPackageControls();
        return;
      case "packageInventoryChanged":
        model.value = {
          ...model.value,
          installedPackages: message.installedPackages,
          implicitPackages: message.implicitPackages,
          installedPackagesStatus: message.installedPackagesStatus,
          implicitPackagesStatus: message.implicitPackagesStatus,
          selectedPackageId: message.selectedPackageId,
          hasUpgrades: message.hasUpgrades,
        };
        if (message.selectedPackageId !== undefined) {
          selectedPackageId.value = message.selectedPackageId;
        }
        syncPackageControls();
        return;
      case "packageAvailabilityChanged":
        model.value = {
          ...model.value,
          installedPackages: message.installedPackages,
          implicitPackages: message.implicitPackages,
          hasUpgrades: message.hasUpgrades,
        };
        syncPackageControls();
        return;
      case "packageDetailsChanged":
        if (message.packageItem) {
          model.value = applyPackageDetails(model.value, message.packageItem);
          selectedDetailFeedId.value = message.feedId;
          syncPackageControls();
        } else {
          lastDetailsRequestKey.value = "";
        }
        return;
      case "foldersChanged":
        model.value = { ...model.value, folders: message.folders };
        return;
      case "log":
        model.value = {
          ...model.value,
          logs: [...model.value.logs, message.entry],
        };
        return;
      case "logs":
        model.value = { ...model.value, logs: message.entries };
        return;
      case "operationStarted":
      case "operationFinished":
      case "operationFailed":
        return;
    }
  }

  function syncPackageControls(): void {
    const current = currentPackage.value;
    if (!current) {
      selectedVersion.value = "";
      selectedVersionDirty.value = false;
      selectedProjectPaths.value = [];
      selectedProjectPathsKey.value = "";
      return;
    }

    if (
      !selectedVersionDirty.value ||
      !packageVersions(current).includes(selectedVersion.value)
    ) {
      selectedVersion.value = defaultPackageVersion(current);
      selectedVersionDirty.value = false;
    }

    if (
      !model.value.feeds.some(
        (feed) =>
          feed.id === selectedDetailFeedId.value && feed.id !== "__all__",
      )
    ) {
      selectedDetailFeedId.value = detailFeedId(current, model.value);
    }

    const target = selectedTargetValue.value;
    const allowedProjectPaths = new Set(target?.projectPaths ?? []);
    selectedProjectPaths.value = selectedProjectPaths.value.filter(
      (projectPath) => allowedProjectPaths.has(projectPath),
    );

    const nextProjectSelectionKey = projectSelectionKey(current, target);
    if (selectedProjectPathsKey.value !== nextProjectSelectionKey) {
      selectedProjectPaths.value = defaultSelectedProjectPaths(current, target);
      selectedProjectPathsKey.value = nextProjectSelectionKey;
    } else if (selectedProjectPaths.value.length === 0) {
      const defaultProjects = defaultSelectedProjectPaths(current, target);
      if (defaultProjects.length > 0) {
        selectedProjectPaths.value = defaultProjects;
      }
    }

    requestPackageDetails(current, selectedDetailFeedId.value);
  }

  function requestPackageDetails(
    packageItem: NuGetPackageItem,
    feedId: string,
  ): void {
    if (!feedId || feedId === "__all__") {
      return;
    }

    const key = `${packageItem.id}:${feedId}:${model.value.includePrerelease}`;
    if (lastDetailsRequestKey.value === key) {
      return;
    }
    lastDetailsRequestKey.value = key;
    post({
      type: "loadPackageDetails",
      packageId: packageItem.id,
      feedId,
    });
  }

  return {
    model,
    selectedVersion,
    selectedPackageId,
    selectedDetailFeedId,
    selectedProjectPaths,
    selectedTargetValue,
    currentPackage,
    connect,
    post,
    setSearch,
    selectTargetId,
    selectFeedId,
    setIncludePrerelease,
    selectSourceId,
    toggleFolder,
    runCommand,
    selectPackageItem,
    setSelectedVersion,
    setSelectedDetailFeed,
    setProjectSelected,
    selectedProjectPathsForTarget,
    getGlobalProjectActions,
    runPackageCommandForProjects,
  };
});
