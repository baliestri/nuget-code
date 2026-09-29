import fs from "node:fs/promises";
import path from "node:path";
import type { NuGetCli, CommandResult } from "#client/cli";
import type { NuGetClientLogger } from "#client/types";
import type { WorkspaceTarget } from "#contracts";
import type { DotnetPackageList } from "#client/package-types";
import {
  dotnetArguments,
  resolveDotnetSdk,
  supportsListNoRestore,
} from "#client/dotnet-sdk";

export interface PackageInventoryOptions {
  target: WorkspaceTarget | undefined;
  cli: NuGetCli;
  logger: NuGetClientLogger;
  signal?: AbortSignal | undefined;
}

async function projectIdentity(value: string): Promise<string> {
  const absolute = path.resolve(value);
  const canonical = await fs.realpath(absolute).catch(() => absolute);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

export async function readTargetPackageList(
  options: PackageInventoryOptions,
  outdated: boolean,
): Promise<DotnetPackageList> {
  const projects: NonNullable<DotnetPackageList["projects"]> = [];
  const target = options.target;
  if (!target) return { version: 1, projects };
  const paths = [
    ...new Set(
      (target.kind === "project" ? [target.path] : target.projectPaths).map(
        (p) => path.resolve(p),
      ),
    ),
  ];
  for (const projectPath of paths) {
    options.signal?.throwIfAborted();
    const sdk = await resolveDotnetSdk(
      options.cli,
      projectPath,
      options.signal,
    );
    const action = { kind: "list" as const, projectPath, outdated };
    const actionLabel = `dotnet list package${outdated ? " --outdated" : ""}`;
    let result = await options.cli.runDotnet(
      dotnetArguments(sdk, action),
      sdk.cwd,
      { signal: options.signal },
    );
    if (result.code !== 0 && !result.failure && supportsListNoRestore(sdk)) {
      options.signal?.throwIfAborted();
      options.logger.warning(
        "nuget.cli",
        `${actionLabel} failed for ${projectPath} (exit ${result.code}), retrying with --no-restore`,
      );
      result = await options.cli.runDotnet(
        dotnetArguments(sdk, { ...action, noRestore: true }),
        sdk.cwd,
        { signal: options.signal },
      );
    }
    options.signal?.throwIfAborted();
    if (result.code !== 0) {
      const message = `${actionLabel} failed for ${projectPath}: ${describeFailure(result)}`;
      options.logger.error("nuget.packages", message);
      throw new Error(message);
    }
    let listed: DotnetPackageList;
    try {
      listed = JSON.parse(result.stdout) as DotnetPackageList;
      if (
        !listed ||
        !Array.isArray(listed.projects) ||
        (listed.version !== undefined && listed.version !== 1)
      ) {
        throw new Error("Expected a JSON v1 project list.");
      }
      if (listed.problems?.some((p) => p.level === "error")) {
        throw new Error(
          listed.problems
            .filter((p) => p.level === "error")
            .map((p) => p.text)
            .join("; "),
        );
      }
      for (const project of listed.projects) {
        if (
          typeof project.path !== "string" ||
          !Array.isArray(project.frameworks) ||
          (await projectIdentity(path.resolve(sdk.cwd, project.path))) !==
            (await projectIdentity(projectPath))
        ) {
          throw new Error(
            "The CLI returned invalid data or a different project.",
          );
        }
        for (const framework of project.frameworks) {
          if (typeof framework.framework !== "string")
            throw new Error("Missing target framework.");
          for (const items of [
            framework.topLevelPackages,
            framework.transitivePackages,
          ]) {
            if (
              items !== undefined &&
              (!Array.isArray(items) ||
                items.some(
                  (item) =>
                    !item ||
                    typeof item.id !== "string" ||
                    [
                      item.requestedVersion,
                      item.resolvedVersion,
                      item.latestVersion,
                    ].some((v) => v !== undefined && typeof v !== "string"),
                ))
            ) {
              throw new Error("Invalid package reference data.");
            }
          }
        }
      }
    } catch (error) {
      const message = `Failed to parse ${actionLabel} JSON for ${projectPath}: ${error instanceof Error ? error.message : String(error)}`;
      options.logger.error("nuget.packages", message);
      throw new Error(message, { cause: error });
    }
    projects.push(
      ...listed.projects!.map((project) => ({ ...project, path: projectPath })),
    );
  }
  return { version: 1, projects };
}

function describeFailure(result: CommandResult): string {
  try {
    const parsed = JSON.parse(result.stdout) as DotnetPackageList;
    const text = parsed.problems
      ?.filter((p) => p.level === "error" && p.text.trim())
      .map((p) => p.text.trim())
      .join("; ");
    if (text) return text;
  } catch {
    /* Fall back to stderr when stdout is not a diagnostic document. */
  }
  return result.stderr?.trim() || `dotnet exited with code ${result.code}`;
}
