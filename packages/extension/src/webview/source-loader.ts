import { workspace } from "vscode";
import { NuGetClient } from "#client";
import type { ExtensionLogger } from "#extension/logger";
import type { ExtensionSettings } from "#extension/settings";
import type { WorkspaceTarget } from "#contracts";

export async function loadPackageSources(
  settings: ExtensionSettings,
  logger: ExtensionLogger,
  target?: WorkspaceTarget,
) {
  const workspaceConfigPaths = await workspace.findFiles(
    "**/{NuGet.config,nuget.config,NuGet.Config}",
    "**/{node_modules,bin,obj,artifacts,.git}/**",
  );

  return NuGetClient.loadSources(settings, logger, {
    projectPaths: target
      ? target.kind === "project"
        ? [target.path]
        : target.projectPaths
      : [],
    workspaceConfigPaths: workspaceConfigPaths.map((uri) => uri.fsPath),
    workspaceFolderPaths:
      workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
  });
}
