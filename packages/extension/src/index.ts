import { commands, window, workspace, type ExtensionContext } from "vscode";
import type { PackageManagerCommand, PackageManagerTab } from "#contracts";
import { ExtensionLogger } from "#extension/logger";
import { PackageManagerController } from "#extension/webview/controller";
import { PackageManagerViewProvider } from "#extension/webview/view";
import { getSettings } from "#extension/settings";

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
  const controller = new PackageManagerController(logger, context.globalState);
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

export function deactivate() {}

async function updateTabButtonStyleContext(): Promise<void> {
  await commands.executeCommand(
    "setContext",
    "nuget-code.packageManager.tabButtonStyle",
    getSettings().tabButtonStyle,
  );
}
