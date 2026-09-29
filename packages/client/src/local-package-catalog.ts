import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openPromise } from "yauzl";
import { parseXml, XmlElement } from "@rgrove/parse-xml";
import type { CatalogVersion, PackageFeed } from "#contracts";
import type { NuGetClientLogger, NuGetClientSettings } from "#client/types";
import { parseNuGetVersion } from "#manager";

async function readPackageIdentity(
  file: string,
  signal?: AbortSignal,
): Promise<{ id: string; version: string }> {
  signal?.throwIfAborted();
  const zip = await openPromise(file, { lazyEntries: true, autoClose: false });
  let result: { id: string; version: string } | undefined;
  try {
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      if (!/^[^/\\]+\.nuspec$/i.test(entry.fileName)) continue;
      if (result || entry.uncompressedSize > 1024 * 1024)
        throw new Error("Ambiguous or oversized nuspec metadata.");
      const stream = await zip.openReadStreamPromise(entry);
      const abort = () =>
        stream.destroy(new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
          signal?.throwIfAborted();
          const buffer = Buffer.from(chunk as Uint8Array);
          size += buffer.length;
          if (size > 1024 * 1024) throw new Error("Oversized nuspec metadata.");
          chunks.push(buffer);
        }
        const root = parseXml(Buffer.concat(chunks).toString("utf8")).root;
        const child = (element: XmlElement | null | undefined, name: string) =>
          element?.children.find(
            (item): item is XmlElement =>
              item instanceof XmlElement &&
              item.name.split(":").at(-1) === name,
          );
        const metadata = child(root, "metadata");
        const id = child(metadata, "id")?.text.trim();
        const version = child(metadata, "version")?.text.trim();
        if (
          root?.name.split(":").at(-1) !== "package" ||
          !id ||
          !version ||
          !parseNuGetVersion(version)
        )
          throw new Error("Invalid nuspec identity.");
        result = { id, version };
      } finally {
        signal?.removeEventListener("abort", abort);
        stream.destroy();
      }
    }
    if (!result) throw new Error("Package has no nuspec metadata.");
    return result;
  } finally {
    zip.close();
  }
}

export async function readLocalPackageVersions(
  packageId: string,
  feed: PackageFeed,
  options: {
    settings: NuGetClientSettings;
    logger: NuGetClientLogger;
    signal?: AbortSignal | undefined;
  },
): Promise<{ versions: CatalogVersion[]; complete: boolean }> {
  let directory = feed.url.startsWith("file:")
    ? fileURLToPath(feed.url)
    : feed.url;
  if (!path.isAbsolute(directory)) {
    const base = feed.sourceConfigId
      ? path.dirname(feed.sourceConfigId)
      : options.settings.workspacePath;
    if (!base)
      throw new Error("Relative local source has no declaring directory.");
    directory = path.resolve(base, directory);
  }
  const files: string[] = [];
  let complete = true;
  const id = packageId.toLowerCase();
  async function scan(folder: string, depth: number): Promise<void> {
    options.signal?.throwIfAborted();
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const name = entry.name.toLowerCase();
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) {
        complete = false;
        continue;
      }
      if (
        entry.isFile() &&
        name.startsWith(`${id}.`) &&
        name.endsWith(".nupkg") &&
        !name.endsWith(".symbols.nupkg")
      )
        files.push(file);
      else if (
        entry.isDirectory() &&
        ((depth === 0 && name === id) || depth === 1)
      )
        await scan(file, depth + 1);
    }
  }
  await scan(directory, 0);
  const versions: CatalogVersion[] = [];
  for (const file of files.sort()) {
    options.signal?.throwIfAborted();
    try {
      const metadata = await readPackageIdentity(file, options.signal);
      if (metadata.id.toLowerCase() === id)
        versions.push({
          version: metadata.version,
          feedUrls: [feed.url],
          listed: true,
        });
    } catch (error) {
      if (
        options.signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      )
        throw error;
      complete = false;
      options.logger.warning(
        "nuget.packages",
        `Could not read local package ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { versions, complete };
}
