import type { CommandResult, NuGetCli } from "#client/cli";
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

  const listed = await runListCommand(
    cli,
    baseArgs,
    target,
    logger,
    signal,
    "dotnet list package",
  );

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

  const listed = await runListCommand(
    cli,
    baseArgs,
    target,
    logger,
    signal,
    "dotnet list package --outdated",
  );

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

async function runListCommand(
  cli: NuGetCli,
  baseArgs: string[],
  target: WorkspaceTarget,
  logger: NuGetClientLogger,
  signal: AbortSignal | undefined,
  actionLabel: string,
): Promise<DotnetPackageList> {
  let result = await runDotnetWithSignal(cli, baseArgs, signal);

  if (result.code !== 0) {
    logger.warning(
      "nuget.cli",
      `${actionLabel} failed for ${target.name} (exit ${result.code}), retrying with --no-restore`,
    );
    result = await runDotnetWithSignal(
      cli,
      [...baseArgs, "--no-restore"],
      signal,
    );
  }

  if (result.code !== 0) {
    const message = `${actionLabel} failed for ${target.name}: ${describeFailure(result)}`;
    logger.error("nuget.packages", message);
    throw new Error(message);
  }

  try {
    return JSON.parse(result.stdout) as DotnetPackageList;
  } catch (error) {
    const message = `Failed to parse ${actionLabel} JSON for ${target.name}: ${error instanceof Error ? error.message : String(error)}`;
    logger.error("nuget.packages", message);
    throw new Error(message, { cause: error });
  }
}

function describeFailure(result: CommandResult): string {
  try {
    const parsed = JSON.parse(result.stdout) as DotnetPackageList;
    const problemText = (parsed.problems ?? [])
      .filter((p) => p.level === "error" && p.text.trim().length > 0)
      .map((p) => p.text.trim())
      .join("; ");
    if (problemText) {
      return problemText;
    }
  } catch {
    // stdout wasn't JSON — fall through to stderr/generic below
  }

  const stderr = result.stderr.trim();
  if (stderr) {
    return stderr;
  }

  return `dotnet exited with code ${result.code}`;
}
