import fs from "node:fs/promises";
import path from "node:path";
import type { NuGetCli } from "#client/cli";
import {
  ProjectContextError,
  type EvaluatedProjectNode,
  type MsbuildFrame,
  type ProjectInputSnapshot,
} from "#client/project-context";
import { resolveDotnetSdk } from "#client/dotnet-sdk";
import {
  containsPath,
  contentHash,
  pathKey,
  readScopedFile,
} from "#client/project-files";

export const evaluationProperties = [
  "TargetFramework",
  "TargetFrameworks",
  "TargetFrameworkMoniker",
  "Configuration",
  "Platform",
  "ManagePackageVersionsCentrally",
  "CentralPackageTransitivePinningEnabled",
  "MSBuildProjectDirectory",
  "MSBuildToolsPath",
  "MSBuildSDKsPath",
  "MSBuildProjectExtensionsPath",
  "BaseIntermediateOutputPath",
  "ProjectAssetsFile",
  "OutputPath",
  "BaseOutputPath",
  "IntermediateOutputPath",
  "RestoreOutputPath",
  "RestorePackagesPath",
  "RestoreLockedMode",
  "RestorePackagesWithLockFile",
  "NuGetLockFilePath",
  "RuntimeIdentifier",
  "RuntimeIdentifiers",
  "AssetTargetFallback",
  "PackageTargetFallback",
  "RestoreSources",
  "RestoreFallbackFolders",
  "NoWarn",
  "TreatWarningsAsErrors",
  "WarningsAsErrors",
  "UserProfile",
  "NuGetPackageRoot",
  "NuGetPackageFolders",
];
const derivedMetadata = new Set([
  "FullPath",
  "RootDir",
  "Filename",
  "Extension",
  "RelativeDir",
  "Directory",
  "RecursiveDir",
  "ModifiedTime",
  "CreatedTime",
  "AccessedTime",
  "DefiningProjectDirectory",
  "DefiningProjectName",
  "DefiningProjectExtension",
]);

export async function runProjectQuery(
  cli: Pick<NuGetCli, "runDotnet">,
  project: string,
  framework: string | undefined,
  signal?: AbortSignal,
): Promise<{
  properties: Record<string, string>;
  items: Record<string, Record<string, string>[]>;
}> {
  signal?.throwIfAborted();
  const result = await cli.runDotnet(
    [
      "msbuild",
      project,
      "-nologo",
      `-getProperty:${evaluationProperties.join(",")}`,
      "-getItem:PackageReference,PackageVersion,ProjectReference,FrameworkReference",
      ...(framework ? [`-p:TargetFramework=${framework}`] : []),
    ],
    path.dirname(project),
    { signal },
  );
  if (result.code !== 0)
    throw new ProjectContextError(
      "evaluation-failed",
      "MSBuild could not evaluate the project context.",
    );
  try {
    const raw = JSON.parse(result.stdout) as {
      Properties: Record<string, unknown>;
      Items: Record<string, unknown>;
    };
    if (
      !raw?.Properties ||
      !raw.Items ||
      Object.values(raw.Properties).some(
        (value) => typeof value !== "string",
      ) ||
      Object.values(raw.Items).some(
        (value) =>
          !Array.isArray(value) ||
          value.some(
            (item) =>
              !item ||
              typeof item !== "object" ||
              Object.values(item).some((part) => typeof part !== "string"),
          ),
      )
    )
      throw new Error("Unexpected evaluation shape.");
    return {
      properties: raw.Properties as Record<string, string>,
      items: raw.Items as Record<string, Record<string, string>[]>,
    };
  } catch (cause) {
    throw new ProjectContextError(
      "evaluation-failed",
      "MSBuild returned invalid evaluation metadata.",
      { cause },
    );
  }
}

export async function inspectProject(
  cli: Pick<NuGetCli, "runDotnet">,
  project: string,
  inputs: readonly ProjectInputSnapshot[],
  scratch: string,
  signal?: AbortSignal,
): Promise<{ node: EvaluatedProjectNode; tools: ProjectInputSnapshot[] }> {
  const sdk = await resolveDotnetSdk(cli, project, signal);
  const outer = await runProjectQuery(cli, project, undefined, signal);
  const frameworks = (
    outer.properties.TargetFrameworks ||
    outer.properties.TargetFramework ||
    ""
  )
    .split(";")
    .filter(Boolean);
  if (!frameworks.length)
    throw new ProjectContextError(
      "unsupported-context",
      "The project has no concrete target frameworks.",
    );
  const frames: MsbuildFrame[] = [];
  const imports = new Set<string>();
  for (const framework of frameworks) {
    const data =
      frameworks.length === 1 && outer.properties.TargetFramework === framework
        ? outer
        : await runProjectQuery(cli, project, framework, signal);
    frames.push({ framework, ...data });
    const output = path.join(scratch, `project-${frames.length}.xml`);
    const result = await cli.runDotnet(
      [
        "msbuild",
        project,
        "-nologo",
        `-p:TargetFramework=${framework}`,
        `-preprocess:${output}`,
      ],
      sdk.cwd,
      { signal },
    );
    if (result.code !== 0)
      throw new ProjectContextError(
        "evaluation-failed",
        "MSBuild could not report the import graph.",
      );
    for (const line of (await fs.readFile(output, "utf8")).split(/\r?\n/)) {
      const file = line.trim();
      if (
        path.isAbsolute(file) &&
        /\.(?:csproj|fsproj|vbproj|props|targets)$/i.test(file)
      )
        imports.add(path.normalize(file));
    }
  }
  const sdkRoot = outer.properties.MSBuildToolsPath;
  if (!sdkRoot || !path.isAbsolute(sdkRoot))
    throw new ProjectContextError(
      "evaluation-failed",
      "MSBuild did not identify its toolchain.",
    );
  const installation = path.dirname(path.dirname(sdkRoot));
  const toolRoots = [
    sdkRoot,
    path.join(installation, "sdk-manifests"),
    path.join(installation, "packs"),
  ];
  const known = new Set(
    inputs
      .filter((input) => input.hash !== null)
      .map((input) => pathKey(input.path)),
  );
  const tools: ProjectInputSnapshot[] = [];
  for (const file of [...imports].sort()) {
    signal?.throwIfAborted();
    if (known.has(pathKey(file))) continue;
    const scopeRoot = toolRoots.find((root) => containsPath(root, file));
    if (!scopeRoot)
      throw new ProjectContextError(
        "unsupported-context",
        "MSBuild used an import outside the captured inputs.",
      );
    const bytes = await readScopedFile(file, scopeRoot);
    if (!bytes)
      throw new ProjectContextError(
        "stale-input",
        "A toolchain input disappeared during evaluation.",
      );
    tools.push({
      path: file,
      scopeRoot,
      kind: "tool",
      copy: false,
      hash: contentHash(bytes),
    });
  }
  return {
    node: { path: project, sdk, frames, imports: [...imports].sort() },
    tools,
  };
}

/** A projection for relocation comparisons, excluding volatile/generated-cache hints. */
export function semanticProject(
  node: EvaluatedProjectNode,
  root: string,
): unknown {
  const normalized = (value: string) =>
    value.replaceAll("\\", "/").split(root.replaceAll("\\", "/")).join("$ROOT");
  const generated = new Set([
    "NuGetPackageRoot",
    "NuGetPackageFolders",
    "MSBuildProjectExtensionsPath",
    "ProjectAssetsFile",
  ]);
  return {
    path: normalized(node.path),
    sdk: node.sdk.version,
    frames: node.frames.map((frame) => ({
      framework: frame.framework,
      properties: Object.fromEntries(
        Object.entries(frame.properties)
          .filter(([key]) => !generated.has(key))
          .map(([key, value]) => [key, normalized(value)]),
      ),
      items: Object.fromEntries(
        Object.entries(frame.items).map(([key, items]) => [
          key,
          items
            .map((item) =>
              Object.fromEntries(
                Object.entries(item)
                  .filter(([name]) => !derivedMetadata.has(name))
                  .map(([name, value]) => [name, normalized(value)]),
              ),
            )
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        ]),
      ),
    })),
  };
}
