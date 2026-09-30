import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogVersion, PackageFeed } from "#contracts";
import type { NuGetClientLogger, NuGetClientSettings } from "#client/types";
import { networkFor } from "#client/client-network";
export async function readLocalPackageVersions(
  packageId: string,
  feed: PackageFeed,
  options: {
    settings: NuGetClientSettings;
    logger: NuGetClientLogger;
    signal?: AbortSignal | undefined;
    generation?: number | undefined;
  },
): Promise<{ versions: CatalogVersion[]; complete: boolean }> {
  const directory = localSourceDirectory(feed, options.settings);
  const network = networkFor(options.settings);
  const index = await network.localFeeds.snapshot(
    directory,
    options.generation ?? network.facts.generation,
    options.signal,
    (message) =>
      options.logger.warning(
        "nuget.feed",
        `Local source ${feed.name}: ${message}`,
      ),
  );
  return {
    complete: index.complete,
    versions: index.entries
      .filter(
        (entry) => entry.packageId.toLowerCase() === packageId.toLowerCase(),
      )
      .map((entry) => ({
        version: entry.version,
        feedUrls: [feed.url],
        listed: true,
      })),
  };
}

export function localSourceDirectory(
  feed: PackageFeed,
  settings: NuGetClientSettings,
): string {
  let directory = feed.url.startsWith("file:")
    ? fileURLToPath(feed.url)
    : feed.url;
  if (!path.isAbsolute(directory)) {
    const base = feed.sourceConfigId
      ? path.dirname(feed.sourceConfigId)
      : settings.workspacePath;
    if (!base) throw new Error("Relative source has no declaring directory.");
    directory = path.resolve(base, directory);
  }
  return directory;
}
