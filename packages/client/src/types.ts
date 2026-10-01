import type { ClientNetwork } from "#client/client-network";

export interface NuGetClientSettings {
  network?: ClientNetwork | undefined;
  credentialProviderPaths: string[];
  dotnetPath: string;
  extraConfigPaths: string[];
  maxSearchResults: number;
  nugetPath: string;
  proxy: string;
  workspacePath?: string | undefined;
}

export interface NuGetClientLogger {
  error(context: string, message: string): void;
  information(context: string, message: string): void;
  verbose(context: string, message: string): void;
  warning(context: string, message: string): void;
}

export interface NuGetWorkspaceConfigOptions {
  solutionDirectory?: string;
  projectPaths?: readonly string[];
  workspaceConfigPaths?: string[];
  workspaceFolderPaths?: string[];
}
