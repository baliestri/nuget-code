import fs from "node:fs/promises";
import path from "node:path";
import { openPromise } from "yauzl";
import { parseXml, XmlElement } from "@rgrove/parse-xml";
import { parseNuGetVersion } from "#manager";
import { ResourceCache } from "#client/resource-cache";
import { cachePolicy } from "#client/cache";
export interface LocalPackageEntry {
  packageId: string;
  version: string;
  filePath: string;
}
export class LocalFeedIndex {
  private readonly failures = new Map<
    string,
    {
      expiresAt: number;
      value: { entries: LocalPackageEntry[]; complete: boolean };
    }
  >();
  private readonly cache = new ResourceCache();
  private scans = 0;
  metrics(): { scans: number } {
    return { scans: this.scans };
  }
  async read(
    feedPath: string,
    force: boolean,
  ): Promise<readonly LocalPackageEntry[]> {
    return (
      await this.snapshot(
        feedPath,
        force ? this.cache.refresh() : this.cache.generation,
      )
    ).entries;
  }
  async snapshot(
    feedPath: string,
    revision: number,
    signal?: AbortSignal,
    onFailure?: (message: string) => void,
  ): Promise<{ entries: LocalPackageEntry[]; complete: boolean }> {
    signal?.throwIfAborted();
    const key = `${path.resolve(feedPath)}:${revision}`;
    for (const [key, value] of this.failures)
      if (value.expiresAt <= Date.now()) this.failures.delete(key);
    const failed = this.failures.get(key);
    if (failed) return failed.value;
    return this.cache.read(
      key,
      cachePolicy.metadataTtlMs,
      this.cache.generation,
      async (signal) => {
        this.scans++;
        const entries: LocalPackageEntry[] = [];
        let complete = true;
        try {
          const root = await fs.realpath(feedPath);
          const visit = async (
            directory: string,
            depth: number,
          ): Promise<void> => {
            signal.throwIfAborted();
            for (const file of await fs.readdir(directory, {
              withFileTypes: true,
            })) {
              signal.throwIfAborted();
              const location = path.join(directory, file.name);
              if (file.isSymbolicLink()) {
                complete = false;
                continue;
              }
              if (file.isDirectory()) {
                if (depth < 2) await visit(location, depth + 1);
              } else if (
                file.isFile() &&
                /\.nupkg$/i.test(file.name) &&
                !/\.symbols\.nupkg$/i.test(file.name)
              ) {
                try {
                  entries.push({
                    ...(await identity(location, signal)),
                    filePath: location,
                  });
                } catch (error) {
                  if (signal.aborted) throw error;
                  complete = false;
                }
              }
            }
          };
          await visit(root, 0);
          const value = {
            entries: entries.sort((a, b) =>
              a.filePath.localeCompare(b.filePath),
            ),
            complete,
          };
          if (!complete) {
            this.failures.set(key, { expiresAt: Date.now() + 10_000, value });
            onFailure?.("Some package files could not be indexed.");
          }
          return value;
        } catch (error) {
          if (signal.aborted) throw error;
          const value = { entries, complete: false };
          this.failures.set(key, { expiresAt: Date.now() + 10_000, value });
          while (this.failures.size > 100)
            this.failures.delete(this.failures.keys().next().value!);
          const code = (error as NodeJS.ErrnoException).code;
          onFailure?.(
            `Directory unavailable${code ? ` (${code})` : ""}: ${feedPath}`,
          );
          return value;
        }
      },
      signal,
      (value) => value.complete,
    );
  }
  dispose(): void {
    this.cache.dispose();
    this.failures.clear();
  }
}
async function identity(
  file: string,
  signal: AbortSignal,
): Promise<{ packageId: string; version: string }> {
  const zip = await openPromise(file, { lazyEntries: true, autoClose: false });
  let result: { packageId: string; version: string } | undefined;
  try {
    for await (const entry of zip.eachEntry()) {
      signal.throwIfAborted();
      if (!/^[^/\\]+\.nuspec$/i.test(entry.fileName)) continue;
      if (result || entry.uncompressedSize > 1024 * 1024)
        throw new Error("Invalid nuspec size or count.");
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let size = 0;
      const abort = () =>
        stream.destroy(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      try {
        for await (const part of stream) {
          signal.throwIfAborted();
          const chunk = Buffer.from(part as Uint8Array);
          size += chunk.length;
          if (size > 1024 * 1024) throw new Error("Oversized nuspec.");
          chunks.push(chunk);
        }
      } finally {
        signal.removeEventListener("abort", abort);
        stream.destroy();
      }
      const root = parseXml(Buffer.concat(chunks).toString("utf8")).root;
      const child = (node: XmlElement | undefined | null, name: string) =>
        node?.children.find(
          (value): value is XmlElement =>
            value instanceof XmlElement &&
            value.name.split(":").at(-1) === name,
        );
      const metadata = child(root, "metadata");
      const packageId = child(metadata, "id")?.text.trim();
      const version = child(metadata, "version")?.text.trim();
      if (
        !packageId ||
        !version ||
        !parseNuGetVersion(version) ||
        root?.name.split(":").at(-1) !== "package"
      )
        throw new Error("Invalid nuspec identity.");
      result = { packageId, version };
    }
    if (!result) throw new Error("Missing nuspec.");
    return result;
  } finally {
    zip.close();
  }
}
