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
  presentPackageDetails,
  isPrereleaseVersion,
  comparePackageVersions,
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
  let sessionId: string | undefined;
  let revision = -1;
  let resyncRequested = false;
  const retiredSessions = new Set<string>();

  const selectedTargetValue = computed(() => selectedTarget(model.value));
  const currentPackage = computed(() => {
    const base = selectedPackage(
      model.value,
      selectedPackageId.value ?? model.value.selectedPackageId,
    );
    const details = model.value.packageDetails;
    return base &&
      details?.packageId === base.id &&
      details.feedId === selectedDetailFeedId.value &&
      (!details.version || details.version === selectedVersion.value)
      ? presentPackageDetails(base, details.packageItem)
      : base;
  });
  const visibleUpdates = computed(() =>
    model.value.updates.context.targetId === model.value.selectedTargetId
      ? model.value.updates.evaluation.candidates.filter(
          (candidate) =>
            model.value.includePrerelease ||
            !isPrereleaseVersion(candidate.version),
        )
      : [],
  );
  const executableUpdates = computed(() =>
    visibleUpdates.value.filter(
      (candidate) => candidate.compatibility.status === "compatible",
    ),
  );
  function versionsFor(packageItem: NuGetPackageItem): string[] {
    const installed = new Set(
      model.value.installedReferences
        .filter(
          (reference) =>
            reference.packageId.toLowerCase() ===
            packageItem.name.toLowerCase(),
        )
        .map((reference) => reference.resolvedVersion)
        .filter((value): value is string => !!value),
    );
    if (packageItem.installedVersion)
      installed.add(packageItem.installedVersion);
    const feed = model.value.feeds.find(
      (feed) => feed.id === selectedDetailFeedId.value,
    );
    const catalog = model.value.catalogs.find(
      (catalog) =>
        catalog.packageId.toLowerCase() === packageItem.name.toLowerCase(),
    );
    const versions =
      catalog?.versions
        .filter((entry) => !feed || entry.feedUrls.includes(feed.url))
        .map((entry) => entry.version) ?? [];
    return [
      ...new Set([...packageVersions(packageItem), ...versions, ...installed]),
    ]
      .filter(
        (version) =>
          model.value.includePrerelease ||
          !isPrereleaseVersion(version) ||
          installed.has(version),
      )
      .sort(comparePackageVersions);
  }
  function isPackageBusy(name: string): boolean {
    return model.value.operations.some(
      (operation) =>
        !operation.outcome &&
        operation.plan.steps.some(
          (step) => step.packageId?.toLowerCase() === name.toLowerCase(),
        ),
    );
  }
  function cancelOperation(operationId: string): void {
    post({ type: "cancelOperation", operationId });
  }
  function retryOperation(operationId: string): void {
    post({ type: "retryOperation", operationId });
  }
  function confirmOperation(
    operationId: string,
    contextRevision: string,
    accepted: boolean,
  ): void {
    post({ type: "confirmOperation", operationId, contextRevision, accepted });
  }

  function post(message: WebviewToExtensionMessage): void {
    postMessage(message);
  }

  function connect(): () => void {
    window.addEventListener("message", handleExtensionMessage);
    post({ type: "ready" });

    return () => {
      clearSearchTimeout();
      pendingSearch.value = undefined;
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
    model.value.hasUpgrades = executableUpdates.value.length > 0;
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
    if (
      currentPackage.value &&
      !versionsFor(currentPackage.value).includes(version)
    )
      return;
    selectedVersion.value = version;
    selectedVersionDirty.value = true;
    if (currentPackage.value)
      requestPackageDetails(currentPackage.value, selectedDetailFeedId.value);
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
    post({
      type: "runCommand",
      command,
      version,
      feedId,
      projectPaths,
    });
  }

  function handleExtensionMessage(
    event: MessageEvent<ExtensionToWebviewMessage>,
  ): void {
    const message = event.data;
    if (
      !message ||
      typeof message.sessionId !== "string" ||
      !message.sessionId ||
      !Number.isSafeInteger(message.revision) ||
      message.revision < 0
    )
      return;
    if (retiredSessions.has(message.sessionId)) return;
    if (message.type === "state") {
      if (message.sessionId === sessionId && message.revision <= revision)
        return;
      if (sessionId !== undefined && message.sessionId !== sessionId) {
        retiredSessions.add(sessionId);
        clearSearchTimeout();
        pendingSearch.value = undefined;
        selectedVersion.value = "";
        selectedVersionDirty.value = false;
        selectedPackageId.value = undefined;
        selectedDetailFeedId.value = "";
        lastDetailsRequestKey.value = "";
        selectedProjectPaths.value = [];
        selectedProjectPathsKey.value = "";
      }
      sessionId = message.sessionId;
      revision = message.revision;
      resyncRequested = false;
    } else {
      if (message.sessionId === sessionId && message.revision <= revision)
        return;
      if (
        message.sessionId !== sessionId ||
        message.baseRevision !== revision ||
        !Number.isSafeInteger(message.baseRevision) ||
        message.revision !== message.baseRevision + 1
      ) {
        if (!resyncRequested) {
          resyncRequested = true;
          post({ type: "ready" });
        }
        return;
      }
      revision = message.revision;
    }
    switch (message.type) {
      case "stateDelta":
        model.value = {
          ...model.value,
          ...message.patch,
          search:
            pendingSearch.value ?? message.patch.search ?? model.value.search,
        };
        if (Object.hasOwn(message.patch, "selectedPackageId"))
          selectedPackageId.value = message.patch.selectedPackageId;
        syncPackageControls();
        return;
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
    model.value.hasUpgrades = executableUpdates.value.length > 0;
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
      !versionsFor(current).includes(selectedVersion.value)
    ) {
      const preferred = defaultPackageVersion(current);
      selectedVersion.value = versionsFor(current).includes(preferred)
        ? preferred
        : (versionsFor(current).at(-1) ?? "");
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

    const key = `${model.value.updates.context.revision}:${packageItem.id}:${feedId}:${model.value.includePrerelease}:${selectedVersion.value}`;
    if (lastDetailsRequestKey.value === key) {
      return;
    }
    lastDetailsRequestKey.value = key;
    post({
      type: "loadPackageDetails",
      packageId: packageItem.id,
      feedId,
      version: selectedVersion.value || undefined,
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
    visibleUpdates,
    executableUpdates,
    versionsFor,
    isPackageBusy,
    cancelOperation,
    retryOperation,
    confirmOperation,
  };
});
