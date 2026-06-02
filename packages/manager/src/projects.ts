import type { NuGetPackageItem, WorkspaceTarget } from "#contracts";

export function targetIcon(target: WorkspaceTarget): string | undefined {
  const extension = target.path.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "sln":
    case "csproj":
    case "fsproj":
    case "vbproj":
      return extension;
    case "slnx":
      return "sln";
    default:
      return undefined;
  }
}

export function projectName(projectPath: string): string {
  const fileName = projectPath.split(/[\\/]/).pop() ?? projectPath;
  return fileName.replace(/\.(slnx|sln|csproj|fsproj|vbproj)$/i, "");
}

export function defaultSelectedProjectPaths(
  packageItem: NuGetPackageItem,
  target: WorkspaceTarget | undefined,
): string[] {
  return (target?.projectPaths ?? []).filter(
    (projectPath) =>
      packageProjectState(packageItem, projectPath)?.installedVersion,
  );
}

export function projectSelectionKey(
  packageItem: NuGetPackageItem,
  target: WorkspaceTarget | undefined,
): string {
  return `${packageItem.name.toLowerCase()}:${target?.id ?? ""}`;
}

export function filterPackagesForTarget(
  packages: NuGetPackageItem[],
  target: WorkspaceTarget | undefined,
): NuGetPackageItem[] {
  const targetProjectPaths = new Set(target?.projectPaths ?? []);
  if (targetProjectPaths.size === 0) {
    return packages;
  }

  return packages.filter((packageItem) =>
    projectStates(packageItem).some((state) =>
      Array.from(targetProjectPaths).some((projectPath) =>
        sameProjectPath(projectPath, state.projectPath),
      ),
    ),
  );
}

export function projectStates(
  packageItem: NuGetPackageItem,
): NonNullable<NuGetPackageItem["projectStates"]> {
  return (
    packageItem.projectStates ??
    packageItem.projectPaths.map((projectPath) => ({
      projectPath,
      installedVersion: packageItem.installedVersion,
      implicit: packageItem.implicit,
    }))
  );
}

export function packageProjectState(
  packageItem: NuGetPackageItem,
  projectPath: string,
) {
  return projectStates(packageItem).find(
    (state) =>
      sameProjectPath(state.projectPath, projectPath) && !state.implicit,
  );
}

export function sameProjectPath(a: string, b: string): boolean {
  const left = normalizeProjectPath(a);
  const right = normalizeProjectPath(b);
  return (
    left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
  );
}

export function normalizeProjectPath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^\.?\//, "")
    .toLowerCase();
}
