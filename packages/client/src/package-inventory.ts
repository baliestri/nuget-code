import { NuGetCli } from "#client/cli";
import type { NuGetClientLogger } from "#client/types";
import type {
  DotnetListedPackage,
  DotnetPackageList,
  PackageInventory,
} from "#client/package-types";
import { mergeInstalled, prependVersion } from "#manager";
import type { NuGetPackageItem } from "#contracts/nuget";
import type { WorkspaceTarget } from "#contracts/workspace";

export async function loadPackageInventory(options: {
  target: WorkspaceTarget | undefined;
  cli: NuGetCli;
  logger: NuGetClientLogger;
  signal?: AbortSignal | undefined;
}): Promise<PackageInventory> {
  const [listed, outdated] = await Promise.all([
    loadListedPackageInventory(options),
    readOutdatedPackages(options.target, options.cli, options.logger),
  ]);

  return applyOutdatedPackageVersions(listed, outdated);
}

export async function loadListedPackageInventory(options: {
  target: WorkspaceTarget | undefined;
  cli: NuGetCli;
  logger: NuGetClientLogger;
  signal?: AbortSignal | undefined;
}): Promise<PackageInventory> {
  return readListedPackages(
    options.target,
    options.cli,
    options.logger,
    options.signal,
  );
}

export function applyOutdatedPackageVersions(
  inventory: PackageInventory,
  outdated: Map<string, string>,
): PackageInventory {
  const installedWithUpdates = inventory.installed.map((item) => {
    const update = outdated.get(item.name.toLowerCase());
    if (!update) {
      return item;
    }

    return {
      ...item,
      availableVersion: update,
      versions: prependVersion(item.versions, {
        version: update,
        source: item.sourceName ?? "NuGet",
      }),
    };
  });

  return {
    installed: installedWithUpdates,
    implicit: inventory.implicit,
  };
}

export async function loadOutdatedPackageVersions(options: {
  target: WorkspaceTarget | undefined;
  cli: NuGetCli;
  logger: NuGetClientLogger;
  signal?: AbortSignal | undefined;
}): Promise<Map<string, string>> {
  return readOutdatedPackages(
    options.target,
    options.cli,
    options.logger,
    options.signal,
  );
}

async function readListedPackages(
  target: WorkspaceTarget | undefined,
  cli: NuGetCli,
  logger: NuGetClientLogger,
  signal?: AbortSignal | undefined,
): Promise<PackageInventory> {
  if (!target) {
    return { installed: [], implicit: [] };
  }

  const baseArgs = [
    "list",
    target.path,
    "package",
    "--include-transitive",
    "--format",
    "json",
  ];

  let result = await runDotnetWithSignal(cli, baseArgs, signal);

  if (result.code !== 0) {
    if (isRestoreFailure(result.stdout)) {
      logger.warning(
        "nuget.cli",
        `dotnet list package failed due to restore for ${target.name}, retrying with --no-restore`,
      );
      result = await runDotnetWithSignal(
        cli,
        [...baseArgs, "--no-restore"],
        signal,
      );
    }
    if (result.code !== 0) {
      return { installed: [], implicit: [] };
    }
  }

  let listed: DotnetPackageList;
  try {
    listed = JSON.parse(result.stdout) as DotnetPackageList;
  } catch (error) {
    logger.warning(
      "nuget.packages",
      `Failed to parse dotnet package list JSON for ${target.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { installed: [], implicit: [] };
  }

  const installed: NuGetPackageItem[] = [];
  const implicit: NuGetPackageItem[] = [];

  for (const project of listed.projects ?? []) {
    for (const framework of project.frameworks ?? []) {
      installed.push(
        ...toPackageItems(
          project.path,
          framework.framework,
          framework.topLevelPackages,
          false,
        ),
      );

      implicit.push(
        ...toPackageItems(
          project.path,
          framework.framework,
          framework.transitivePackages,
          true,
        ),
      );
    }
  }

  return {
    installed: mergeInstalled(installed),
    implicit: mergeInstalled(implicit),
  };
}

function toPackageItems(
  projectPath: string,
  framework: string,
  packages: DotnetListedPackage[] | undefined,
  implicit: boolean,
): NuGetPackageItem[] {
  return (packages ?? []).map((item) => {
    const version = item.resolvedVersion ?? item.requestedVersion;
    const packageItem: NuGetPackageItem = {
      id: `${projectPath}:${implicit ? "implicit:" : ""}${framework}:${item.id}`,
      name: item.id,
      projectPaths: [projectPath],
      projectStates: [
        {
          projectPath,
          installedVersion: version,
          implicit,
        },
      ],
      versions: [],
      dependencyGroups: [],
      implicit,
    };

    if (version) {
      packageItem.installedVersion = version;
      packageItem.versions = [
        { version, source: implicit ? "Transitive" : "Installed" },
      ];
    }

    return packageItem;
  });
}

async function readOutdatedPackages(
  target: WorkspaceTarget | undefined,
  cli: NuGetCli,
  logger: NuGetClientLogger,
  signal?: AbortSignal | undefined,
): Promise<Map<string, string>> {
  const updates = new Map<string, string>();
  if (!target) {
    return updates;
  }

  const baseArgs = [
    "list",
    target.path,
    "package",
    "--outdated",
    "--include-transitive",
    "--format",
    "json",
  ];

  let result = await runDotnetWithSignal(cli, baseArgs, signal);

  if (result.code !== 0) {
    if (isRestoreFailure(result.stdout)) {
      logger.warning(
        "nuget.cli",
        `dotnet list package --outdated failed due to restore for ${target.name}, retrying with --no-restore`,
      );
      result = await runDotnetWithSignal(
        cli,
        [...baseArgs, "--no-restore"],
        signal,
      );
    }
    if (result.code !== 0) {
      return updates;
    }
  }

  let listed: DotnetPackageList;
  try {
    listed = JSON.parse(result.stdout) as DotnetPackageList;
  } catch (error) {
    logger.warning(
      "nuget.packages",
      `Failed to parse dotnet outdated package JSON for ${target.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return updates;
  }

  for (const project of listed.projects ?? []) {
    for (const framework of project.frameworks ?? []) {
      for (const item of [
        ...(framework.topLevelPackages ?? []),
        ...(framework.transitivePackages ?? []),
      ]) {
        if (item.latestVersion) {
          updates.set(item.id.toLowerCase(), item.latestVersion);
        }
      }
    }
  }
  return updates;
}

function runDotnetWithSignal(
  cli: NuGetCli,
  args: string[],
  signal: AbortSignal | undefined,
) {
  return signal
    ? cli.runDotnet(args, undefined, { signal })
    : cli.runDotnet(args);
}

function isRestoreFailure(stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as DotnetPackageList;
    return (parsed.problems ?? []).some(
      (p) => p.level === "error" && p.text.includes("Restore failed"),
    );
  } catch {
    return false;
  }
}
