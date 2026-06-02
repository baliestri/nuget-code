import { getServiceResource, getFeedJson } from "#client/feed-http";
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

export async function searchPackages(options: {
  feeds: PackageFeed[];
  selectedFeedId: string;
  query: string;
  includePrerelease: boolean;
  settings: NuGetClientSettings;
  logger: NuGetClientLogger;
  signal?: AbortSignal | undefined;
}): Promise<NuGetPackageItem[]> {
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
    query: string;
    includePrerelease: boolean;
    take: number;
    settings: NuGetClientSettings;
    logger: NuGetClientLogger;
    signal?: AbortSignal | undefined;
  },
): Promise<NuGetPackageItem[]> {
  if (!isHttpUrl(feed.url)) {
    options.logger.verbose(
      "nuget.http",
      `Skipping non-HTTP source ${feed.name}: ${feed.url}`,
    );
    return [];
  }

  try {
    const searchResource = await getServiceResource(
      feed,
      "searchqueryservice",
      options.settings,
      options.logger,
      options.signal,
    );
    if (!searchResource?.["@id"]) {
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
