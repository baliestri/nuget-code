import path from "node:path";
import { Uri, workspace } from "vscode";
import type { WorkspaceTarget } from "#contracts";
import { ExtensionLogger } from "#extension/logger";

const projectPatterns = ["**/*.csproj", "**/*.fsproj", "**/*.vbproj"];
const solutionPatterns = ["**/*.sln", "**/*.slnx"];

export interface WorkspaceDiscovery {
  targets: WorkspaceTarget[];
  projectPaths: string[];
  centralPackageFiles: string[];
}

export async function discoverWorkspace(
  logger: ExtensionLogger,
): Promise<WorkspaceDiscovery> {
  const solutionUris = await findMany(solutionPatterns);
  const projectUris = await findMany(projectPatterns);
  const centralPackageUris = await workspace.findFiles(
    "**/Directory.Packages.props",
    "**/{node_modules,bin,obj}/**",
  );
  const projectPaths = unique(projectUris.map((uri) => uri.fsPath));
  const targets: WorkspaceTarget[] = [
    ...solutionUris.map((uri) => ({
      id: `solution:${uri.fsPath}`,
      kind: "solution" as const,
      name: path.basename(uri.fsPath),
      path: uri.fsPath,
      projectPaths: [...projectPaths],
    })),
    ...projectPaths.map((projectPath) => ({
      id: `project:${projectPath}`,
      kind: "project" as const,
      name: path.basename(projectPath, path.extname(projectPath)),
      path: projectPath,
      projectPaths: [projectPath],
    })),
  ];

  logger.information(
    "workspace",
    `Discovered ${solutionUris.length} solution(s), ${projectPaths.length} project(s), ${centralPackageUris.length} central package file(s)`,
  );

  return {
    targets,
    projectPaths,
    centralPackageFiles: centralPackageUris.map((uri) => uri.fsPath),
  };
}

async function findMany(patterns: string[]): Promise<Uri[]> {
  const uriGroups = await Promise.all(
    patterns.map((pattern) =>
      workspace.findFiles(pattern, "**/{node_modules,bin,obj}/**"),
    ),
  );
  return uriGroups.flat();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
