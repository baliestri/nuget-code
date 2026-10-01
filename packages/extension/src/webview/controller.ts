import { packageInstallations } from "#client/package-installations";
import {
  commands,
  env,
  Uri,
  window,
  workspace,
  StatusBarAlignment,
  type Disposable,
  type Memento,
  type StatusBarItem,
  type Webview,
} from "vscode";
import type {
  PackageManagerEvent,
  PackageFeedFilter,
  NuGetPackageItem,
  PackageManagerCommand,
  PackageManagerOperationKind,
  UpgradeContext,
  LoadState,
  ReadFlow,
  MutationPlan,
  WorkspaceTarget,
  PackageManagerState,
  PackageManagerTab,
  WebviewToExtensionMessage,
} from "#contracts";
import { ExtensionLogger } from "#extension/logger";
import {
  NuGetCli,
  NuGetClient,
  ClientNetwork,
  MemoryCache,
  cachePolicy,
} from "#client";
import type { PackageDetailsCache } from "#client/package-details";
import {
  PackageManagementCore,
  normalizeFeedFilter,
  queryFeedUrls,
  packageMetadataUrl,
  referenceInventory,
  type FolderSizeCache,
} from "#manager";
import { createHash } from "node:crypto";
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
  PackageCache,
  packageDetailCacheIdentity,
  migrateLegacyPackageCache,
} from "#extension/webview/package-cache";
import { PackageDetailsService } from "#extension/webview/package-details-service";
import { PackageCommandService } from "#extension/webview/package-commands";
import { FolderService } from "#extension/webview/folder-service";
import { PackageReferenceWatcher } from "#extension/webview/package-reference-watcher";
import { SolutionSelector } from "#extension/solution-selector";
import { StateMessageSequence } from "#extension/webview/state-message-sequence";
import { PackageDataService } from "#extension/webview/package-data-service";
import { randomUUID } from "node:crypto";
import { MutationService } from "#extension/webview/mutation-service";
import { PackageMutationPort } from "#extension/webview/package-mutation-port";
import { packageStatus } from "#extension/webview/package-status";
import {
  SourceEditService,
  sourceEditSummary,
} from "#extension/webview/source-edit-service";
import {
  PackageDataAdapter,
  type DataEnvironment,
} from "#extension/webview/package-data-adapter";

export class PackageManagerController implements Disposable {
  private readonly sourceEditor = new SourceEditService();
  private sourceEditorRevision = 0;
  private sourceEditPending = false;
  private disposed = false;
  private readonly messages = new StateMessageSequence();
  private readonly network = new ClientNetwork();
  private webview: Webview | undefined;
  private settings: ExtensionSettings;
  private cli: NuGetCli;
  private discovery: WorkspaceDiscovery = {
    targets: [],
    projectPaths: [],
    centralPackageFiles: [],
  };
  private state: PackageManagerState;
  private packageReferenceFingerprint = "";
  private readonly data: PackageDataService;
  private readonly dataAdapter: PackageDataAdapter;
  private readonly mutations: MutationService;
  private inputPaths: readonly string[] = [];
  private dataGeneration = 0;
  private activeDataContextKey = "";
  private feedFilterTargetId = "";
  private authenticationRefreshPending = false;
  private readonly packageDetailsCache = new MemoryCache(
    500,
    Date.now,
    cachePolicy.workspaceBytes,
  );
  private initialization: Promise<void> | undefined;
  private discoveryRefreshChain: Promise<void> = Promise.resolve();
  private readonly events = new PackageManagerEventBus();
  private readonly operations: PackageManagerOperationRunner;
  private readonly feedHealth: PackageFeedHealthNotifier;
  private readonly packageDetails: PackageDetailsService;
  private readonly packageCommands: PackageCommandService;
  private readonly folders: FolderService;
  private readonly packageReferenceWatcher: PackageReferenceWatcher;
  private readonly solutionStatusBar: StatusBarItem;
  private readonly packageStatusBar: StatusBarItem;
  private readonly disposables: Disposable[] = [];

  constructor(
    private readonly logger: ExtensionLogger,
    private readonly storage: Memento,
    private readonly solutionSelector: SolutionSelector,
    private readonly packageCache: PackageCache,
  ) {
    this.settings = { ...getSettings(), network: this.network };
    this.packageCache.setConfigurationRevision(() =>
      this.network.context(this.settings),
    );
    this.cli = new NuGetCli(this.settings, this.logger);
    this.state = this.createInitialState();
    this.mutations = new MutationService((operations) => {
      this.state = { ...this.state, operations };
      this.publishPackageEvent({ type: "stateDelta", patch: { operations } });
    });
    this.dataAdapter = new PackageDataAdapter(
      (targetId) => this.dataEnvironment(targetId),
      logger,
    );
    this.data = new PackageDataService(
      this.dataAdapter,
      (updates) => {
        if (updates.context.targetId !== this.state.selectedTargetId) return;
        this.state = PackageManagementCore.state.applyUpdateProjection(
          this.state,
          updates,
        );
        this.publishPackageEvent({
          type: "stateDelta",
          patch: { updates, hasUpgrades: this.state.hasUpgrades },
        });
        void this.updateHasUpgradesContext().catch(() => {});
      },
      {
        catalogs: (catalogs, context) => {
          if (context.targetId !== this.state.selectedTargetId) return;
          const icons = new Map(
            catalogs.map((catalog) => [
              catalog.packageId.toLowerCase(),
              catalog.iconUrl,
            ]),
          );
          const enrich = (items: NuGetPackageItem[]) =>
            items.map((item) => ({
              ...item,
              iconUrl: icons.get(item.name.toLowerCase()) ?? item.iconUrl,
            }));
          const patch = {
            catalogs,
            installedPackages: enrich(this.state.installedPackages),
            implicitPackages: enrich(this.state.implicitPackages),
          };
          this.state = { ...this.state, ...patch };
          this.publishPackageEvent({ type: "stateDelta", patch });
        },
        inventory: (snapshot) => {
          if (snapshot.targetId !== this.state.selectedTargetId) return;
          this.packageDetails.cancel();
          this.inputPaths = snapshot.inputPaths;
          this.packageReferenceFingerprint =
            this.dataAdapter.fingerprint(snapshot.revision) ?? "";
          this.packageReferenceWatcher.setInputs(snapshot.inputPaths);
          const inventory = referenceInventory(snapshot);
          const installedReferences = snapshot.references.filter((reference) =>
            snapshot.projectPaths.includes(reference.projectPath),
          );
          this.state = PackageManagementCore.state.applyPackageInventory(
            this.state,
            inventory,
            this.state.availablePackages,
          );
          this.state = {
            ...this.state,
            installedReferences,
            targets: this.state.targets.map((target) =>
              target.id === snapshot.targetId
                ? { ...target, projectPaths: [...snapshot.projectPaths] }
                : target,
            ),
          };
          this.publishPackageEvent({
            type: "stateDelta",
            patch: {
              installedPackages: this.state.installedPackages,
              installedReferences,
              targets: this.state.targets,
              implicitPackages: this.state.implicitPackages,
              installedPackagesStatus: "ready",
              implicitPackagesStatus: "ready",
            },
          });
          void this.persistPackageCache().catch(() => {});
        },
        search: (availablePackages, query, context) => {
          if (
            context.targetId !== this.state.selectedTargetId ||
            query !== this.state.search
          )
            return;
          const icons = new Map(
            availablePackages
              .filter((item) => item.iconUrl)
              .map((item) => [item.name.toLowerCase(), item.iconUrl]),
          );
          const enrich = (items: NuGetPackageItem[]) =>
            items.map((item) => ({
              ...item,
              iconUrl: item.iconUrl ?? icons.get(item.name.toLowerCase()),
            }));
          const patch = {
            availablePackages,
            installedPackages: enrich(this.state.installedPackages),
            implicitPackages: enrich(this.state.implicitPackages),
          };
          this.state = { ...this.state, ...patch };
          this.publishPackageEvent({
            type: "stateDelta",
            patch,
          });
          void this.persistPackageCache().catch(() => {});
        },
        flow: (flow, value) => this.publishReadFlow(flow, value),
      },
    );
    this.solutionStatusBar = window.createStatusBarItem(
      StatusBarAlignment.Left,
      100,
    );
    this.solutionStatusBar.command = "nuget-code.selectSolution";
    this.packageStatusBar = window.createStatusBarItem(
      StatusBarAlignment.Left,
      99,
    );
    this.packageStatusBar.name = "NuGet package status";
    this.packageStatusBar.command = "nuget-code.refreshPackages";
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
      submit: (plan, target, context, automatic) =>
        this.submitMutation(plan, target, context, automatic),
    });
    this.folders = new FolderService({
      getState: () => this.state,
      setState: (state) => {
        this.state = state;
      },
      logger: this.logger,
      publish: (message) => this.publishPackageEvent(message),
      persistFolderSizeCache: (folders) => this.persistFolderSizeCache(folders),
      mutateCaches: async (folders, action) => {
        const plan: MutationPlan = {
          id: randomUUID(),
          targetId: this.state.selectedTargetId,
          contextRevision: this.state.updates.context.revision,
          steps: [
            {
              id: "cache",
              kind: "clear-cache",
              action: "clear",
              projectPaths: [],
              packageId: null,
              version: null,
              feedUrls: [],
              cachePaths: folders.map((folder) => folder.path),
            },
          ],
        };
        await this.mutations.submit(plan, {
          prepare: async () => ({ plan, execute: async () => action() }),
          reconcile: async () => {
            this.data.invalidate(this.state.selectedTargetId);
            await this.refreshPackages({ forceInventory: true });
          },
        });
      },
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
      () => this.refreshDiscovery(),
      () => {
        this.dataGeneration++;
        this.data.invalidate(this.state.selectedTargetId);
        this.packageDetails.cancel();
      },
    );

    this.disposables.push(
      this.network.onAuthenticationChanged((settings) => {
        if (settings !== this.settings || this.authenticationRefreshPending)
          return;
        this.authenticationRefreshPending = true;
        queueMicrotask(() => {
          void (async () => {
            try {
              await this.network.authentication.run(
                "host-context-refresh",
                async () => undefined,
              );
              if (settings === this.settings) await this.refreshPackages();
            } catch {
              /* Disposed or still-changing authentication remains unverified until retry. */
            } finally {
              this.authenticationRefreshPending = false;
            }
          })();
        });
      }),
      this.solutionStatusBar,
      this.packageStatusBar,
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
        this.cancelPackageReads();
        this.settings = { ...getSettings(), network: this.network };
        this.packageCache.setConfigurationRevision(() =>
          this.network.context(this.settings),
        );
        this.packageDetailsCache.clear();
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
    if (!message || typeof message.type !== "string")
      throw new Error("Invalid package-manager message.");
    if (
      message.type === "runCommand" &&
      (typeof message.command !== "string" ||
        (message.projectPaths !== undefined &&
          (!Array.isArray(message.projectPaths) ||
            message.projectPaths.some((file) => typeof file !== "string"))) ||
        (message.version !== undefined && typeof message.version !== "string"))
    )
      throw new Error("Invalid operation arguments.");
    switch (message.type) {
      case "ready":
        this.postState();
        return;
      case "cancelOperation":
        if (typeof message.operationId === "string")
          this.mutations.cancel(message.operationId);
        return;
      case "retryOperation":
        if (typeof message.operationId === "string")
          await this.mutations.retry(message.operationId);
        return;
      case "confirmOperation":
        if (
          typeof message.operationId === "string" &&
          typeof message.contextRevision === "string" &&
          typeof message.accepted === "boolean"
        )
          this.mutations.confirm(
            message.operationId,
            message.contextRevision,
            message.accepted,
          );
        return;
      case "setActiveTab":
        await this.setActiveTab(message.tab);
        return;
      case "selectTarget":
        if (
          !this.state.targets.some((target) => target.id === message.targetId)
        )
          throw new Error("The selected target is no longer available.");
        await this.setSelectedTarget(message.targetId);
        return;
      case "openPackageLink": {
        const item = this.state.packageDetails?.packageItem;
        const url = packageMetadataUrl(message.url);
        if (
          !url ||
          !item ||
          ![item.projectUrl, item.licenseUrl, item.packageUrl].includes(url)
        )
          throw new Error("The package link is no longer available.");
        await env.openExternal(Uri.parse(url));
        return;
      }
      case "openPackageFolder": {
        const item = this.state.packageDetails?.packageItem;
        const installation = item?.localInstallations?.find(
          (entry) => entry.path === message.path,
        );
        if (!item || !installation)
          throw new Error("The package installation is no longer available.");
        const installations = await packageInstallations(
          item.name,
          [installation.version],
          this.state.folders
            .filter((folder) => folder.title === "global-packages")
            .map((folder) => folder.path),
        );
        if (!installations.some((entry) => entry.path === installation.path))
          throw new Error("The package installation is no longer available.");
        await commands.executeCommand(
          "revealFileInOS",
          Uri.file(installation.path),
        );
        return;
      }
      case "setFeedFilter":
        await this.setFeedFilter(message.filter);
        return;
      case "upgradeCandidates":
        await this.packageCommands.upgradeCandidates(
          message.keys,
          message.revision,
        );
        return;
      case "selectFeed":
        if (!this.state.feeds.some((feed) => feed.id === message.feedId))
          throw new Error("The selected feed is no longer available.");
        await this.setSelectedFeed(message.feedId);
        return;
      case "setSearch":
        if (typeof message.search !== "string")
          throw new Error("Invalid search text.");
        this.state = { ...this.state, search: message.search };
        this.postState();
        await this.refreshAvailablePackages();
        return;
      case "setIncludePrerelease":
        if (typeof message.includePrerelease !== "boolean")
          throw new Error("Invalid preview filter.");
        this.cancelSearchReads();
        this.state = {
          ...this.state,
          includePrerelease: message.includePrerelease,
        };
        this.syncDataContext();
        this.postState();
        await this.refreshAvailablePackages();
        return;
      case "selectPackage":
        this.packageDetails.cancel();
        this.state = { ...this.state, selectedPackageId: message.packageId };
        this.postState();
        return;
      case "loadPackageDetails":
        await this.packageDetails.loadPackageDetails(
          message.packageId,
          message.feedId,
          message.version,
        );
        return;
      case "sourceEditor":
        await this.describeSourceEditor(message.reload);
        return;
      case "editSource":
        await this.editSource(message.request);
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

  reportMessageError(error: unknown): void {
    const message =
      error instanceof Error ? error.message : "Package operation failed.";
    this.logger.warning("vscode", message);
    void window.showErrorMessage(message);
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
          await this.setSelectedFeedForRefresh(options.feedId);
        }
        await this.refreshPackages({ forceInventory: true });
        return;
      case "upgradePackages":
        await this.packageCommands.upgradePackages();
        return;
      case "reloadSources":
        await this.describeSourceEditor(true);
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
          "@ext:baliestri.nuget-code",
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
    this.disposed = true;
    this.sourceEditorRevision++;
    this.sourceEditor.invalidate();
    this.mutations.dispose();
    this.network.dispose();
    this.data.dispose();
    this.dataAdapter.dispose();
    this.packageDetails.dispose();
    this.packageReferenceWatcher.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.events.dispose();
    this.packageDetailsCache.clear();
    void this.packageCache.flush();
  }

  private async initializeCore(): Promise<void> {
    await migrateLegacyPackageCache(this.storage).catch(() =>
      this.logger.warning(
        "cache",
        "Could not remove a legacy package cache; it will not be read.",
      ),
    );
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
        const selectedTargetId = await this.resolveSelectedTarget();
        const sources = await loadPackageSources(
          this.settings,
          this.logger,
          this.discovery.targets.find(
            (target) => target.id === selectedTargetId,
          ),
        );
        const effectiveFeeds = sources[0]?.feeds ?? [];
        const folders = PackageManagementCore.folders.applyCachedFolderSizes(
          await NuGetClient.loadCacheFolders(this.cli, this.logger),
          this.storage.get<FolderSizeCache>(folderSizeCacheKey, {}),
        );

        this.state = {
          ...this.state,
          targets: this.discovery.targets,
          selectedTargetId,
          searchResultLimit: this.settings.maxSearchResults,
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

        this.restoreFeedFilter();
        this.packageReferenceWatcher.register();
        const fingerprint = await this.createPackageReferenceFingerprint();
        const cached = await this.hydrateCachedPackages();
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
      const targetId = this.state.selectedTargetId;
      const sources = await loadPackageSources(
        this.settings,
        this.logger,
        this.discovery.targets.find((target) => target.id === targetId),
      );
      if (this.state.selectedTargetId !== targetId) return;
      const effectiveFeeds = sources[0]?.feeds ?? [];
      this.packageDetailsCache.clear();

      this.state = {
        ...this.state,
        sources,
        selectedSourceId: sources.some(
          (source) => source.id === this.state.selectedSourceId,
        )
          ? this.state.selectedSourceId
          : sources[0]?.id,
        feeds: [PackageManagementCore.feeds.allFeeds, ...effectiveFeeds],
        selectedFeedId: PackageManagementCore.feeds.selectInitialFeed(
          [PackageManagementCore.feeds.allFeeds, ...effectiveFeeds],
          this.state.selectedFeedId,
          this.settings.defaultFeed,
        ),
      };

      this.restoreFeedFilter();
      this.postState();
      void this.feedHealth.check(effectiveFeeds);
      this.data.invalidate(targetId);
      await this.refreshPackages({ forceInventory: true });
    });
  }

  private async describeSourceEditor(reload = false): Promise<void> {
    if (this.sourceEditPending || this.disposed) return;
    const revision = ++this.sourceEditorRevision;
    const targetId = this.state.selectedTargetId;
    const isCurrent = () =>
      revision === this.sourceEditorRevision &&
      this.state.selectedTargetId === targetId &&
      !this.sourceEditPending;
    this.state = {
      ...this.state,
      sourceEditor: {
        destinations: [],
        status: "loading",
        message: "Loading source configuration…",
      },
    };
    this.postState();
    try {
      if (reload) await this.reloadSources();
      if (!isCurrent()) return;
      const destinations = await this.sourceEditor.describe(
        this.state.sources,
        workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
        this.state.targets.find((target) => target.id === targetId),
        this.settings.sourceSaveIn,
      );
      if (!isCurrent()) return;
      this.state = {
        ...this.state,
        sourceEditor: { destinations, status: "idle", message: "" },
      };
    } catch (error) {
      if (!isCurrent()) return;
      this.state = {
        ...this.state,
        sourceEditor: {
          destinations: [],
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "Could not load source destinations. Reload to retry.",
        },
      };
    }
    this.postState();
  }

  private async editSource(
    request: import("#contracts").SourceEditRequest,
  ): Promise<void> {
    if (
      this.disposed ||
      this.sourceEditPending ||
      this.state.sourceEditor?.status === "loading"
    )
      return;
    this.sourceEditPending = true;
    const revision = ++this.sourceEditorRevision;
    const targetId = this.state.selectedTargetId;
    const target = this.state.targets.find((target) => target.id === targetId);
    const settings = this.settings;
    const isCurrent = () =>
      revision === this.sourceEditorRevision &&
      this.state.selectedTargetId === targetId &&
      settings === this.settings;
    const requestId = request?.requestId;
    this.state = {
      ...this.state,
      sourceEditor: {
        destinations: this.state.sourceEditor?.destinations ?? [],
        status: "saving",
        message: "Saving source configuration…",
        requestId,
      },
    };
    this.postState();
    let status: "saved" | "failed" = "saved";
    let message = "";
    let savedFile: string | undefined;
    try {
      await this.mutations.exclusive(() =>
        this.packageReferenceWatcher.suspendDuring(async () => {
          try {
            if (!isCurrent())
              throw new Error("The selected context changed. Reload Sources.");
            const sources = await loadPackageSources(
              settings,
              this.logger,
              target,
            );
            if (!isCurrent())
              throw new Error("The selected context changed. Reload Sources.");
            const file = await this.sourceEditor.apply(
              request,
              sources,
              isCurrent,
            );
            savedFile = file;
            message = `Saved ${file}. This destination may affect other projects; descendant configs can override it.`;
          } catch (error) {
            status = "failed";
            message =
              error instanceof Error
                ? error.message
                : "Could not save source configuration.";
          } finally {
            // Reconciliation remains inside the mutation slot, including partial editor saves.
            if (isCurrent()) {
              try {
                await this.reloadSources();
                if (savedFile)
                  message = sourceEditSummary(
                    savedFile,
                    request.edit,
                    this.state.sources,
                  );
              } catch {
                status = "failed";
                message += " Could not reload sources; retry refresh.";
              }
            }
          }
        }),
      );
    } catch (error) {
      status = "failed";
      message =
        error instanceof Error
          ? error.message
          : "Could not save source configuration.";
    } finally {
      this.sourceEditPending = false;
    }
    if (!isCurrent()) {
      if (
        !this.state.sourceEditor?.destinations.length &&
        !this.state.sourceEditor?.message
      )
        await this.describeSourceEditor();
      return;
    }
    let destinations: import("#contracts").SourceDestination[] = [];
    try {
      destinations = await this.sourceEditor.describe(
        this.state.sources,
        workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
        target,
        this.settings.sourceSaveIn,
      );
    } catch {
      status = "failed";
      message += " Could not reload destinations; reload the editor.";
    }
    if (!isCurrent()) return;
    this.state = {
      ...this.state,
      sourceEditor: { destinations, status, message, requestId },
    };
    this.postState();
  }

  private async refreshPackages(
    options: { forceInventory?: boolean | undefined } = {},
  ): Promise<void> {
    if (options.forceInventory) {
      this.packageDetails.cancel();
      this.packageDetailsCache.clear();
    }
    this.syncDataContext();
    await Promise.all([
      this.data.refresh({ force: options.forceInventory ?? false }),
      this.data.search(this.state.search),
    ]);
    if (options.forceInventory) await this.packageDetails.refresh();
  }

  private async submitMutation(
    plan: MutationPlan,
    target: WorkspaceTarget,
    context: UpgradeContext,
    automatic: boolean,
  ): Promise<unknown> {
    const captured = {
      ...this.dataEnvironment(target.id),
      target: structuredClone(target),
    };
    const port = new PackageMutationPort(
      { context: structuredClone(context), environment: captured, automatic },
      () => this.dataEnvironment(target.id),
      this.logger,
      async (environment) => {
        const adapter = new PackageDataAdapter(() => environment, this.logger);
        try {
          const snapshot = await adapter.loadInventory(
            { ...context, revision: environment.sourceRevision },
            new AbortController().signal,
          );
          const inventory = referenceInventory(snapshot);
          const cacheState = {
            ...this.state,
            selectedTargetId: target.id,
            installedPackages: inventory.installed,
            implicitPackages: inventory.implicit,
            installedPackagesStatus: "ready" as const,
            implicitPackagesStatus: "ready" as const,
            availablePackages: [],
          };
          await this.packageCache.persist(cacheState, {
            fingerprint: adapter.fingerprint(snapshot.revision),
          });
          if (this.state.selectedTargetId === target.id) {
            this.data.invalidate(target.id);
            await this.refreshPackages({ forceInventory: true });
            if (this.state.flows.inventory.status === "failed")
              throw new Error("Package inventory could not be reconciled.");
          }
        } finally {
          adapter.dispose();
        }
      },
    );
    // Keep the queue slot through reconciliation; suspend watchers only while this queued job runs.
    const wrapped = {
      run: <T>(work: () => Promise<T>) =>
        this.packageReferenceWatcher.suspendDuring(work),
      prepare: (next: MutationPlan, signal: AbortSignal) =>
        port.prepare(next, signal),
      reconcile: (next: MutationPlan) => port.reconcile(next),
    };
    return this.mutations.submit(plan, wrapped);
  }

  private async refreshAvailablePackages(): Promise<void> {
    this.syncDataContext();
    void this.data
      .refresh({ force: false })
      .catch(() =>
        this.logger.warning(
          "nuget.packages",
          "Could not refresh package facts.",
        ),
      );
    await this.data.search(this.state.search);
  }

  private async setSelectedTarget(targetId: string): Promise<void> {
    this.sourceEditorRevision++;
    this.sourceEditor.invalidate();
    this.state = {
      ...this.state,
      sourceEditor: { destinations: [], status: "idle", message: "" },
    };
    this.cancelPackageReads();
    this.state = {
      ...this.state,
      selectedTargetId: targetId,
      feedFilter: undefined,
      selectedFeedId: this.settings.defaultFeed,
      selectedPackageId: undefined,
      installedPackages: [],
      installedReferences: [],
      catalogs: [],
      implicitPackages: [],
      availablePackages: [],
      installedPackagesStatus: "idle",
      implicitPackagesStatus: "idle",
      hasUpgrades: false,
    };
    const sources = await loadPackageSources(
      this.settings,
      this.logger,
      this.discovery.targets.find((target) => target.id === targetId),
    );
    if (this.state.selectedTargetId !== targetId) return;
    const feeds = [
      PackageManagementCore.feeds.allFeeds,
      ...(sources[0]?.feeds ?? []),
    ];
    this.state = {
      ...this.state,
      sources,
      feeds,
      selectedSourceId: sources[0]?.id,
      selectedFeedId: PackageManagementCore.feeds.selectInitialFeed(
        feeds,
        this.state.selectedFeedId,
        this.settings.defaultFeed,
      ),
    };
    this.restoreFeedFilter();
    this.hydratePackageDetailsCache(await this.hydrateCachedPackages());
    this.updateSolutionStatusBar();
    this.postState();
    if (this.state.activeTab === "sources") await this.describeSourceEditor();
    await this.refreshPackages();
  }

  private restoreFeedFilter(): void {
    const stored = this.storage.get<PackageFeedFilter>(
      `nuget-code.packageManager.feedFilter:${this.state.selectedTargetId}`,
    );
    this.state = {
      ...this.state,
      feedFilter: normalizeFeedFilter(
        stored ??
          (this.feedFilterTargetId === this.state.selectedTargetId
            ? this.state.feedFilter
            : undefined),
        this.state.feeds,
        this.feedFilterTargetId &&
          this.feedFilterTargetId !== this.state.selectedTargetId
          ? this.settings.defaultFeed
          : this.state.selectedFeedId,
      ),
    };
    this.feedFilterTargetId = this.state.selectedTargetId;
    if (JSON.stringify(stored) !== JSON.stringify(this.state.feedFilter))
      void this.storage
        .update(
          `nuget-code.packageManager.feedFilter:${this.state.selectedTargetId}`,
          this.state.feedFilter,
        )
        .then(undefined, () =>
          this.logger.warning(
            "nuget.feeds",
            "Could not persist the package feed preference.",
          ),
        );
  }

  private async setFeedFilter(filter: PackageFeedFilter): Promise<void> {
    if (
      !filter ||
      (filter.mode !== "all" &&
        (filter.mode !== "selected" ||
          !Array.isArray(filter.ids) ||
          filter.ids.some((id) => typeof id !== "string")))
    )
      throw new Error("Invalid package feed filter.");
    this.cancelSearchReads();
    const feedFilter = normalizeFeedFilter(filter, this.state.feeds);
    this.feedFilterTargetId = this.state.selectedTargetId;
    this.state = {
      ...this.state,
      feedFilter,
      selectedPackageId: undefined,
      availablePackages: [],
    };
    this.syncDataContext();
    this.postState();
    await this.storage.update(
      `nuget-code.packageManager.feedFilter:${this.state.selectedTargetId}`,
      feedFilter,
    );
    await this.refreshAvailablePackages();
  }

  private async setSelectedFeed(feedId: string): Promise<void> {
    await this.setFeedFilter(
      feedId === "__all__"
        ? { mode: "all" }
        : { mode: "selected", ids: [feedId] },
    );
  }

  private async setSelectedFeedForRefresh(feedId: string): Promise<void> {
    await this.setSelectedFeed(feedId);
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

  private publishPackageEvent(message: PackageManagerEvent): void {
    if (this.packageStatusBar) {
      const status = packageStatus(this.state);
      this.packageStatusBar.text = status.text;
      this.packageStatusBar.tooltip = status.tooltip;
      this.packageStatusBar.show();
    }
    this.events.publish(this.messages.next(message));
  }

  private async hydrateCachedPackages(
    options: { preserveSelection?: boolean | undefined } = {},
  ): Promise<PackageStateCacheEntry | undefined> {
    const snapshot = this.state;
    const settings = this.settings;
    const entry = await this.packageCache.read(snapshot);
    if (this.settings !== settings || !sameCacheContext(this.state, snapshot))
      return undefined;
    this.state = hydrateCachedPackages(this.state, entry, {
      ...options,
      preserveSelection:
        options.preserveSelection ||
        this.state.selectedPackageId !== snapshot.selectedPackageId,
    });
    return entry;
  }

  private async persistPackageCache(): Promise<void> {
    const details = this.packageDetailsCache
      .snapshot()
      .filter(
        (entry) =>
          entry.revision === this.network.context(this.settings) &&
          (entry.expiresAt === null || entry.expiresAt > Date.now()),
      );
    await this.packageCache.persist(this.state, {
      fingerprint: this.packageReferenceFingerprint,
      packageDetails: Object.fromEntries(
        details.map((entry) => [entry.key, entry.value as NuGetPackageItem]),
      ),
      detailExpirations: Object.fromEntries(
        details.map((entry) => [
          entry.key,
          entry.expiresAt ?? Date.now() + cachePolicy.metadataTtlMs,
        ]),
      ),
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

  private cancelSearchReads(): void {
    this.data.cancelSearch();
    this.packageDetails.cancel();
  }

  private cancelPackageReads(): void {
    this.data.invalidate(this.state.selectedTargetId);
    this.packageDetails.cancel();
    this.inputPaths = [];
  }

  private dataEnvironment(targetId: string): DataEnvironment {
    const feeds = this.state.feeds.filter((feed) => feed.id !== "__all__");
    const configPaths = [
      ...new Set(
        this.state.sources.map((source) => source.path).filter(Boolean),
      ),
    ];
    const sourceRevision = createHash("sha256")
      .update(
        JSON.stringify([
          this.dataGeneration,
          this.network.context(this.settings),
          this.settings.dotnetPath,
          feeds,
          configPaths,
        ]),
      )
      .digest("hex");
    return {
      target: this.discovery.targets.find((target) => target.id === targetId),
      feeds: structuredClone(feeds),
      configPaths,
      allowedRoots:
        workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
      settings: this.settings,
      cli: this.cli,
      sourceRevision,
    };
  }

  private syncDataContext(): void {
    const environment = this.dataEnvironment(this.state.selectedTargetId);
    const target = environment.target;
    const context: UpgradeContext = {
      targetId: this.state.selectedTargetId,
      projectPaths: target
        ? target.kind === "project"
          ? [target.path]
          : target.projectPaths
        : [],
      feedUrls: queryFeedUrls(this.state),
      includePrerelease: this.state.includePrerelease,
      revision: environment.sourceRevision,
    };
    const key = JSON.stringify(context);
    if (key !== this.activeDataContextKey) {
      this.activeDataContextKey = key;
      this.packageDetails.cancel();
    }
    this.data.setContext(context);
  }

  private publishReadFlow(flow: ReadFlow, value: LoadState): void {
    const hasDisplayData =
      flow === "inventory"
        ? this.state.installedPackages.length +
            this.state.implicitPackages.length >
          0
        : flow === "search"
          ? this.state.availablePackages.length > 0
          : flow === "catalog"
            ? this.state.updates.evaluation.candidates.length > 0
            : !!this.state.packageDetails;
    const patch = {
      flows: {
        ...this.state.flows,
        [flow]: {
          ...value,
          stale: value.stale || (value.status !== "ready" && hasDisplayData),
        },
      },
      ...(flow === "inventory"
        ? {
            installedPackagesStatus: value.status,
            implicitPackagesStatus: value.status,
          }
        : {}),
    };
    this.state = { ...this.state, ...patch };
    this.publishPackageEvent({ type: "stateDelta", patch });
  }

  private createPackageReferenceFingerprint(): Promise<string> {
    return createPackageReferenceFingerprint({
      target: PackageManagementCore.selection.getSelectedTarget(this.state),
      centralPackageFiles: this.discovery.centralPackageFiles,
      inputPaths: this.inputPaths,
    });
  }

  private hydratePackageDetailsCache(
    entry: PackageStateCacheEntry | undefined,
  ): void {
    this.packageDetailsCache.clear();
    const now = Date.now();
    for (const [key, value] of Object.entries(entry?.packageDetails ?? {}))
      this.packageDetailsCache.put({
        schema: 2,
        key,
        value,
        revision: entry?.metadataRevision ?? "",
        savedAt: now,
        accessedAt: now,
        expiresAt:
          entry?.detailExpirations?.[key] ?? now + cachePolicy.metadataTtlMs,
      });
  }

  private packageDetailsCacheAdapter(): PackageDetailsCache {
    const settings = this.settings;
    const feeds = this.state.feeds;
    const revision = this.network.context(settings);
    const current = () =>
      this.settings === settings &&
      this.state.feeds === feeds &&
      this.network.context(settings) === revision;
    return {
      get: (key) => {
        if (!current()) return undefined;
        const hit = this.packageDetailsCache.get<NuGetPackageItem>(
          packageDetailCacheIdentity(key),
          false,
        );
        return hit?.revision === revision ? hit.value : undefined;
      },
      set: (key, value) => {
        if (!current()) return;
        const now = Date.now();
        this.packageDetailsCache.put({
          schema: 2,
          key: packageDetailCacheIdentity(key),
          value,
          revision,
          savedAt: now,
          accessedAt: now,
          expiresAt: now + cachePolicy.metadataTtlMs,
        });
      },
    };
  }

  private async resolveSelectedTarget(): Promise<string> {
    const targets = this.discovery.targets;
    const currentTargetStillValid = targets.some(
      (t) => t.id === this.state.selectedTargetId,
    );
    if (currentTargetStillValid) return this.state.selectedTargetId;

    const solutions = targets.filter((t) => t.kind === "solution");
    if (solutions.length === 0) {
      const fallbackId = targets[0]?.id ?? "";
      if (!fallbackId) {
        void window.showWarningMessage(
          "No solution file was found in this workspace.",
        );
      }
      return fallbackId;
    }

    return this.solutionSelector.resolve(solutions);
  }

  private refreshDiscovery(): Promise<void> {
    this.discoveryRefreshChain = this.discoveryRefreshChain
      .catch(() => {})
      .then(() => this.performDiscoveryRefresh());
    return this.discoveryRefreshChain;
  }

  private async performDiscoveryRefresh(): Promise<void> {
    this.cancelPackageReads();
    if (this.initialization) {
      await this.initialization;
    }

    this.discovery = await discoverWorkspace(this.logger);
    const selectedTargetId = await this.resolveSelectedTarget();
    const sources = await loadPackageSources(
      this.settings,
      this.logger,
      this.discovery.targets.find((target) => target.id === selectedTargetId),
    );
    const feeds = [
      PackageManagementCore.feeds.allFeeds,
      ...(sources[0]?.feeds ?? []),
    ];
    this.packageDetailsCache.clear();

    this.state = {
      ...this.state,
      targets: this.discovery.targets,
      selectedTargetId,
      sources,
      feeds,
      selectedSourceId: sources[0]?.id,
      selectedFeedId: PackageManagementCore.feeds.selectInitialFeed(
        feeds,
        this.state.selectedFeedId,
        this.settings.defaultFeed,
      ),
    };

    this.restoreFeedFilter();
    this.updateSolutionStatusBar();
    this.postState();
    await this.refreshPackages({ forceInventory: true });
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

function sameCacheContext(
  left: PackageManagerState,
  right: PackageManagerState,
): boolean {
  return (
    left.selectedTargetId === right.selectedTargetId &&
    JSON.stringify(queryFeedUrls(left)) ===
      JSON.stringify(queryFeedUrls(right)) &&
    left.search === right.search &&
    left.includePrerelease === right.includePrerelease &&
    left.feeds === right.feeds &&
    left.targets === right.targets
  );
}
