import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseXml, XmlElement } from "@rgrove/parse-xml";
import type { NuGetCli } from "#client/cli";
import {
  ProjectContextError,
  type EvaluatedProject,
} from "#client/project-context";
import {
  containsPath,
  contentHash,
  decodeProjectText,
  encodeProjectText,
  pathKey,
  readScopedFile,
  verifyProjectInputs,
} from "#client/project-files";
import {
  VersionEditError,
  type VersionEditIO,
  type VersionDocumentSnapshot,
} from "#client/package-version-edits";
import { evaluateProject } from "#client/project-evaluation";
import { semanticProject } from "#client/project-msbuild";

export interface CompatibilitySandbox {
  readonly root: string;
  readonly workspacePath: string;
  readonly projectPath: string;
  readonly restoreConfigPath: string;
  readonly packagesPath: string;
  readonly sourceToCopy: ReadonlyMap<string, string>;
  dispose(): Promise<void>;
}

/** Encoding-preserving writer for this private copy only, never for workspace documents. */
export function sandboxVersionEditIO(
  sandbox: CompatibilitySandbox,
): VersionEditIO {
  const allowed = new Set([...sandbox.sourceToCopy.values()].map(pathKey));
  const tokens = new WeakMap<
    VersionDocumentSnapshot,
    { hash: string; source: ReturnType<typeof decodeProjectText> }
  >();
  const check = (file: string) => {
    if (!containsPath(sandbox.root, file) || !allowed.has(pathKey(file)))
      throw new VersionEditError(
        "invalid-path",
        "The document is not in this copy's map.",
      );
  };
  return {
    async read(file) {
      check(file);
      const bytes = await readScopedFile(file, sandbox.root);
      if (!bytes)
        throw new VersionEditError(
          "missing-document",
          "The copied declaration disappeared.",
        );
      const source = decodeProjectText(bytes);
      const snapshot = { path: file, text: source.text };
      tokens.set(snapshot, { hash: contentHash(bytes), source });
      return snapshot;
    },
    async writeIfUnchanged(expected, replacementText) {
      check(expected.path);
      const token = tokens.get(expected);
      const bytes = await readScopedFile(expected.path, sandbox.root);
      if (!token || !bytes || contentHash(bytes) !== token.hash)
        throw new VersionEditError(
          "stale-document",
          "The private copy changed during verification.",
        );
      await fs.writeFile(
        expected.path,
        encodeProjectText(token.source, replacementText),
      );
      tokens.delete(expected);
    },
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function serialize(element: XmlElement): string {
  const attributes = Object.entries(element.attributes)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
  const body = element.children
    .map((child) =>
      child instanceof XmlElement
        ? serialize(child)
        : ["text", "cdata"].includes(child.type) && "text" in child
          ? escapeXml(String(child.text))
          : "",
    )
    .join("");
  return `<${element.name}${attributes}>${body}</${element.name}>`;
}
function isolatedConfig(
  text: string,
  original: string,
  packagesPath: string,
): string {
  const document = parseXml(text, { preserveDocumentType: true });
  const root = document.root;
  if (
    !root ||
    root.name !== "configuration" ||
    document.children.some((node) => node.type === "doctype")
  )
    throw new ProjectContextError(
      "unsupported-context",
      "Unsupported restore configuration.",
    );
  if (/%[a-z_][a-z0-9_]*%/i.test(text))
    throw new ProjectContextError(
      "unsupported-context",
      "Environment-dependent configuration needs an explicit resolved snapshot.",
    );
  const childElements = (element: XmlElement) =>
    element.children.filter(
      (child): child is XmlElement => child instanceof XmlElement,
    );
  for (const sources of childElements(root).filter(
    (child) => child.name === "packageSources",
  )) {
    for (const item of childElements(sources)) {
      const value = item.attributes.value;
      if (
        item.name === "add" &&
        value &&
        !path.isAbsolute(value) &&
        !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)
      )
        item.attributes.value = path.resolve(path.dirname(original), value);
    }
  }
  let config = childElements(root).find((child) => child.name === "config");
  if (!config) {
    config = new XmlElement("config");
    root.children.push(config);
  }
  config.children = config.children.filter(
    (child) =>
      !(
        child instanceof XmlElement &&
        child.attributes.key?.toLowerCase() === "globalpackagesfolder"
      ),
  );
  config.children.push(
    new XmlElement("add", { key: "globalPackagesFolder", value: packagesPath }),
  );
  return `<?xml version="1.0" encoding="utf-8"?>\n${serialize(root)}\n`;
}

/** Copies only the sealed input manifest. It never recursively copies a workspace. */
export async function createCompatibilitySandbox(
  project: EvaluatedProject,
  signal?: AbortSignal,
): Promise<CompatibilitySandbox> {
  if (!project.isolation.supported || !project.restoreConfigPath)
    throw new ProjectContextError(
      "unsupported-context",
      "The evaluation has no supported, explicit restore context.",
    );
  await verifyProjectInputs(project.inputs, project.directories, signal);
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "nuget-verification-")),
  );
  const owned = await fs.lstat(root);
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    const current = await fs
      .lstat(root)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
    if (
      current &&
      (!current.isDirectory() ||
        current.isSymbolicLink() ||
        current.ino !== owned.ino ||
        current.dev !== owned.dev)
    )
      throw new ProjectContextError(
        "stale-input",
        "The owned temporary directory changed identity.",
      );
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
    disposed = true;
  };
  try {
    const workspacePath = path.join(root, "workspace");
    const packagesPath = path.join(root, "packages");
    const restoreConfigPath = path.join(root, "NuGet.Config");
    await fs.mkdir(workspacePath, { mode: 0o700 });
    await fs.mkdir(packagesPath, { mode: 0o700 });
    const sourceToCopy = new Map<string, string>();
    for (const input of project.inputs) {
      signal?.throwIfAborted();
      if (!input.copy || input.hash === null) continue;
      const bytes = await readScopedFile(input.path, input.scopeRoot);
      if (!bytes || contentHash(bytes) !== input.hash)
        throw new ProjectContextError(
          "stale-input",
          "An input changed while materializing the copy.",
        );
      if (containsPath(project.root, input.path)) {
        const destination = path.join(
          workspacePath,
          path.relative(project.root, input.path),
        );
        if (!containsPath(workspacePath, destination))
          throw new ProjectContextError(
            "outside-scope",
            "An input cannot be mapped into the copy.",
          );
        await fs.mkdir(path.dirname(destination), {
          recursive: true,
          mode: 0o700,
        });
        await fs.writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
        sourceToCopy.set(input.path, destination);
      } else if (input.kind !== "configuration")
        throw new ProjectContextError(
          "outside-scope",
          "An authoring input lies outside the captured root.",
        );
      if (pathKey(input.path) === pathKey(project.restoreConfigPath)) {
        await fs.writeFile(
          restoreConfigPath,
          isolatedConfig(
            decodeProjectText(bytes).text,
            input.path,
            packagesPath,
          ),
          { flag: "wx", mode: 0o600 },
        );
        if (!sourceToCopy.has(input.path))
          sourceToCopy.set(input.path, restoreConfigPath);
      }
    }
    const projectPath = sourceToCopy.get(project.projectPath);
    if (!projectPath)
      throw new ProjectContextError(
        "unsupported-context",
        "The selected project was not materialized.",
      );
    await verifyProjectInputs(project.inputs, project.directories, signal);
    return Object.freeze({
      root,
      workspacePath,
      projectPath,
      restoreConfigPath,
      packagesPath,
      sourceToCopy,
      dispose,
    });
  } catch (error) {
    await dispose();
    throw error;
  }
}

/** Must succeed before S4 applies a candidate plan to the copy. */
export async function validateCompatibilitySandbox(
  cli: NuGetCli,
  original: EvaluatedProject,
  sandbox: CompatibilitySandbox,
  signal?: AbortSignal,
): Promise<void> {
  await verifyProjectInputs(original.inputs, original.directories, signal);
  for (const node of original.projects) {
    signal?.throwIfAborted();
    const copied = sandbox.sourceToCopy.get(node.path);
    if (!copied)
      throw new ProjectContextError(
        "copy-mismatch",
        "A project is absent from the copy map.",
      );
    const warm = original.inputs.some(
      (input) =>
        input.kind === "generated" &&
        input.hash !== null &&
        path.dirname(input.path) === path.join(path.dirname(node.path), "obj"),
    );
    if (warm) {
      const result = await cli.runDotnet(
        [
          "restore",
          copied,
          "--configfile",
          sandbox.restoreConfigPath,
          "--packages",
          sandbox.packagesPath,
        ],
        path.dirname(copied),
        { signal },
      );
      if (result.code !== 0)
        throw new ProjectContextError(
          "copy-mismatch",
          "The original restore state could not be reproduced in the copy.",
        );
    }
  }
  const copied = await evaluateProject(
    cli,
    {
      projectPath: sandbox.projectPath,
      allowedRoots: [sandbox.workspacePath],
      restoreConfigPath: sandbox.restoreConfigPath,
      feedUrls: original.feedUrls,
      sourceRevision: original.sourceRevision,
    },
    signal,
  );
  if (
    !copied.isolation.supported ||
    copied.projects.length !== original.projects.length
  )
    throw new ProjectContextError(
      "copy-mismatch",
      "The copied context is not equivalent to the evaluated context.",
    );
  for (const node of original.projects) {
    const mapped = sandbox.sourceToCopy.get(node.path)!;
    const match = copied.projects.find(
      (project) => pathKey(project.path) === pathKey(mapped),
    );
    if (
      !match ||
      JSON.stringify(semanticProject(node, original.root)) !==
        JSON.stringify(semanticProject(match, sandbox.workspacePath))
    )
      throw new ProjectContextError(
        "copy-mismatch",
        "Project evaluation changed after relocation.",
      );
  }
  const toolHashes = (project: EvaluatedProject) =>
    project.inputs
      .filter((input) => input.kind === "tool")
      .map((input) => [pathKey(input.path), input.hash])
      .sort();
  if (
    JSON.stringify(toolHashes(original)) !== JSON.stringify(toolHashes(copied))
  )
    throw new ProjectContextError(
      "copy-mismatch",
      "The toolchain changed between evaluations.",
    );
  await verifyProjectInputs(original.inputs, original.directories, signal);
}
