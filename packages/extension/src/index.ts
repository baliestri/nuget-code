import { commands, window, workspace, type ExtensionContext } from "vscode";
import type { PackageManagerCommand, PackageManagerTab } from "#contracts";
import { ExtensionLogger } from "#extension/logger";
import { PackageManagerController } from "#extension/webview/controller";
import { PackageManagerViewProvider } from "#extension/webview/view";
import { SolutionSelector } from "#extension/solution-selector";
import { getSettings } from "#extension/settings";
import path from "node:path";
import { cachePolicy } from "#client/cache";
import { CacheStore, memoryCacheStorage } from "#extension/webview/cache-store";
import { FileCacheStorage } from "#extension/webview/file-cache-storage";
import { PackageCache } from "#extension/webview/package-cache";

let activeCache: PackageCache | undefined;

const viewId = "nuget-code.packageManager";
const configSection = "nuget-code";

const commandMap: Array<[string, PackageManagerCommand]> = [
  ["nuget-code.restorePackages", "restore"],
  ["nuget-code.refreshPackages", "refreshPackages"],
  ["nuget-code.upgradePackages", "upgradePackages"],
  ["nuget-code.reloadSources", "reloadSources"],
  ["nuget-code.recalculateCacheSizes", "recalculateCacheSizes"],
  ["nuget-code.openCacheFolder", "openCacheFolder"],
  ["nuget-code.clearSelectedCaches", "clearSelectedCaches"],
  ["nuget-code.clearLogs", "clearLogs"],
  ["nuget-code.refreshLogs", "refreshLogs"],
  ["nuget-code.openSettings", "openSettings"],
];
const tabCommandMap: Array<[string, PackageManagerTab]> = [
  ["nuget-code.showPackages", "packages"],
  ["nuget-code.showSources", "sources"],
  ["nuget-code.showFolders", "folders"],
  ["nuget-code.showLogs", "logs"],
  ["nuget-code.showPackagesLabel", "packages"],
  ["nuget-code.showSourcesLabel", "sources"],
  ["nuget-code.showFoldersLabel", "folders"],
  ["nuget-code.showLogsLabel", "logs"],
];

export function activate(context: ExtensionContext) {
  const logger = new ExtensionLogger(getSettings());
  const solutionSelector = new SolutionSelector(context.workspaceState);
  const backend =
    context.storageUri?.scheme === "file"
      ? new FileCacheStorage(
          path.join(context.storageUri.fsPath, "nuget-cache-v2"),
        )
      : memoryCacheStorage();
  if (!context.storageUri || context.storageUri.scheme !== "file")
    logger.information(
      "cache",
      "Workspace persistence is unavailable; package cache is memory-only.",
    );
  const store = new CacheStore(
    backend,
    cachePolicy.workspaceBytes,
    Date.now,
    () =>
      logger.warning(
        "cache",
        "Package cache persistence failed; bounded memory data remains available.",
      ),
  );
  const cache = new PackageCache(store);
  activeCache = cache;
  const controller = new PackageManagerController(
    logger,
    context.globalState,
    solutionSelector,
    cache,
  );
  const provider = new PackageManagerViewProvider(context, controller);

  context.subscriptions.push(
    logger,
    provider,
    window.registerWebviewViewProvider(viewId, provider),
    ...commandMap.map(([commandId, command]) =>
      commands.registerCommand(commandId, () => controller.runCommand(command)),
    ),
    commands.registerCommand("nuget-code.openPackageManager", (item) =>
      controller.openPackageManagerFromContext(item),
    ),
    commands.registerCommand("nuget-code.selectSolution", () =>
      controller.selectSolution(),
    ),
    commands.registerCommand("nuget-code.clearSelectedSolution", () =>
      controller.clearSelectedSolution(),
    ),
    ...tabCommandMap.map(([commandId, tab]) =>
      commands.registerCommand(commandId, () => controller.setActiveTab(tab)),
    ),
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(configSection)) {
        void updateTabButtonStyleContext();
      }
    }),
  );

  void updateTabButtonStyleContext();
  void controller.initialize();
}

export function deactivate(): Promise<void> | undefined {
  return activeCache?.flush();
}

async function updateTabButtonStyleContext(): Promise<void> {
  await commands.executeCommand(
    "setContext",
    "nuget-code.packageManager.tabButtonStyle",
    getSettings().tabButtonStyle,
  );
}
