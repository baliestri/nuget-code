import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import type {
  NuGetConfigFile,
  SourceDestination,
  SourceEdit,
  SourcePropertiesEdit,
  SourceEditRequest,
  WorkspaceTarget,
} from "#contracts";
import {
  editPackageSource,
  editSourceProperties,
  credentialSourceName,
} from "#client/source-edits";
import {
  containsPath,
  decodeProjectText,
  pathKey,
} from "#client/project-files";
import { workspace } from "vscode";
import {
  createVersionEditIO,
  vscodeEditorPort,
  type EditorPort,
} from "#extension/webview/version-edit-io";

const hash = (bytes: Buffer | undefined) =>
  bytes ? createHash("sha256").update(bytes).digest("hex") : "missing";
export function sourceEditSummary(
  file: string,
  edit: SourceEdit | SourcePropertiesEdit,
  sources: NuGetConfigFile[],
): string {
  if (edit.action === "properties")
    return `Saved package folder properties in ${file}. Empty fields inherit their values. Other projects using this file may also be affected.`;
  const feeds = sources.find((source) => source.origin === "effective")?.feeds;
  const original = edit.originalName ?? edit.name;
  let scope = "This file may also affect other projects.";
  if (feeds) {
    if (edit.action === "remove") {
      scope = feeds.some((feed) => feed.name === original)
        ? "The effective source is still present through an inherited or descendant configuration."
        : "The source is absent from the selected target's effective configuration.";
    } else {
      const matches = feeds.filter((feed) => feed.name === edit.name);
      const url =
        path.isAbsolute(edit.url) || /^[a-z][a-z0-9+.-]*:\/\//i.test(edit.url)
          ? edit.url
          : path.resolve(path.dirname(file), edit.url);
      const changed =
        matches.length === 1 &&
        matches[0]!.url === url &&
        matches[0]!.enabled === edit.enabled &&
        !!matches[0]!.allowInsecure === edit.allowInsecure &&
        (original === edit.name ||
          !feeds.some((feed) => feed.name === original));
      scope = changed
        ? "The change is reflected in the selected target's effective configuration."
        : "The effective value is still inherited, overridden, or outside this destination's scope. Select Effective and an applicable destination to change it.";
    }
  }
  return `Saved ${file}. ${scope} Other projects using this file may also be affected.`;
}
async function read(file: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export class SourceEditService {
  private destinations = new Map<string, SourceDestination>();
  private generation = 0;
  invalidate(): void {
    this.generation++;
    this.destinations.clear();
  }
  constructor(private readonly editor: EditorPort = vscodeEditorPort) {}
  async describe(
    sources: NuGetConfigFile[],
    roots: string[],
    target?: WorkspaceTarget,
    saveIn = "workspace",
  ): Promise<SourceDestination[]> {
    const generation = ++this.generation;
    const files: string[] = [];
    let suggested: string | undefined;
    if (target) {
      const folder = path.dirname(target.path);
      if (roots.some((root) => containsPath(root, folder))) {
        suggested =
          sources.find(
            (source) =>
              source.path &&
              pathKey(path.dirname(source.path)) === pathKey(folder),
          )?.path ?? path.join(folder, "NuGet.Config");
        files.push(suggested);
      }
    }
    for (const root of roots)
      files.push(
        sources.find(
          (source) => source.path && path.dirname(source.path) === root,
        )?.path ?? path.join(root, "NuGet.Config"),
      );
    const user =
      process.platform === "win32" && process.env.APPDATA
        ? path.join(process.env.APPDATA, "NuGet", "NuGet.Config")
        : path.join(os.homedir(), ".nuget", "NuGet", "NuGet.Config");
    files.push(
      user,
      ...sources
        .filter((source) => source.origin !== "effective")
        .map((source) => source.path),
    );
    if (!suggested && roots.length === 1) suggested = files[0];
    if (saveIn === "user") suggested = user;
    else if (saveIn !== "workspace") {
      const root =
        roots.find((root) => target && containsPath(root, target.path)) ??
        (roots.length === 1 ? roots[0] : undefined);
      if (!saveIn.trim() || (!path.isAbsolute(saveIn) && !root))
        throw new Error(
          "Set nuget-code.sources.saveIn to workspace, user, or an absolute NuGet.Config path.",
        );
      suggested = path.isAbsolute(saveIn)
        ? path.normalize(saveIn)
        : path.resolve(root!, saveIn);
      files.push(suggested);
    }
    const unique = [
      ...new Map(files.map((file) => [pathKey(file), file])).values(),
    ];
    const destinations = await Promise.all(
      unique.map(async (file) => ({
        id: file,
        path: file,
        label: file === user ? `User: ${file}` : file,
        revision: hash(await read(file)),
        suggested: file === suggested,
      })),
    );
    if (generation === this.generation)
      this.destinations = new Map(destinations.map((item) => [item.id, item]));
    return destinations;
  }
  async apply(
    request: SourceEditRequest,
    sources: NuGetConfigFile[],
    isCurrent: () => boolean = () => true,
  ): Promise<string> {
    if (!request || typeof request.requestId !== "string" || !request.requestId)
      throw new Error("Invalid source edit request.");
    const generation = this.generation;
    const assertCurrent = () => {
      if (generation !== this.generation || !isCurrent())
        throw new Error("The selected context changed. Reload Sources.");
    };
    assertCurrent();
    const source = sources.find((source) => source.id === request.sourceId);
    const destination = this.destinations.get(request.destinationId);
    if (
      !source ||
      source.revision !== request.sourceRevision ||
      !destination ||
      destination.revision !== request.destinationRevision
    )
      throw new Error(
        "Source configuration changed. Reload Sources before saving.",
      );
    if (source.origin !== "effective" && source.path !== destination.path)
      throw new Error("Select the config file's own destination.");
    const edit = request.edit;
    if (edit?.action !== "properties") {
      if (
        !edit ||
        !["upsert", "remove"].includes(edit.action) ||
        typeof edit.name !== "string" ||
        typeof edit.url !== "string" ||
        typeof edit.enabled !== "boolean" ||
        typeof edit.allowInsecure !== "boolean" ||
        (edit.originalName !== undefined &&
          typeof edit.originalName !== "string")
      )
        throw new Error("Invalid source edit.");
      const name = edit.originalName ?? edit.name;
      if (edit.originalName && !source.feeds.some((feed) => feed.name === name))
        throw new Error("The source no longer exists.");
      if (edit.action === "remove" && !edit.originalName)
        throw new Error("Select an existing source to remove.");
      if (
        (!edit.originalName || name !== edit.name) &&
        source.feeds.some((feed) => feed.name === edit.name)
      )
        throw new Error("A source with this name already exists.");
      if (
        (edit.action === "remove" || name !== edit.name) &&
        sources.some(
          (item) =>
            item.credentialNames?.some(
              (key) => credentialSourceName(key) === name,
            ) || item.mappingNames?.includes(name),
        )
      )
        throw new Error(
          "Adjust source credentials or package source mappings before renaming or removing this source.",
        );
    }
    const file = destination.path;
    const bytes = await read(file);
    assertCurrent();
    if (hash(bytes) !== request.destinationRevision)
      throw new Error("The destination changed. Reload Sources before saving.");
    const originalText = bytes
      ? decodeProjectText(bytes).text
      : '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n</configuration>\n';
    const replacement =
      edit.action === "properties"
        ? editSourceProperties(originalText, edit)
        : editPackageSource(
            originalText,
            edit,
            source.origin === "effective" ? source.feeds : undefined,
          );
    if (bytes) {
      const io = createVersionEditIO(
        new Map([[file, path.dirname(file)]]),
        this.editor,
        () => generation !== this.generation || !isCurrent(),
      );
      const snapshot = await io.read(file);
      if (snapshot.text !== decodeProjectText(bytes).text)
        throw new Error("The document changed. Reload Sources.");
      await this.verifySources(sources);
      assertCurrent();
      await io.writeIfUnchanged(snapshot, replacement);
    } else {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const parent = await fs.lstat(path.dirname(file));
      if (!parent.isDirectory() || parent.isSymbolicLink())
        throw new Error(
          "The destination directory is redirected. Choose its real path.",
        );
      await this.verifySources(sources);
      assertCurrent();
      if (
        workspace.textDocuments?.some(
          (document) =>
            pathKey(document.uri.fsPath) === pathKey(file) && document.isDirty,
        )
      )
        throw new Error(
          "Save or resolve changes in the configuration before retrying.",
        );
      await fs.writeFile(file, replacement, { flag: "wx" });
    }
    return file;
  }
  private async verifySources(sources: NuGetConfigFile[]): Promise<void> {
    for (const source of sources) {
      if (
        source.origin !== "effective" &&
        source.revision &&
        hash(await read(source.path)) !== source.revision
      )
        throw new Error(
          "Source configuration changed. Reload Sources before saving.",
        );
    }
  }
}
