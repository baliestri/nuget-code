import path from "node:path";
import { workspace } from "vscode";
import type { LogLevel } from "#contracts/logging";

export interface ExtensionSettings {
  tabButtonStyle: "icons" | "labels";
  logLevel: LogLevel;
  maxLogEntries: number;
  defaultFeed: string;
  includePrerelease: boolean;
  maxSearchResults: number;
  dotnetPath: string;
  nugetPath: string;
  extraConfigPaths: string[];
  credentialProviderPaths: string[];
  proxy: string;
  workspacePath?: string | undefined;
  useVsCodeProxy: boolean;
  calculateCacheSizesOnLoad: boolean;
}

export function getSettings(): ExtensionSettings {
  const config = workspace.getConfiguration("nuget-code");
  const httpConfig = workspace.getConfiguration("http");
  const proxy = config.get<string>("proxy", "");

  return {
    tabButtonStyle: config.get<"icons" | "labels">("tabButtonStyle", "labels"),
    logLevel: config.get<LogLevel>("logLevel", "information"),
    maxLogEntries: config.get<number>("maxLogEntries", 1000),
    defaultFeed: config.get<string>("defaultFeed", "__all__"),
    includePrerelease: config.get<boolean>("includePrerelease", false),
    maxSearchResults: config.get<number>("maxSearchResults", 100),
    dotnetPath: config.get<string>("dotnetPath", "dotnet"),
    nugetPath: config.get<string>("nugetPath", "nuget"),
    extraConfigPaths: config.get<string[]>("extraConfigPaths", []),
    credentialProviderPaths: config.get<string[]>(
      "credentialProviderPaths",
      [],
    ),
    proxy:
      proxy ||
      (config.get<boolean>("useVsCodeProxy", true)
        ? httpConfig.get<string>("proxy", "")
        : ""),
    workspacePath: getWorkspacePath(),
    useVsCodeProxy: config.get<boolean>("useVsCodeProxy", true),
    calculateCacheSizesOnLoad: config.get<boolean>(
      "calculateCacheSizesOnLoad",
      false,
    ),
  };
}

function getWorkspacePath(): string | undefined {
  if (workspace.workspaceFile?.fsPath) {
    return path.dirname(workspace.workspaceFile.fsPath);
  }

  return workspace.workspaceFolders?.[0]?.uri.fsPath;
}
