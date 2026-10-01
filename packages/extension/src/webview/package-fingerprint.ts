import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceTarget } from "#contracts";

export async function createPackageReferenceFingerprint(options: {
  target: WorkspaceTarget | undefined;
  centralPackageFiles: string[];
  inputPaths?: readonly string[];
}): Promise<string> {
  const paths = packageReferencePaths(options);
  const hash = createHash("sha256");

  for (const filePath of paths) {
    hash.update(normalizePath(filePath));
    hash.update("\0");
    try {
      hash.update(await fs.readFile(filePath));
    } catch {
      hash.update("<missing>");
    }
    hash.update("\0");
  }

  return hash.digest("hex");
}

function packageReferencePaths(options: {
  target: WorkspaceTarget | undefined;
  centralPackageFiles: string[];
  inputPaths?: readonly string[];
}): string[] {
  const projectPaths = options.target
    ? options.target.kind === "project"
      ? [options.target.path]
      : options.target.projectPaths
    : [];
  const projectFolders = projectPaths.map((projectPath) =>
    path.dirname(projectPath),
  );
  const centralPackageFiles = options.centralPackageFiles.filter(
    (centralFile) =>
      projectFolders.length === 0 ||
      projectFolders.some((folder) =>
        isSameOrParent(path.dirname(centralFile), folder),
      ),
  );

  return unique([
    ...projectPaths,
    ...centralPackageFiles,
    ...(options.inputPaths ?? []),
    ...(options.target?.kind === "solution" ? [options.target.path] : []),
  ]).sort((a, b) => normalizePath(a).localeCompare(normalizePath(b)));
}

function isSameOrParent(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function normalizePath(value: string): string {
  const normalized = path.resolve(value).replaceAll("\\", "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function unique(values: string[]): string[] {
  return [
    ...new Map(values.map((value) => [normalizePath(value), value])).values(),
  ];
}
