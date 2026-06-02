import { workspace } from "vscode";
import { NuGetClient } from "#client";
import type { ExtensionLogger } from "#extension/logger";
import type { ExtensionSettings } from "#extension/settings";

export async function loadPackageSources(
  settings: ExtensionSettings,
  logger: ExtensionLogger,
) {
  const workspaceConfigPaths = await workspace.findFiles(
    "**/{NuGet.config,nuget.config,NuGet.Config}",
    "**/{node_modules,bin,obj}/**",
  );

  return NuGetClient.loadSources(settings, logger, {
    workspaceConfigPaths: workspaceConfigPaths.map((uri) => uri.fsPath),
    workspaceFolderPaths:
      workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
  });
}
