import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { InstalledReference } from "#contracts";
import type { NuGetCli } from "#client/cli";
import { resolveDotnetSdk } from "#client/dotnet-sdk";
import { collectProjectInputs } from "#client/project-inputs";
import { inspectProject, semanticProject } from "#client/project-msbuild";
import {
  contentHash,
  decodeProjectText,
  pathKey,
  verifyProjectInputs,
} from "#client/project-files";
import { planVersionDeclaration } from "#client/version-declaration";
import { parseNuGetVersion } from "#manager";
import type {
  EvaluatedProject,
  EvaluationOptions,
  EvaluatedProjectNode,
} from "#client/project-context";
export type {
  EvaluatedProject,
  EvaluationOptions,
} from "#client/project-context";

function installedVersions(
  bytes: Buffer | undefined,
  framework: string,
  moniker: string,
): Map<string, string | null> {
  const versions = new Map<string, string | null>();
  if (!bytes) return versions;
  try {
    const assets = JSON.parse(bytes.toString("utf8")) as {
      targets?: Record<string, Record<string, { type?: string }>>;
    };
    for (const [target, packages] of Object.entries(assets.targets ?? {})) {
      if (![framework, moniker].includes(target.split("/")[0]!)) continue;
      for (const [identity, info] of Object.entries(packages)) {
        if (info.type !== "package") continue;
        const slash = identity.lastIndexOf("/");
        const name = identity.slice(0, slash).toLowerCase();
        const version = identity.slice(slash + 1);
        if (slash < 1 || !parseNuGetVersion(version)) continue;
        versions.set(
          name,
          versions.has(name) && versions.get(name) !== version ? null : version,
        );
      }
    }
  } catch {
    /* Missing or stale restore facts must not become requested-version guesses. */
  }
  return versions;
}

export async function evaluateProject(
  cli: Pick<NuGetCli, "runDotnet">,
  options: EvaluationOptions,
  signal?: AbortSignal,
): Promise<EvaluatedProject> {
  const collected = await collectProjectInputs(options, signal);
  const sdk = await resolveDotnetSdk(cli, collected.projectPath, signal);
  const projects: EvaluatedProjectNode[] = [];
  const references: InstalledReference[] = [];
  const reasons = [...collected.reasons];
  const inputs = new Map(
    collected.inputs.map((input) => [pathKey(input.path), input]),
  );
  let scratch: string | undefined;
  try {
    if (!reasons.length) {
      scratch = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-evaluation-"));
      for (const project of collected.projectPaths) {
        signal?.throwIfAborted();
        const inspected = await inspectProject(
          cli,
          project,
          [...inputs.values()],
          scratch,
          signal,
        );
        projects.push(inspected.node);
        for (const input of inspected.tools)
          inputs.set(pathKey(input.path), input);
        for (const frame of inspected.node.frames) {
          const assets = collected.documents.get(
            pathKey(
              path.join(path.dirname(project), "obj", "project.assets.json"),
            ),
          );
          const installed = installedVersions(
            assets,
            frame.framework,
            frame.properties.TargetFrameworkMoniker ?? "",
          );
          const directIds = new Set<string>();
          for (const item of frame.items.PackageReference ?? []) {
            const packageId = item.Identity;
            if (!packageId) continue;
            const central =
              frame.properties.ManagePackageVersionsCentrally?.toLowerCase() ===
              "true";
            const version = central
              ? frame.items.PackageVersion?.find(
                  (value) =>
                    value.Identity?.toLowerCase() === packageId.toLowerCase(),
                )
              : item;
            const declaration = version?.DefiningProjectFullPath;
            const source = declaration
              ? inputs.get(pathKey(declaration))
              : undefined;
            const direct =
              item.IsImplicitlyDefined?.toLowerCase() !== "true" &&
              source?.kind !== "tool";
            let declarationPath: string | null = null;
            const expectedVersion =
              item.VersionOverride || version?.Version || item.Version || null;
            if (
              direct &&
              !item.VersionOverride &&
              source &&
              ["project", "import"].includes(source.kind) &&
              expectedVersion
            ) {
              const bytes = collected.documents.get(pathKey(source.path));
              if (bytes) {
                try {
                  planVersionDeclaration(decodeProjectText(bytes).text, {
                    declarationPath: source.path,
                    kind: central ? "PackageVersion" : "PackageReference",
                    packageId,
                    expectedVersion,
                    version: expectedVersion,
                    affectedProjectPaths: [project],
                  });
                  declarationPath = source.path;
                } catch {
                  /* Context can be relocatable while this specific version remains uneditable. */
                }
              }
            }
            directIds.add(packageId.toLowerCase());
            references.push({
              referenceId: JSON.stringify([
                project,
                frame.framework,
                packageId.toLowerCase(),
                direct,
              ]),
              packageId,
              projectPath: project,
              framework: frame.framework,
              requestedVersion: expectedVersion,
              resolvedVersion: installed.get(packageId.toLowerCase()) ?? null,
              direct,
              declarationPath,
              affectedProjectPaths: [],
            });
          }
          for (const [packageId, version] of installed)
            if (!directIds.has(packageId))
              references.push({
                referenceId: JSON.stringify([
                  project,
                  frame.framework,
                  packageId,
                  false,
                ]),
                packageId,
                projectPath: project,
                framework: frame.framework,
                requestedVersion: null,
                resolvedVersion: version,
                direct: false,
                declarationPath: null,
                affectedProjectPaths: [],
              });
        }
      }
      await verifyProjectInputs(
        [...inputs.values()],
        collected.directories,
        signal,
      );
    }
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw error;
    reasons.push(
      error instanceof Error && "code" in error
        ? String(error.code)
        : "evaluation-failed",
    );
  } finally {
    if (scratch)
      await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5 });
  }
  const complete = reasons.length === 0;
  const scoped = references.map((reference) => ({
    ...reference,
    affectedProjectPaths:
      complete && reference.declarationPath
        ? [
            ...new Set(
              references
                .filter(
                  (other) =>
                    other.declarationPath !== null &&
                    pathKey(other.declarationPath) ===
                      pathKey(reference.declarationPath!) &&
                    other.packageId.toLowerCase() ===
                      reference.packageId.toLowerCase(),
                )
                .map((other) => other.projectPath),
            ),
          ].sort()
        : [],
  }));
  const snapshots = [...inputs.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const feeds = [...new Set(options.feedUrls)].sort();
  const contextRevision = contentHash(
    JSON.stringify([
      snapshots,
      collected.directories,
      sdk.version,
      options.sourceRevision,
      feeds,
      projects.map((project) => semanticProject(project, collected.root)),
      reasons,
    ]),
  );
  return Object.freeze({
    projectPath: collected.projectPath,
    root: collected.root,
    sdk,
    frameworks: Object.freeze(
      projects
        .find(
          (project) => pathKey(project.path) === pathKey(collected.projectPath),
        )
        ?.frames.map((frame) => frame.framework) ?? [],
    ),
    inputPaths: Object.freeze(snapshots.map((input) => input.path)),
    inputs: Object.freeze(snapshots),
    directories: Object.freeze(collected.directories),
    references: Object.freeze(scoped),
    projects: Object.freeze(projects),
    contextRevision,
    sourceRevision: options.sourceRevision,
    feedUrls: Object.freeze(feeds),
    restoreConfigPath: collected.restoreConfigPath,
    isolation: Object.freeze({
      supported: complete,
      reasons: Object.freeze([...new Set(reasons)].sort()),
    }),
  });
}
