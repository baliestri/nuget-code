import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import {
  ProjectContextError,
  type ProjectInputSnapshot,
  type ProjectDirectorySnapshot,
} from "#client/project-context";

export const ignoredProjectDirectories = new Set([
  ".git",
  ".vs",
  ".idea",
  ".turbo",
  "node_modules",
  "bin",
  "obj",
  "artifacts",
]);
export function pathKey(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
export function containsPath(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}
export function contentHash(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}
export async function assertScopedPath(file: string, root: string) {
  if (!containsPath(root, file))
    throw new ProjectContextError(
      "outside-scope",
      "An input lies outside the authorized root.",
    );
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new ProjectContextError(
      "outside-scope",
      "The authorized root changed type.",
    );
  // Refuse intermediate links too; resolving a link must never widen the read scope.
  let current = root;
  for (const part of path
    .relative(root, file)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (stat.isSymbolicLink())
      throw new ProjectContextError(
        "outside-scope",
        "Linked inputs cannot be captured without explicit verification.",
      );
  }
  return fs.lstat(file);
}
export async function readScopedFile(
  file: string,
  root: string,
): Promise<Buffer | null> {
  const stat = await assertScopedPath(file, root);
  if (!stat) return null;
  if (!stat.isFile())
    throw new ProjectContextError(
      "unsupported-context",
      "Expected an ordinary input file.",
    );
  return fs.readFile(file);
}

export interface XmlTextSource {
  text: string;
  encoding: "utf8" | "utf16le" | "utf16be";
}
export function decodeProjectText(bytes: Buffer): XmlTextSource {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf16be"
        : "utf8";
  const text = new TextDecoder(
    encoding === "utf8"
      ? "utf-8"
      : encoding === "utf16le"
        ? "utf-16le"
        : "utf-16be",
    { fatal: true, ignoreBOM: true },
  ).decode(bytes);
  const declaration =
    /^\ufeff?\s*<\?xml\b[^?]*\bencoding\s*=\s*["']([^"']+)["']/i
      .exec(text)?.[1]
      ?.toLowerCase();
  if (
    declaration &&
    !["utf-8", "utf8", "utf-16", "utf-16le", "utf-16be"].includes(declaration)
  )
    throw new ProjectContextError(
      "unsupported-context",
      "Unsupported input encoding.",
    );
  if (
    declaration &&
    ((encoding === "utf8" && declaration.startsWith("utf-16")) ||
      (encoding !== "utf8" && ["utf8", "utf-8"].includes(declaration)) ||
      (declaration === "utf-16le" && encoding !== "utf16le") ||
      (declaration === "utf-16be" && encoding !== "utf16be"))
  ) {
    throw new ProjectContextError(
      "unsupported-context",
      "The XML encoding declaration does not match the input bytes.",
    );
  }
  if (text.includes("\0"))
    throw new ProjectContextError(
      "unsupported-context",
      "Unrecognized text encoding.",
    );
  return { text, encoding };
}
export function encodeProjectText(
  source: XmlTextSource,
  text = source.text,
): Buffer {
  const bytes = Buffer.from(
    text,
    source.encoding === "utf8" ? "utf8" : "utf16le",
  );
  return source.encoding === "utf16be" ? bytes.swap16() : bytes;
}
export async function directoryEntries(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => !ignoredProjectDirectories.has(entry.name))
    .map(
      (entry) =>
        `${entry.isSymbolicLink() ? "link" : entry.isDirectory() ? "directory" : "file"}:${entry.name}`,
    )
    .sort();
}
export async function verifyProjectInputs(
  inputs: readonly ProjectInputSnapshot[],
  directories: readonly ProjectDirectorySnapshot[],
  signal?: AbortSignal,
): Promise<void> {
  for (const input of inputs) {
    signal?.throwIfAborted();
    const bytes = await readScopedFile(input.path, input.scopeRoot);
    if ((bytes === null ? null : contentHash(bytes)) !== input.hash)
      throw new ProjectContextError(
        "stale-input",
        "Project inputs changed since evaluation.",
      );
  }
  for (const directory of directories) {
    signal?.throwIfAborted();
    const stat = await assertScopedPath(directory.path, directory.scopeRoot);
    if (!stat?.isDirectory())
      throw new ProjectContextError(
        "stale-input",
        "A discovered directory changed type.",
      );
    if (
      JSON.stringify(await directoryEntries(directory.path)) !==
      JSON.stringify(directory.entries)
    )
      throw new ProjectContextError(
        "stale-input",
        "The discovered project tree changed.",
      );
  }
}
