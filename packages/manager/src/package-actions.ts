import type { NuGetPackageItem } from "#contracts";
import {
  packageProjectState,
  projectStates,
  sameProjectPath,
} from "#manager/projects";
import type { ProjectVersionAction } from "#manager/types";
import { comparePackageVersions, samePackageVersion } from "#manager/versions";

export function projectVersionAction(
  installedVersion: string | undefined,
  selectedVersion: string,
): ProjectVersionAction {
  if (!installedVersion) {
    return "add";
  }
  if (
    !selectedVersion ||
    samePackageVersion(installedVersion, selectedVersion)
  ) {
    return "remove";
  }
  return comparePackageVersions(installedVersion, selectedVersion) < 0
    ? "update"
    : "downgrade";
}

export function packageChangeAction(
  command: "addPackage" | "upgradeSelectedPackage",
  packageItem: NuGetPackageItem,
  version: string,
  projectPaths: string[],
): "Installing" | "Updating" | "Downgrading" | "Changing" {
  if (command === "addPackage") {
    return "Installing";
  }

  const actions = new Set(
    projectPaths.map((projectPath) => {
      const installedVersion = packageProjectState(
        packageItem,
        projectPath,
      )?.installedVersion;
      if (!installedVersion) {
        return "Installing";
      }
      return comparePackageVersions(installedVersion, version) < 0
        ? "Updating"
        : "Downgrading";
    }),
  );

  const [action] = Array.from(actions);
  return actions.size === 1 && action ? action : "Changing";
}

export function globalProjectActions(
  packageItem: NuGetPackageItem,
  version: string,
  projectPaths: string[],
): Record<ProjectVersionAction, string[]> {
  const actions: Record<ProjectVersionAction, string[]> = {
    add: [],
    update: [],
    downgrade: [],
    remove: [],
  };
  if (!version) {
    for (const projectPath of projectPaths) {
      if (packageProjectState(packageItem, projectPath)?.installedVersion) {
        actions.remove.push(projectPath);
      }
    }
    return actions;
  }

  for (const projectPath of projectPaths) {
    const installedVersion = packageProjectState(
      packageItem,
      projectPath,
    )?.installedVersion;
    if (installedVersion) {
      actions.remove.push(projectPath);
    }
    const action = projectVersionAction(installedVersion, version);
    if (action !== "remove") {
      actions[action].push(projectPath);
    }
  }
  return actions;
}

export function updatePackageProjectState(
  packageItem: NuGetPackageItem,
  packageName: string,
  projectPaths: string[],
  version: string | undefined,
): NuGetPackageItem {
  if (packageItem.name.toLowerCase() !== packageName.toLowerCase()) {
    return packageItem;
  }

  const states = projectStates(packageItem);
  const unchangedStates = states.filter(
    (state) =>
      state.implicit ||
      !projectPaths.some((projectPath) =>
        sameProjectPath(projectPath, state.projectPath),
      ),
  );
  const nextStates =
    version === undefined
      ? unchangedStates
      : [
          ...unchangedStates,
          ...projectPaths.map((projectPath) => ({
            projectPath,
            installedVersion: version,
            implicit: false,
          })),
        ];
  const explicitStates = nextStates.filter((state) => !state.implicit);
  const nextProjectPaths = explicitStates.map((state) => state.projectPath);
  const nextInstalledVersion = explicitStates[0]?.installedVersion;

  return {
    ...packageItem,
    projectPaths: nextProjectPaths,
    projectStates: nextStates.length > 0 ? nextStates : undefined,
    installedVersion: nextInstalledVersion,
    versions:
      version && !packageItem.versions.some((item) => item.version === version)
        ? [{ version, source: "Installed" }, ...packageItem.versions]
        : packageItem.versions,
  };
}

export function updatePackageProjectStates(
  packages: NuGetPackageItem[],
  packageName: string,
  projectPaths: string[],
  version: string | undefined,
): NuGetPackageItem[] {
  return packages.map((packageItem) =>
    updatePackageProjectState(packageItem, packageName, projectPaths, version),
  );
}
