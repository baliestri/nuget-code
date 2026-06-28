import {
  commands,
  window,
  workspace,
  StatusBarAlignment,
  type Disposable,
  type Memento,
  type StatusBarItem,
  type Webview,
} from "vscode";
import type {
  ExtensionToWebviewMessage,
  NuGetPackageItem,
  PackageManagerCommand,
  PackageManagerOperationKind,
  PackageManagerOperationMessage,
  PackageManagerState,
  PackageManagerTab,
  WebviewToExtensionMessage,
} from "#contracts";
import { ExtensionLogger } from "#extension/logger";
import { NuGetCli, NuGetClient } from "#client";
import type { PackageDetailsCache } from "#client/package-details";
import { PackageManagementCore, type FolderSizeCache } from "#manager";
import { getSettings, type ExtensionSettings } from "#extension/settings";
import {
  discoverWorkspace,
  type WorkspaceDiscovery,
} from "#extension/discovery";
import { PackageManagerEventBus } from "#extension/webview/event-bus";
import { PackageManagerOperationRunner } from "#extension/webview/operation-runner";
import { PackageFeedHealthNotifier } from "#extension/webview/feed-health";
import { loadPackageSources } from "#extension/webview/source-loader";
import { createPackageReferenceFingerprint } from "#extension/webview/package-fingerprint";
import {
  contextItemPath,
  resolveTargetFromContextPath,
} from "#extension/webview/context-target";
import {
  folderSizeCacheKey,
  hydrateCachedPackages,
  type PackageStateCacheEntry,
  persistFolderSizeCache as persistFolderSizeCacheEntry,
  persistPackageCache as persistPackageCacheEntry,
  readPackageCacheEntry,
} from "#extension/webview/package-cache";
import { PackageDetailsService } from "#extension/webview/package-details-service";
import { PackageCommandService } from "#extension/webview/package-commands";
import { FolderService } from "#extension/webview/folder-service";
import { PackageReferenceWatcher } from "#extension/webview/package-reference-watcher";
import { SolutionSelector } from "#extension/solution-selector";

export class PackageManagerController implements Disposable {
  private webview: Webview | undefined;
  private settings: ExtensionSettings;
  private cli: NuGetCli;
  private discovery: WorkspaceDiscovery = {
    targets: [],
    projectPaths: [],
    centralPackageFiles: [],
  };
  private state: PackageManagerState;
  private availablePackagesRequestId = 0;
  private packageInventoryRequestId = 0;
  private packageAvailabilityRequestId = 0;
  private packageReferenceFingerprint = "";
  private packageRefreshAbort: AbortController | undefined;
  private packageDetailsCache = new Map<string, NuGetPackageItem>();
  private initialization: Promise<void> | undefined;
  private readonly events = new PackageManagerEventBus();
  private readonly operations: PackageManagerOperationRunner;
  private readonly feedHealth: PackageFeedHealthNotifier;
  private readonly packageDetails: PackageDetailsService;
  private readonly packageCommands: PackageCommandService;
  private readonly folders: FolderService;
  private readonly packageReferenceWatcher: PackageReferenceWatcher;
  private readonly solutionStatusBar: StatusBarItem;
  private readonly disposables: Disposable[] = [];

  constructor(
    private readonly logger: ExtensionLogger,
    private readonly storage: Memento,
    private readonly solutionSelector: SolutionSelector,
  ) {
    this.settings = getSettings();
    this.cli = new NuGetCli(this.settings, this.logger);
    this.state = this.createInitialState();
    this.solutionStatusBar = window.createStatusBarItem(
      StatusBarAlignment.Left,
      100,
    );
    this.solutionStatusBar.command = "nuget-code.selectSolution";
    this.operations = new PackageManagerOperationRunner(
      this.logger,
      (message) => {
        this.publishPackageEvent(message);
      },
    );
    this.feedHealth = new PackageFeedHealthNotifier(
      this.logger,
      () => this.settings,
      async () => {
        await this.refreshAvailablePackages();
      },
    );
    this.packageDetails = new PackageDetailsService({
      getState: () => this.state,
      setState: (state) => {
        this.state = state;
      },
      getSettings: () => this.settings,
      getCache: () => this.packageDetailsCacheAdapter(),
      logger: this.logger,
      publish: (message) => this.publishPackageEvent(message),
      persistPackageCache: () => this.persistPackageCache(),
    });
    this.packageCommands = new PackageCommandService({
      getState: () => this.state,
      getDiscovery: () => this.discovery,
      getCli: () => this.cli,
      runOperation: (kind, label, action) =>
        this.runOperation(kind, label, action),
      refreshPackages: (options) => this.refreshPackages(options),
    });
    this.folders = new FolderService({
      getState: () => this.state,
      setState: (state) => {
        this.state = state;
      },
      logger: this.logger,
      publish: (message) => this.publishPackageEvent(message),
      persistFolderSizeCache: (folders) => this.persistFolderSizeCache(folders),
      runOperation: (kind, label, action) =>
        this.runOperation(kind, label, action),
    });
    this.packageReferenceWatcher = new PackageReferenceWatcher(
      this.logger,
      () => this.createPackageReferenceFingerprint(),
      () => this.packageReferenceFingerprint,
      (fingerprint) => {
        this.packageReferenceFingerprint = fingerprint;
      },
      (options) => this.refreshPackages(options),
    );

    this.disposables.push(
      this.solutionStatusBar,
      this.events.subscribe((message) => {
        this.webview?.postMessage(message);
      }),
      this.logger.onDidLog((entry) => {
        this.state = { ...this.state, logs: this.logger.getEntries() };
        this.publishPackageEvent({ type: "log", entry });
      }),
      workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration("nuget-code")) {
          return;
        }
        this.settings = getSettings();
        this.cli = new NuGetCli(this.settings, this.logger);
        this.logger.updateSettings(this.settings);
        this.logger.information(
          "vscode",
          "NuGet Package Manager settings updated",
        );
      }),
    );
  }

  async initialize(): Promise<void> {
    this.initialization ??= this.initializeCore();
    await this.initialization;
  }

  attach(webview: Webview): void {
    this.webview = webview;
    this.postState();
  }

  async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.postState();
        return;
      case "setActiveTab":
        await this.setActiveTab(message.tab);
        return;
      case "selectTarget":
        await this.setSelectedTarget(message.targetId);
        return;
      case "selectFeed":
        await this.setSelectedFeed(message.feedId);
        return;
      case "setSearch":
        this.state = { ...this.state, search: message.search };
        this.hydrateCachedPackages({ preserveSelection: true });
        this.postState();
        await this.refreshAvailablePackages();
        return;
      case "setIncludePrerelease":
        this.state = {
          ...this.state,
          includePrerelease: message.includePrerelease,
        };
        this.hydrateCachedPackages({ preserveSelection: true });
        this.postState();
        await this.refreshAvailablePackages();
        return;
      case "selectPackage":
        this.state = { ...this.state, selectedPackageId: message.packageId };
        this.postState();
        return;
      case "loadPackageDetails":
        await this.packageDetails.loadPackageDetails(
          message.packageId,
          message.feedId,
        );
        return;
      case "selectSource":
        this.state = { ...this.state, selectedSourceId: message.sourceId };
        this.postState();
        return;
      case "toggleFolder":
        await this.folders.toggleFolder(message.folderId);
        return;
      case "runCommand":
        await this.runCommand(message.command, {
          version: message.version,
          feedId: message.feedId,
          projectPaths: message.projectPaths,
        });
        return;
    }
  }

  async runCommand(
    command: PackageManagerCommand,
    options: {
      version?: string | undefined;
      feedId?: string | undefined;
      projectPaths?: string[] | undefined;
    } = {},
  ): Promise<void> {
    switch (command) {
      case "restore":
        await this.packageCommands.restorePackages();
        return;
      case "refreshPackages":
        if (options.feedId) {
          this.setSelectedFeedForRefresh(options.feedId);
        }
        await this.refreshPackages({ forceInventory: true });
        return;
      case "upgradePackages":
        await this.packageCommands.upgradePackages();
        return;
      case "reloadSources":
        await this.reloadSources();
        return;
      case "recalculateCacheSizes":
        await this.folders.recalculateCacheSizes();
        return;
      case "openCacheFolder":
        await this.folders.openSelectedCacheFolder();
        return;
      case "clearSelectedCaches":
        await this.folders.clearSelectedCaches();
        return;
      case "openPackageManagerConsole":
        window.showInformationMessage(
          "Package Manager Console is a work in progress.",
        );
        this.logger.information("vscode", "Package Manager Console requested");
        return;
      case "openSettings":
        await commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:nuget-code",
        );
        return;
      case "addPackage":
      case "upgradeSelectedPackage":
        await this.packageCommands.addOrUpgradeSelectedPackage(
          command,
          options,
        );
        return;
      case "removePackage":
        await this.packageCommands.removeSelectedPackage(options.projectPaths);
        return;
      case "clearLogs":
        this.logger.clear();
        this.state = { ...this.state, logs: [] };
        this.publishPackageEvent({ type: "logs", entries: [] });
        this.postState();
        return;
      case "refreshLogs":
        this.state = { ...this.state, logs: this.logger.getEntries() };
        this.publishPackageEvent({ type: "logs", entries: this.state.logs });
        return;
    }
  }

  async setActiveTab(tab: PackageManagerTab): Promise<void> {
    this.state = { ...this.state, activeTab: tab };
    this.postState();

    await commands.executeCommand(
      "setContext",
      "nuget-code.packageManager.activeTab",
      tab,
    );
  }

  async selectSolution(): Promise<void> {
    const solutions = this.discovery.targets.filter(
      (t) => t.kind === "solution",
    );
    if (solutions.length === 0) {
      void window.showInformationMessage(
        "No solution files found in this workspace.",
      );
      return;
    }
    const targetId = await this.solutionSelector.prompt(solutions);
    await this.setSelectedTarget(targetId);
    this.updateSolutionStatusBar();
  }

  async clearSelectedSolution(): Promise<void> {
    await this.solutionSelector.clear();
    const solutions = this.discovery.targets.filter(
      (t) => t.kind === "solution",
    );
    const targetId = await this.solutionSelector.resolve(solutions);
    await this.setSelectedTarget(targetId);
    this.updateSolutionStatusBar();
  }

  async openPackageManagerFromContext(item?: unknown): Promise<void> {
    await this.initialize();
    await commands.executeCommand("nuget-code.packageManager.focus");
    await this.setActiveTab("packages");

    const itemPath = contextItemPath(item);
    const target = resolveTargetFromContextPath(itemPath, this.state.targets);
    if (!target) {
      if (itemPath) {
        this.logger.information(
          "workspace",
          `Could not resolve Package Manager target for ${itemPath}`,
        );
      }
      return;
    }

    if (target.id !== this.state.selectedTargetId) {
      await this.setSelectedTarget(target.id);
    }
  }

  dispose(): void {
    this.packageRefreshAbort?.abort();
    this.packageReferenceWatcher.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.events.dispose();
  }

  private async initializeCore(): Promise<void> {
    await commands.executeCommand(
      "setContext",
      "nuget-code.packageManager.activeTab",
      this.state.activeTab,
    );
    await this.reloadAll();
  }

  private async reloadAll(): Promise<void> {
    await this.runOperation(
      "workspace",
      "Loading NuGet workspace",
      async () => {
        this.discovery = await discoverWorkspace(this.logger);
        const sources = await loadPackageSources(this.settings, this.logger);
        const effectiveFeeds = sources[0]?.feeds ?? [];
        const folders = PackageManagementCore.folders.applyCachedFolderSizes(
          await NuGetClient.loadCacheFolders(this.cli, this.logger),
          this.storage.get<FolderSizeCache>(folderSizeCacheKey, {}),
        );

        const selectedTargetId = await this.resolveSelectedTarget();

        this.state = {
          ...this.state,
          targets: this.discovery.targets,
          selectedTargetId,
          feeds: [PackageManagementCore.feeds.allFeeds, ...effectiveFeeds],
          selectedFeedId: PackageManagementCore.feeds.selectInitialFeed(
            [PackageManagementCore.feeds.allFeeds, ...effectiveFeeds],
            this.state.selectedFeedId,
            this.settings.defaultFeed,
          ),
          sources,
          selectedSourceId: sources[0]?.id,
          folders,
        };

        this.packageReferenceWatcher.register();
        const fingerprint = await this.createPackageReferenceFingerprint();
        const cached = this.hydrateCachedPackages();
        this.hydratePackageDetailsCache(cached);
        this.packageReferenceFingerprint = fingerprint;
        await this.folders.updateSelectedCacheFolderContext();
        this.updateSolutionStatusBar();
        this.postState();
        void this.feedHealth.check(effectiveFeeds);

        if (this.settings.calculateCacheSizesOnLoad) {
          this.state = {
            ...this.state,
            folders: await this.folders.calculateFolderSizesWithProgress(),
          };
        }

        await this.refreshPackages({
          forceInventory: cached?.fingerprint !== fingerprint,
        });
      },
    );
  }

  private async reloadSources(): Promise<void> {
    await this.runOperation("sources", "Reloading NuGet sources", async () => {
      const sources = await loadPackageSources(this.settings, this.logger);
      const effectiveFeeds = sources[0]?.feeds ?? [];

      this.state = {
        ...this.state,
        sources,
        selectedSourceId: sources[0]?.id,
        feeds: [PackageManagementCore.feeds.allFeeds, ...effectiveFeeds],
        selectedFeedId: PackageManagementCore.feeds.selectInitialFeed(
          [PackageManagementCore.feeds.allFeeds, ...effectiveFeeds],
          this.state.selectedFeedId,
          this.settings.defaultFeed,
        ),
      };

      this.postState();
      void this.feedHealth.check(effectiveFeeds);
      await this.refreshAvailablePackages();
    });
  }

  private async refreshPackages(
    options: { forceInventory?: boolean | undefined } = {},
  ): Promise<void> {
    const signal = this.beginPackageRefresh();
    const fingerprint = await this.createPackageReferenceFingerprint();
    const cached = readPackageCacheEntry(this.storage, this.state);
    this.packageReferenceFingerprint = fingerprint;
    if (!options.forceInventory && cached?.fingerprint === fingerprint) {
      const requestId = ++this.availablePackagesRequestId;
      await this.refreshAvailablePackagesForRequest(requestId, { signal });
      return;
    }

    const availableRequestId = ++this.availablePackagesRequestId;
    const inventoryRequestId = ++this.packageInventoryRequestId;

    await Promise.all([
      this.refreshAvailablePackagesForRequest(availableRequestId, {
        signal,
        refreshPackageAvailability: false,
      }),
      this.refreshPackageInventoryForRequest(inventoryRequestId, signal),
    ]);
  }

  private async refreshAvailablePackages(): Promise<void> {
    const signal = this.beginPackageRefresh();
    const requestId = ++this.availablePackagesRequestId;
    await this.refreshAvailablePackagesForRequest(requestId, { signal });
  }

  private async refreshAvailablePackagesForRequest(
    requestId: number,
    options: {
      refreshPackageAvailability?: boolean | undefined;
      signal?: AbortSignal | undefined;
    } = {},
  ): Promise<void> {
    const operation = this.startOperation(
      "availablePackages",
      "Refreshing NuGet feeds",
      requestId,
    );

    try {
      const availablePackages = await this.searchAvailablePackages(
        options.signal,
      );
      if (requestId === this.availablePackagesRequestId) {
        this.state = PackageManagementCore.state.applyAvailablePackages(
          this.state,
          availablePackages,
        );
        this.publishPackageEvent({
          type: "availablePackagesChanged",
          requestId,
          availablePackages: this.state.availablePackages,
          selectedPackageId: this.state.selectedPackageId,
        });
        await this.persistPackageCache();
        if (options.refreshPackageAvailability !== false) {
          await this.refreshPackageAvailability(options.signal);
        }
      }
      this.finishOperation(operation);
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        this.finishOperation(operation);
        return;
      }
      this.failOperation(operation, error);
    }
  }

  private async refreshPackageInventoryForRequest(
    requestId: number,
    signal?: AbortSignal | undefined,
  ): Promise<void> {
    const operation = this.startOperation(
      "packageInventory",
      "Refreshing installed packages",
      requestId,
    );
    this.publishInventoryLoading(requestId);

    try {
      const listedInventory = await NuGetClient.loadListedPackageInventory({
        target: PackageManagementCore.selection.getSelectedTarget(this.state),
        cli: this.cli,
        logger: this.logger,
        signal,
      });

      if (requestId === this.packageInventoryRequestId) {
        this.state = PackageManagementCore.state.applyPackageInventory(
          this.state,
          { installed: listedInventory.installed, implicit: [] },
          this.state.availablePackages,
        );
        this.state = {
          ...this.state,
          installedPackagesStatus: "ready",
          implicitPackagesStatus: "loading",
        };
        await this.updateHasUpgradesContext();
        this.publishInventoryChanged(requestId, {
          implicitPackages: [],
        });

        this.state = PackageManagementCore.state.applyPackageInventory(
          this.state,
          listedInventory,
          this.state.availablePackages,
        );
        this.state = {
          ...this.state,
          installedPackagesStatus: "ready",
          implicitPackagesStatus: "ready",
        };
        this.publishInventoryChanged(requestId);
        await this.persistPackageCache();

        await this.refreshPackageAvailability(signal);
      }

      const outdated = await NuGetClient.loadOutdatedPackageVersions({
        target: PackageManagementCore.selection.getSelectedTarget(this.state),
        cli: this.cli,
        logger: this.logger,
        signal,
      });

      if (requestId === this.packageInventoryRequestId) {
        const inventory = NuGetClient.applyOutdatedPackageVersions(
          {
            installed: this.state.installedPackages,
            implicit: this.state.implicitPackages,
          },
          outdated,
        );
        this.state = PackageManagementCore.state.applyPackageInventory(
          this.state,
          inventory,
          this.state.availablePackages,
        );
        this.state = {
          ...this.state,
          installedPackagesStatus: "ready",
          implicitPackagesStatus: "ready",
        };

        await this.updateHasUpgradesContext();
        this.publishInventoryChanged(requestId);
        await this.persistPackageCache();
        await this.refreshPackageAvailability(signal);
      }
      this.finishOperation(operation);
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        this.finishOperation(operation);
        return;
      }
      if (requestId === this.packageInventoryRequestId) {
        this.state = {
          ...this.state,
          installedPackagesStatus: "failed",
          implicitPackagesStatus: "failed",
        };
        this.publishInventoryChanged(requestId);
      }
      this.failOperation(operation, error);
    }
  }

  private publishInventoryLoading(requestId: number): void {
    this.state = {
      ...this.state,
      installedPackagesStatus: "loading",
      implicitPackagesStatus: "loading",
    };
    this.publishInventoryChanged(requestId);
  }

  private publishInventoryChanged(
    requestId: number,
    overrides: {
      implicitPackages?: NuGetPackageItem[] | undefined;
    } = {},
  ): void {
    this.publishPackageEvent({
      type: "packageInventoryChanged",
      requestId,
      installedPackages: this.state.installedPackages,
      implicitPackages:
        overrides.implicitPackages ?? this.state.implicitPackages,
      installedPackagesStatus: this.state.installedPackagesStatus,
      implicitPackagesStatus: this.state.implicitPackagesStatus,
      selectedPackageId: this.state.selectedPackageId,
      hasUpgrades: this.state.hasUpgrades,
    });
  }

  private searchAvailablePackages(
    signal?: AbortSignal | undefined,
  ): Promise<NuGetPackageItem[]> {
    return NuGetClient.searchPackages({
      feeds: this.state.feeds.filter(
        (feed) => feed.id !== PackageManagementCore.feeds.allFeeds.id,
      ),
      selectedFeedId: this.state.selectedFeedId,
      query: this.state.search,
      includePrerelease: this.state.includePrerelease,
      settings: this.settings,
      logger: this.logger,
      signal,
    });
  }

  private async refreshPackageAvailability(
    signal?: AbortSignal | undefined,
  ): Promise<void> {
    const requestId = ++this.packageAvailabilityRequestId;
    const feeds = this.state.feeds.filter(
      (feed) => feed.id !== PackageManagementCore.feeds.allFeeds.id,
    );
    try {
      const [installedPackages, implicitPackages] = await Promise.all([
        NuGetClient.enrichPackageAvailability({
          packages: this.state.installedPackages,
          feeds,
          includePrerelease: this.state.includePrerelease,
          cache: this.packageDetailsCacheAdapter(),
          settings: this.settings,
          logger: this.logger,
          signal,
        }),
        NuGetClient.enrichPackageAvailability({
          packages: this.state.implicitPackages,
          feeds,
          includePrerelease: this.state.includePrerelease,
          cache: this.packageDetailsCacheAdapter(),
          settings: this.settings,
          logger: this.logger,
          signal,
        }),
      ]);

      if (requestId !== this.packageAvailabilityRequestId) {
        return;
      }

      this.state = {
        ...this.state,
        installedPackages,
        implicitPackages,
        hasUpgrades: installedPackages.some((item) => item.availableVersion),
      };
      await this.updateHasUpgradesContext();
      this.publishPackageEvent({
        type: "packageAvailabilityChanged",
        requestId,
        installedPackages,
        implicitPackages,
        hasUpgrades: this.state.hasUpgrades,
      });
      await this.persistPackageCache();
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        return;
      }
      this.logger.warning(
        "nuget.packages",
        `Failed to enrich package availability: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async setSelectedTarget(targetId: string): Promise<void> {
    this.state = {
      ...this.state,
      selectedTargetId: targetId,
      selectedPackageId: undefined,
      installedPackages: [],
      implicitPackages: [],
      availablePackages: [],
      installedPackagesStatus: "idle",
      implicitPackagesStatus: "idle",
      hasUpgrades: false,
    };

    this.hydratePackageDetailsCache(this.hydrateCachedPackages());
    this.updateSolutionStatusBar();
    this.postState();
    await this.refreshPackages();
  }

  private async setSelectedFeed(feedId: string): Promise<void> {
    this.state = {
      ...this.state,
      selectedFeedId: feedId,
      selectedPackageId: undefined,
      availablePackages: [],
    };

    this.hydratePackageDetailsCache(this.hydrateCachedPackages());
    this.postState();
    await this.refreshAvailablePackages();
  }

  private setSelectedFeedForRefresh(feedId: string): void {
    if (
      feedId === this.state.selectedFeedId ||
      !this.state.feeds.some((feed) => feed.id === feedId)
    ) {
      return;
    }

    this.state = {
      ...this.state,
      selectedFeedId: feedId,
      selectedPackageId: undefined,
      availablePackages: [],
    };

    this.hydratePackageDetailsCache(this.hydrateCachedPackages());
    this.postState();
  }

  private async runOperation(
    kind: PackageManagerOperationKind,
    label: string,
    action: () => Promise<void>,
  ): Promise<void> {
    await this.operations.run(kind, label, async () => {
      await action();

      this.state = { ...this.state, logs: this.logger.getEntries() };
    });
  }

  private startOperation(
    kind: PackageManagerOperationKind,
    label: string,
    requestId?: number,
  ): PackageManagerOperationMessage {
    return this.operations.start(kind, label, requestId);
  }

  private finishOperation(operation: PackageManagerOperationMessage): void {
    this.operations.finish(operation);
  }

  private failOperation(
    operation: PackageManagerOperationMessage,
    error: unknown,
  ): void {
    this.operations.fail(operation, error);
  }

  private createInitialState(): PackageManagerState {
    return PackageManagementCore.state.createInitialPackageManagerState(
      {
        defaultFeed: this.settings.defaultFeed,
        includePrerelease: this.settings.includePrerelease,
      },
      this.logger.getEntries(),
    );
  }

  private postState(): void {
    this.publishPackageEvent({ type: "state", state: this.state });
  }

  private publishPackageEvent(message: ExtensionToWebviewMessage): void {
    this.events.publish(message);
  }

  private hydrateCachedPackages(
    options: { preserveSelection?: boolean | undefined } = {},
  ): PackageStateCacheEntry | undefined {
    const entry = readPackageCacheEntry(this.storage, this.state);
    this.state = hydrateCachedPackages(this.state, entry, options);
    return entry;
  }

  private async persistPackageCache(): Promise<void> {
    await persistPackageCacheEntry(this.storage, this.state, {
      fingerprint: this.packageReferenceFingerprint,
      packageDetails: Object.fromEntries(this.packageDetailsCache),
    });
  }

  private async persistFolderSizeCache(
    folders: PackageManagerState["folders"],
  ): Promise<void> {
    await persistFolderSizeCacheEntry(this.storage, folders);
  }

  private async updateHasUpgradesContext(): Promise<void> {
    await commands.executeCommand(
      "setContext",
      "nuget-code.packageManager.hasUpgrades",
      this.state.hasUpgrades,
    );
  }

  private beginPackageRefresh(): AbortSignal {
    this.packageRefreshAbort?.abort();
    this.packageRefreshAbort = new AbortController();
    return this.packageRefreshAbort.signal;
  }

  private createPackageReferenceFingerprint(): Promise<string> {
    return createPackageReferenceFingerprint({
      target: PackageManagementCore.selection.getSelectedTarget(this.state),
      centralPackageFiles: this.discovery.centralPackageFiles,
    });
  }

  private hydratePackageDetailsCache(
    entry: PackageStateCacheEntry | undefined,
  ): void {
    this.packageDetailsCache = new Map(
      Object.entries(entry?.packageDetails ?? {}),
    );
  }

  private packageDetailsCacheAdapter(): PackageDetailsCache {
    return {
      get: (key) => this.packageDetailsCache.get(key),
      set: (key, value) => {
        this.packageDetailsCache.set(key, value);
      },
    };
  }

  private async resolveSelectedTarget(): Promise<string> {
    const solutions = this.discovery.targets.filter(
      (t) => t.kind === "solution",
    );

    if (solutions.length === 0) {
      const fallbackId =
        this.state.selectedTargetId || this.discovery.targets[0]?.id || "";
      if (!fallbackId) {
        void window.showWarningMessage(
          "No solution file was found in this workspace.",
        );
      }
      return fallbackId;
    }

    const currentStillValid = solutions.some(
      (s) => s.id === this.state.selectedTargetId,
    );
    if (currentStillValid) return this.state.selectedTargetId;

    return this.solutionSelector.resolve(solutions);
  }

  private updateSolutionStatusBar(): void {
    const target = PackageManagementCore.selection.getSelectedTarget(
      this.state,
    );
    if (target?.kind === "solution") {
      this.solutionStatusBar.text = `$(file-code) ${target.name}`;
      this.solutionStatusBar.tooltip = `NuGet active solution: ${workspace.asRelativePath(target.path)}\nClick to change`;
      this.solutionStatusBar.show();
    } else {
      this.solutionStatusBar.hide();
    }
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
