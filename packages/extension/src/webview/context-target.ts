import path from "node:path";
import type { WorkspaceTarget } from "#contracts";

const targetExtensions = new Set([
  ".sln",
  ".slnx",
  ".csproj",
  ".fsproj",
  ".vbproj",
]);

export function contextItemPath(item: unknown): string | undefined {
  if (typeof item === "string") {
    return item;
  }

  if (!item || typeof item !== "object") {
    return undefined;
  }

  const record = item as Record<string, unknown>;
  return (
    contextItemPath(record.resourceUri) ??
    contextItemPath(record.uri) ??
    contextItemPath(record.fsPath) ??
    contextItemPath(record.path) ??
    contextItemPath(record.file)
  );
}

export function resolveTargetFromContextPath(
  itemPath: string | undefined,
  targets: WorkspaceTarget[],
): WorkspaceTarget | undefined {
  if (!itemPath) {
    return undefined;
  }

  const normalizedPath = normalizePath(itemPath);
  const exact = targets.find(
    (target) => normalizePath(target.path) === normalizedPath,
  );
  if (exact) {
    return exact;
  }

  const candidates = targets
    .filter((target) => target.kind === "project")
    .map((target) => ({
      target,
      directory: normalizePath(path.dirname(target.path)),
    }))
    .filter(({ directory }) => isSameOrChild(directory, normalizedPath))
    .sort((left, right) => right.directory.length - left.directory.length);

  return candidates[0]?.target;
}

export function isTargetPath(itemPath: string): boolean {
  return targetExtensions.has(path.extname(itemPath).toLowerCase());
}

function normalizePath(value: string): string {
  return path.normalize(value).replaceAll("\\", "/").toLowerCase();
}

function isSameOrChild(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}
