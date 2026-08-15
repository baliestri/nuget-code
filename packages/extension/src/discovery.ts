import fs from "node:fs/promises";
import path from "node:path";
import { workspace } from "vscode";
import type { WorkspaceTarget } from "#contracts";
import { ExtensionLogger } from "#extension/logger";

export const projectFileGlob = "**/*.{csproj,fsproj,vbproj}";
export const solutionFileGlob = "**/*.{sln,slnx}";
const excludeGlob = "**/{node_modules,bin,obj}/**";

const classicProjectLinePattern =
  /^Project\("\{[0-9A-F-]+\}"\)\s*=\s*"[^"]*",\s*"([^"]+)"/gim;
const slnxProjectPathPattern = /<Project\b[^>]*\bPath="([^"]*)"/gi;
const knownProjectExtensions = new Set([".csproj", ".fsproj", ".vbproj"]);

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
  const solutionProjectPaths = await Promise.all(
    solutionUris.map((uri) =>
      resolveSolutionProjectPaths(uri.fsPath, projectPaths, logger),
    ),
  );

  const targets: WorkspaceTarget[] = [
    ...solutionUris.map((uri, index) => ({
      id: `solution:${uri.fsPath}`,
      kind: "solution" as const,
      name: path.basename(uri.fsPath),
      path: uri.fsPath,
      projectPaths: solutionProjectPaths[index] ?? [],
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

async function resolveSolutionProjectPaths(
  solutionPath: string,
  discoveredProjectPaths: string[],
  logger: ExtensionLogger,
): Promise<string[]> {
  let contents: string;
  try {
    contents = await fs.readFile(solutionPath, "utf8");
  } catch (error) {
    logger.warning(
      "workspace",
      `Could not read solution file ${solutionPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }

  const isXml = path.extname(solutionPath).toLowerCase() === ".slnx";
  const rawEntries = extractProjectPaths(
    contents,
    isXml ? slnxProjectPathPattern : classicProjectLinePattern,
  );

  const solutionDir = path.dirname(solutionPath);
  const byNormalizedPath = new Map(
    discoveredProjectPaths.map((projectPath) => [
      normalizeProjectPath(projectPath),
      projectPath,
    ]),
  );

  const resolved: string[] = [];
  for (const rawPath of rawEntries) {
    const absolute = path.resolve(solutionDir, rawPath.replaceAll("\\", "/"));
    const match = byNormalizedPath.get(normalizeProjectPath(absolute));
    if (match) {
      resolved.push(match);
    }
  }
  return unique(resolved);
}

function extractProjectPaths(contents: string, pattern: RegExp): string[] {
  const paths: string[] = [];
  for (const match of contents.matchAll(pattern)) {
    const rawPath = match[1];
    if (
      rawPath &&
      knownProjectExtensions.has(path.extname(rawPath).toLowerCase())
    ) {
      paths.push(rawPath);
    }
  }
  return paths;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizeProjectPath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^\.?\//, "")
    .toLowerCase();
}
