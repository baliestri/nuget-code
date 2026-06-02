import path from "node:path";
import { ProgressLocation, window } from "vscode";
import type { NuGetCli } from "#client";
import type {
  NuGetPackageItem,
  PackageFeed,
  PackageManagerCommand,
  PackageManagerOperationKind,
  PackageManagerState,
} from "#contracts";
import {
  PackageManagementCore,
  packageChangeAction,
  projectName,
} from "#manager";
import type { WorkspaceDiscovery } from "#extension/discovery";

interface PackageCommandServiceOptions {
  getState: () => PackageManagerState;
  getDiscovery: () => WorkspaceDiscovery;
  getCli: () => NuGetCli;
  runOperation: (
    kind: PackageManagerOperationKind,
    label: string,
    action: () => Promise<void>,
  ) => Promise<void>;
  refreshPackages: (options?: {
    forceInventory?: boolean | undefined;
  }) => Promise<void>;
}

export class PackageCommandService {
  constructor(private readonly options: PackageCommandServiceOptions) {}

  async restorePackages(): Promise<void> {
    const target = PackageManagementCore.selection.getSelectedTarget(
      this.options.getState(),
    );
    if (!target) {
      window.showWarningMessage("No .NET solution or project was found.");
      return;
    }

    await this.options.runOperation(
      "restore",
      `Restoring ${target.name}`,
      async () => {
        const result = await this.options
          .getCli()
          .runDotnet(["restore", target.path], path.dirname(target.path));

        if (result.code === 0) {
          window.showInformationMessage(
            `Restored packages for ${target.name}.`,
          );
        } else {
          window.showErrorMessage(
            `Failed to restore packages for ${target.name}.`,
          );
        }
      },
    );
  }

  async upgradePackages(): Promise<void> {
    const packages = this.options
      .getState()
      .installedPackages.filter((item) => item.availableVersion);

    if (packages.length === 0) {
      window.showInformationMessage("No package upgrades are available.");
      return;
    }

    await this.options.runOperation(
      "upgrade",
      "Upgrading NuGet packages",
      async () => {
        await window.withProgress(
          {
            location: ProgressLocation.Notification,
            title: "Updating NuGet packages",
            cancellable: false,
          },
          async (progress) => {
            for (const packageItem of packages) {
              await this.applyPackageToProjects(
                packageItem,
                packageItem.availableVersion,
                undefined,
                undefined,
                "Updating",
                progress,
              );
            }
          },
        );

        await this.options.refreshPackages();
      },
    );
  }

  async addOrUpgradeSelectedPackage(
    command: "addPackage" | "upgradeSelectedPackage",
    options: {
      version?: string | undefined;
      feedId?: string | undefined;
      projectPaths?: string[] | undefined;
    },
  ): Promise<void> {
    const state = this.options.getState();
    const packageItem =
      PackageManagementCore.selection.getSelectedPackage(state);
    if (!packageItem) {
      return;
    }

    const version =
      options.version ||
      (packageItem.availableVersion ??
        packageItem.versions[0]?.version ??
        packageItem.installedVersion);
    const feed = options.feedId
      ? state.feeds.find((item) => item.id === options.feedId)
      : undefined;

    if (!version) {
      window.showWarningMessage(
        `No version is available for ${packageItem.name}.`,
      );
      return;
    }

    const projects =
      options.projectPaths ??
      (await this.pickProjects(packageItem.projectPaths));
    if (!projects || projects.length === 0) {
      return;
    }

    const action = packageChangeAction(command, packageItem, version, projects);
    await this.options.runOperation(
      action === "Installing" ? "addPackage" : "upgrade",
      `${action} ${packageItem.name}`,
      async () => {
        await this.applyPackageToProjectsWithProgress(
          packageItem,
          version,
          feed,
          projects,
          action,
        );
      },
    );
    await this.options.refreshPackages({ forceInventory: true });
  }

  async removeSelectedPackage(
    projectPaths?: string[] | undefined,
  ): Promise<void> {
    const packageItem = PackageManagementCore.selection.getSelectedPackage(
      this.options.getState(),
    );
    if (!packageItem) {
      return;
    }

    const projects =
      projectPaths ?? (await this.pickProjects(packageItem.projectPaths));
    if (!projects || projects.length === 0) {
      return;
    }

    await this.options.runOperation(
      "removePackage",
      `Removing ${packageItem.name}`,
      async () => {
        await this.removePackageFromProjectsWithProgress(packageItem, projects);

        await this.options.refreshPackages({ forceInventory: true });
      },
    );
  }

  handles(command: PackageManagerCommand): boolean {
    return [
      "restore",
      "upgradePackages",
      "addPackage",
      "upgradeSelectedPackage",
      "removePackage",
    ].includes(command);
  }

  private async applyPackageToProjects(
    packageItem: NuGetPackageItem,
    version: string | undefined,
    feed: PackageFeed | undefined = undefined,
    projectPaths?: string[] | undefined,
    action = "Updating",
    progress?: { report(value: { message?: string }): void } | undefined,
  ): Promise<void> {
    if (!version) {
      return;
    }

    const projects =
      projectPaths ?? (await this.pickProjects(packageItem.projectPaths));
    if (!projects || projects.length === 0) {
      return;
    }

    for (const projectPath of projects) {
      progress?.report({
        message: `${packageItem.name} in ${projectName(projectPath)}`,
      });
      await this.applyPackageToProject(
        packageItem,
        version,
        projectPath,
        feed,
        action,
      );
    }
  }

  private async applyPackageToProjectsWithProgress(
    packageItem: NuGetPackageItem,
    version: string,
    feed: PackageFeed | undefined,
    projectPaths: string[],
    action: "Installing" | "Updating" | "Downgrading" | "Changing",
  ): Promise<void> {
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: `${action} ${packageItem.name}`,
        cancellable: false,
      },
      async (progress) => {
        for (const projectPath of projectPaths) {
          progress.report({
            message: `in ${projectName(projectPath)}`,
          });
          await this.applyPackageToProject(
            packageItem,
            version,
            projectPath,
            feed,
            action,
          );
        }
      },
    );
  }

  private async applyPackageToProject(
    packageItem: NuGetPackageItem,
    version: string,
    projectPath: string,
    feed: PackageFeed | undefined,
    action: string,
  ): Promise<void> {
    const args = [
      "package",
      "add",
      packageItem.name,
      "--project",
      projectPath,
      "--version",
      version,
    ];
    if (
      feed &&
      feed.id !== PackageManagementCore.feeds.allFeeds.id &&
      feed.url
    ) {
      args.push("--source", feed.url);
    }

    const result = await this.options.getCli().runDotnet(args);
    if (result.code !== 0) {
      throw new Error(
        `${action} ${packageItem.name} failed for ${projectName(projectPath)}: ${commandError(result.stderr)}`,
      );
    }
  }

  private async removePackageFromProjectsWithProgress(
    packageItem: NuGetPackageItem,
    projectPaths: string[],
  ): Promise<void> {
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: `Removing ${packageItem.name}`,
        cancellable: false,
      },
      async (progress) => {
        for (const projectPath of projectPaths) {
          progress.report({
            message: `from ${projectName(projectPath)}`,
          });
          await this.removePackageFromProject(packageItem, projectPath);
        }
      },
    );
  }

  private async removePackageFromProject(
    packageItem: NuGetPackageItem,
    projectPath: string,
  ): Promise<void> {
    const result = await this.options
      .getCli()
      .runDotnet([
        "package",
        "remove",
        packageItem.name,
        "--project",
        projectPath,
      ]);

    if (result.code !== 0) {
      throw new Error(
        `Removing ${packageItem.name} failed for ${projectName(projectPath)}: ${commandError(result.stderr)}`,
      );
    }
  }

  private async pickProjects(
    defaultProjectPaths: string[],
  ): Promise<string[] | undefined> {
    const selectedDefaults = new Set(defaultProjectPaths);
    const items = this.options
      .getDiscovery()
      .projectPaths.map((projectPath) => ({
        label: path.basename(projectPath, path.extname(projectPath)),
        description: projectPath,
        picked: selectedDefaults.has(projectPath),
        projectPath,
      }));

    const selected = await window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: "Select project(s)",
      ignoreFocusOut: true,
    });

    return selected?.map((item) => item.projectPath);
  }
}

function commandError(stderr: string): string {
  return stderr.trim() || "dotnet exited with a non-zero code";
}
