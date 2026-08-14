import path from "node:path";
import { workspace } from "vscode";
import type { WorkspaceTarget } from "#contracts";
import { ExtensionLogger } from "#extension/logger";

export const projectFileGlob = "**/*.{csproj,fsproj,vbproj}";
export const solutionFileGlob = "**/*.{sln,slnx}";
const excludeGlob = "**/{node_modules,bin,obj}/**";

export interface WorkspaceDiscovery {
  targets: WorkspaceTarget[];
  projectPaths: string[];
  centralPackageFiles: string[];
}

export async function discoverWorkspace(
  logger: ExtensionLogger,
): Promise<WorkspaceDiscovery> {
  const solutionUris = await workspace.findFiles(solutionFileGlob, excludeGlob);
  const projectUris = await workspace.findFiles(projectFileGlob, excludeGlob);
  const centralPackageUris = await workspace.findFiles(
    "**/Directory.Packages.props",
    excludeGlob,
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

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
