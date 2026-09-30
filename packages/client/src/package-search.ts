import { getServiceResource, getFeedJson } from "#client/feed-http";
import { networkFor } from "#client/client-network";
import { cachePolicy } from "#client/cache";
import { localSourceDirectory } from "#client/local-package-catalog";
import type { NuGetClientLogger, NuGetClientSettings } from "#client/types";
import { toFeedSummary } from "#client/package-details";
import type { SearchResponse } from "#client/package-types";
import {
  comparePackageVersions,
  isHttpUrl,
  isPrereleaseVersion,
  mergePackageResults,
} from "#manager";
import type {
  NuGetPackageItem,
  PackageFeed,
  PackageVersionInfo,
} from "#contracts/nuget";

interface SearchOptions {
  force?: boolean;
  generation?: number | undefined;
  onIncomplete?: () => void;
  feeds: PackageFeed[];
  selectedFeedId: string;
  query: string;
  includePrerelease: boolean;
  settings: NuGetClientSettings;
  logger: NuGetClientLogger;
  signal?: AbortSignal | undefined;
}
export async function searchPackages(
  options: SearchOptions,
): Promise<NuGetPackageItem[]> {
  const network = networkFor(options.settings);
  const generation =
    options.generation ??
    (options.force ? network.refresh() : network.facts.generation);
  const key = network.key([
    "search",
    options.feeds.map((feed) => [feed.id, feed.url, feed.enabled]),
    options.selectedFeedId,
    options.query,
    options.includePrerelease,
    options.settings.maxSearchResults,
    network.context(options.settings),
    generation,
  ]);
  const result = await network.searches.read(
    key,
    cachePolicy.searchTtlMs,
    network.searches.generation,
    async (signal) => {
      let complete = true;
      const packages = await searchUncached({
        ...options,
        generation,
        signal,
        onIncomplete: () => {
          complete = false;
        },
      });
      return { packages, complete };
    },
    options.signal,
    (value) => value.complete,
  );
  if (!result.complete) options.onIncomplete?.();
  return result.packages;
}
async function searchUncached(
  options: SearchOptions,
): Promise<NuGetPackageItem[]> {
  const enabledFeeds = options.feeds.filter((feed) => feed.enabled);
  const feeds =
    options.selectedFeedId === "__all__"
      ? enabledFeeds
      : enabledFeeds.filter((feed) => feed.id === options.selectedFeedId);

  const results = await Promise.all(
    feeds.map((feed) =>
      searchFeed(feed, {
        query: options.query,
        includePrerelease: options.includePrerelease,
        take: options.settings.maxSearchResults,
        settings: options.settings,
        logger: options.logger,
        signal: options.signal,
        onIncomplete: options.onIncomplete,
        generation: options.generation,
      }),
    ),
  );

  return mergePackageResults(results.flat()).slice(
    0,
    options.settings.maxSearchResults,
  );
}

async function searchFeed(
  feed: PackageFeed,
  options: {
    generation?: number | undefined;
    onIncomplete?: (() => void) | undefined;
    query: string;
    includePrerelease: boolean;
    take: number;
    settings: NuGetClientSettings;
    logger: NuGetClientLogger;
    signal?: AbortSignal | undefined;
  },
): Promise<NuGetPackageItem[]> {
  if (!isHttpUrl(feed.url)) {
    const network = networkFor(options.settings);
    const index = await network.localFeeds.snapshot(
      localSourceDirectory(feed, options.settings),
      options.generation ?? network.facts.generation,
      options.signal,
      (message) =>
        options.logger.warning(
          "nuget.feed",
          `Local source ${feed.name}: ${message}`,
        ),
    );
    if (!index.complete) options.onIncomplete?.();
    const packages = new Map<
      string,
      { name: string; versions: PackageVersionInfo[] }
    >();
    for (const entry of index.entries) {
      if (
        !entry.packageId
          .toLowerCase()
          .includes(options.query.toLowerCase().trim()) ||
        (!options.includePrerelease && isPrereleaseVersion(entry.version))
      )
        continue;
      const key = entry.packageId.toLowerCase();
      const item = packages.get(key) ?? { name: entry.packageId, versions: [] };
      item.versions.push({ version: entry.version, source: feed.name });
      packages.set(key, item);
    }
    return [...packages.values()].slice(0, options.take).map((item) => ({
      id: `${feed.id}:${item.name}`,
      name: item.name,
      availableVersion: item.versions
        .sort((a, b) => comparePackageVersions(a.version, b.version))
        .at(-1)!.version,
      versions: item.versions,
      sourceName: feed.name,
      sourceUrl: feed.url,
      availableFeeds: [toFeedSummary(feed)],
      projectPaths: [],
      dependencyGroups: [],
    }));
  }

  try {
    const searchResource = await getServiceResource(
      feed,
      "searchqueryservice",
      options.settings,
      options.logger,
      options.signal,
      { generation: options.generation },
    );
    if (!searchResource?.["@id"]) {
      options.onIncomplete?.();
      options.logger.warning(
        "nuget.http",
        `${feed.name} has no SearchQueryService`,
      );
      return [];
    }
    const searchUrl = new URL(searchResource["@id"]);
    searchUrl.searchParams.set("q", options.query);
    searchUrl.searchParams.set("take", String(options.take));
    searchUrl.searchParams.set("prerelease", String(options.includePrerelease));
    const result = await getFeedJson<SearchResponse>({
      url: searchUrl.toString(),
      feed,
      settings: options.settings,
      logger: options.logger,
      signal: options.signal,
      generation: options.generation,
    });

    return (result.data ?? [])
      .map((item): NuGetPackageItem | undefined => {
        const versions = (item.versions ?? [])
          .filter(
            (version) =>
              options.includePrerelease ||
              !isPrereleaseVersion(version.version),
          )
          .map<PackageVersionInfo>((version) => ({
            version: version.version,
            source: feed.name,
          }))
          .sort((a, b) => comparePackageVersions(a.version, b.version));
        const stableVersion =
          item.version && !isPrereleaseVersion(item.version)
            ? item.version
            : versions[versions.length - 1]?.version;
        const availableVersion = options.includePrerelease
          ? item.version
          : stableVersion;

        if (!availableVersion) {
          return undefined;
        }

        return {
          id: `${feed.id}:${item.id}`,
          name: item.id,
          availableVersion,
          sourceName: feed.name,
          sourceUrl: feed.url,
          availableFeeds: [toFeedSummary(feed)],
          iconUrl: item.iconUrl,
          description: item.description,
          authors: Array.isArray(item.authors)
            ? item.authors.join(", ")
            : item.authors,
          tags: item.tags,
          published: item.published,
          projectPaths: [],
          versions,
          dependencyGroups: [],
        };
      })
      .filter((item): item is NuGetPackageItem => item !== undefined);
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) {
      throw error;
    }

    options.logger.warning(
      "nuget.http",
      `Failed to search ${feed.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    options.onIncomplete?.();
    return [];
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
