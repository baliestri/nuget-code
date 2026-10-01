import fs from "node:fs/promises";
import path from "node:path";
import { parseXml, XmlElement } from "@rgrove/parse-xml";
import {
  ProjectContextError,
  type EvaluationOptions,
  type ProjectDirectorySnapshot,
  type ProjectInputKind,
  type ProjectInputSnapshot,
} from "#client/project-context";
import {
  containsPath,
  contentHash,
  decodeProjectText,
  directoryEntries,
  ignoredProjectDirectories,
  pathKey,
  readScopedFile,
} from "#client/project-files";

export interface CollectedProjectInputs {
  root: string;
  projectPath: string;
  projectPaths: string[];
  restoreConfigPath: string | null;
  inputs: ProjectInputSnapshot[];
  directories: ProjectDirectorySnapshot[];
  /** Ephemeral buffers, never part of persisted evaluation results. */
  documents: Map<string, Buffer>;
  reasons: string[];
}

function elements(element: XmlElement): XmlElement[] {
  return [
    element,
    ...element.children
      .filter((node): node is XmlElement => node instanceof XmlElement)
      .flatMap(elements),
  ];
}
function localName(element: XmlElement): string {
  return element.name.split(":").at(-1)!;
}

/** Static admission happens before any project MSBuild evaluation. */
export async function collectProjectInputs(
  options: EvaluationOptions,
  signal?: AbortSignal,
): Promise<CollectedProjectInputs> {
  signal?.throwIfAborted();
  const requested = path.resolve(options.projectPath);
  const candidates = options.allowedRoots
    .map((root) => path.resolve(root))
    .filter((root) => containsPath(root, requested))
    .sort((a, b) => a.length - b.length);
  const requestedRoot = candidates[0];
  if (!requestedRoot)
    throw new ProjectContextError(
      "outside-scope",
      "The project is not in an authorized root.",
    );
  const root = await fs.realpath(requestedRoot);
  const projectPath = path.join(root, path.relative(requestedRoot, requested));
  const result: CollectedProjectInputs = {
    root,
    projectPath,
    projectPaths: [],
    restoreConfigPath: null,
    inputs: [],
    directories: [],
    documents: new Map(),
    reasons: [],
  };
  const snapshots = new Map<string, ProjectInputSnapshot>();
  const reasons = new Set<string>();
  const inspected = new Set<string>();
  let packageCache: string | undefined;

  async function capture(
    file: string,
    kind: ProjectInputKind,
    copy: boolean,
    scopeRoot = root,
  ): Promise<Buffer | null> {
    signal?.throwIfAborted();
    if (!containsPath(scopeRoot, file)) {
      reasons.add("external-input");
      return null;
    }
    const key = pathKey(file);
    if (snapshots.has(key)) return result.documents.get(key) ?? null;
    try {
      const bytes = await readScopedFile(file, scopeRoot);
      snapshots.set(
        key,
        Object.freeze({
          path: file,
          scopeRoot,
          kind,
          copy,
          hash: bytes === null ? null : contentHash(bytes),
        }),
      );
      if (bytes !== null) result.documents.set(key, bytes);
      return bytes;
    } catch (error) {
      if (signal?.aborted) throw error;
      reasons.add(
        error instanceof ProjectContextError && error.code === "outside-scope"
          ? "linked-input"
          : "unreadable-input",
      );
      return null;
    }
  }

  if (options.restoreConfigPath) {
    const requestedConfig = path.resolve(options.restoreConfigPath);
    // An explicit restore configuration is a separate, read-only file capability.
    const configRoot = await fs.realpath(path.dirname(requestedConfig));
    const config = path.join(configRoot, path.basename(requestedConfig));
    const bytes = await capture(config, "configuration", true, configRoot);
    if (bytes) {
      result.restoreConfigPath = config;
      try {
        const configText = decodeProjectText(bytes).text;
        const configDocument = parseXml(configText, {
          preserveDocumentType: true,
        });
        const xml = configDocument.root;
        if (!xml || localName(xml) !== "configuration")
          throw new Error("Invalid NuGet configuration");
        if (
          configDocument.children.some((node) => node.type === "doctype") ||
          /%[a-z_][a-z0-9_]*%/i.test(configText)
        )
          reasons.add("unsupported-configuration");
        const cache = elements(xml).find(
          (element) => element.attributes.key === "globalPackagesFolder",
        )?.attributes.value;
        if (cache && !/[%$]/.test(cache)) {
          packageCache = path.resolve(configRoot, cache);
          if (containsPath(requestedRoot, packageCache))
            packageCache = path.join(
              root,
              path.relative(requestedRoot, packageCache),
            );
        }
      } catch {
        reasons.add("unsupported-configuration");
      }
    } else reasons.add("restore-config-missing");
  } else reasons.add("restore-config-required");

  async function discover(directory: string): Promise<void> {
    signal?.throwIfAborted();
    const entries = await fs.readdir(directory, { withFileTypes: true });
    result.directories.push(
      Object.freeze({
        path: directory,
        scopeRoot: root,
        entries: Object.freeze(await directoryEntries(directory)),
      }),
    );
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (
        ignoredProjectDirectories.has(entry.name) ||
        (packageCache && pathKey(file) === pathKey(packageCache))
      )
        continue;
      if (entry.isSymbolicLink()) {
        reasons.add("linked-input");
        continue;
      }
      if (entry.isDirectory()) await discover(file);
      else if (entry.isFile() && /\.(csproj|fsproj|vbproj)$/i.test(entry.name))
        result.projectPaths.push(file);
    }
  }
  await discover(root);
  result.projectPaths.sort();
  if (
    !result.projectPaths.some((file) => pathKey(file) === pathKey(projectPath))
  )
    reasons.add("project-not-discovered");

  async function inspect(
    file: string,
    project: string,
    kind: ProjectInputKind,
  ): Promise<void> {
    const key = `${pathKey(file)}:${pathKey(project)}`;
    if (inspected.has(key)) return;
    inspected.add(key);
    const bytes = await capture(file, kind, kind !== "generated");
    if (!bytes) {
      reasons.add("missing-input");
      return;
    }
    let document;
    try {
      document = parseXml(decodeProjectText(bytes).text, {
        preserveDocumentType: true,
      });
    } catch {
      reasons.add("invalid-input-xml");
      return;
    }
    const xml = document.root;
    if (
      !xml ||
      localName(xml) !== "Project" ||
      document.children.some((node) => node.type === "doctype")
    ) {
      reasons.add("unsupported-project-xml");
      return;
    }
    if (
      xml.attributes.Sdk &&
      !["Microsoft.NET.Sdk", "Microsoft.NET.Sdk.Web"].includes(
        xml.attributes.Sdk,
      )
    )
      reasons.add("custom-sdk");
    if (xml.attributes.TreatAsLocalProperty)
      reasons.add("custom-property-precedence");
    for (const element of elements(xml)) {
      const name = localName(element);
      const values = [element.text, ...Object.values(element.attributes)];
      if (values.some((value) => /\$\([^)]*\(/.test(value)))
        reasons.add("property-function");
      if (values.some((value) => /[@%]\(/.test(value)))
        reasons.add("item-expression");
      if (["Target", "UsingTask", "Sdk"].includes(name))
        reasons.add("custom-target");
      if (
        /^(?:CustomBefore|CustomAfter|MSBuildExtensions|MSBuildUserExtensions|MSBuildSDKsPath|ImportDirectory|DirectoryBuildPropsPath|DirectoryBuildTargetsPath|DirectoryPackagesPropsPath)/i.test(
          name,
        )
      )
        reasons.add("custom-import-hook");
      if (
        [
          "OutputPath",
          "BaseOutputPath",
          "IntermediateOutputPath",
          "BaseIntermediateOutputPath",
          "MSBuildProjectExtensionsPath",
          "ProjectAssetsFile",
          "RestoreOutputPath",
          "RestoreGraphOutputPath",
          "RestorePackagesPath",
          "NuGetLockFilePath",
          "RestoreConfigFile",
        ].includes(name) &&
        kind !== "generated"
      )
        reasons.add("custom-output-path");
      const condition = element.attributes.Condition;
      if (condition) {
        for (const match of condition.matchAll(
          /Exists\s*\(\s*['"]([^'"]+)['"]\s*\)/gi,
        )) {
          if (/[$@%*?]/.test(match[1]!)) {
            reasons.add("dynamic-condition-input");
            continue;
          }
          await capture(
            path.resolve(
              path.dirname(project),
              match[1]!.replaceAll("\\", "/"),
            ),
            "import",
            true,
          );
        }
      }
      const reference =
        name === "Import"
          ? element.attributes.Project
          : name === "ProjectReference"
            ? element.attributes.Include
            : undefined;
      if (reference === undefined) continue;
      if (kind === "generated") {
        reasons.add("package-build-import");
        continue;
      }
      if (path.isAbsolute(reference.replaceAll("\\", "/")))
        reasons.add("absolute-input");
      const expanded = reference.replaceAll(
        "$(MSBuildThisFileDirectory)",
        `${path.dirname(file)}${path.sep}`,
      );
      if (/[$@%*?]/.test(expanded)) {
        reasons.add("dynamic-input");
        continue;
      }
      const base =
        name === "Import" ? path.dirname(file) : path.dirname(project);
      const imported = path.resolve(base, expanded.replaceAll("\\", "/"));
      if (!containsPath(root, imported)) {
        reasons.add("external-input");
        continue;
      }
      await inspect(
        imported,
        name === "ProjectReference" ? imported : project,
        name === "Import" ? "import" : "project",
      );
    }
  }

  for (const project of result.projectPaths) {
    for (const name of [
      "Directory.Build.props",
      "Directory.Build.targets",
      "Directory.Packages.props",
      "global.json",
    ]) {
      let directory = path.dirname(project);
      let found = false;
      while (containsPath(root, directory)) {
        const file = path.join(directory, name);
        const bytes = await capture(
          file,
          name === "global.json" ? "global" : "import",
          true,
        );
        if (bytes) {
          if (name !== "global.json") await inspect(file, project, "import");
          found = true;
          break;
        }
        if (pathKey(directory) === pathKey(root)) break;
        directory = path.dirname(directory);
      }
      // No speculative access to parent directories outside the caller's authorization.
      if (!found) reasons.add(`ancestor-context-unverified:${name}`);
    }
    await inspect(project, project, "project");
    for (const suffix of [".nuget.g.props", ".nuget.g.targets"]) {
      const generated = path.join(
        path.dirname(project),
        "obj",
        `${path.basename(project)}${suffix}`,
      );
      if (await capture(generated, "generated", false))
        await inspect(generated, project, "generated");
    }
    await capture(
      path.join(path.dirname(project), "obj", "project.assets.json"),
      "assets",
      false,
    );
    await capture(
      path.join(path.dirname(project), "packages.lock.json"),
      "lock",
      true,
    );
  }
  result.inputs = [...snapshots.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  result.reasons = [...reasons].sort();
  return result;
}
