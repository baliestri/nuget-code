import { getServiceResource, getFeedJson } from "#client/feed-http";
import type { NuGetClientLogger, NuGetClientSettings } from "#client/types";
import type {
  RegistrationDependencyGroup,
  RegistrationIndex,
  RegistrationLeaf,
  RegistrationPage,
} from "#client/package-types";
import {
  comparePackageVersions,
  displayFeedName,
  feedColor,
  isHttpUrl,
  isPrereleaseVersion,
} from "#manager";
import type {
  NuGetPackageDependencyGroup,
  NuGetPackageItem,
  PackageFeed,
  PackageFeedSummary,
} from "#contracts/nuget";

const packageDetailsCache = new Map<
  string,
  Promise<NuGetPackageItem | undefined>
>();

export interface PackageDetailsCache {
  get(key: string): NuGetPackageItem | undefined;
  set(key: string, value: NuGetPackageItem): void | Promise<void>;
}

export async function loadPackageDetails(options: {
  packageId: string;
  feed: PackageFeed | undefined;
  includePrerelease: boolean;
  cache?: PackageDetailsCache | undefined;
  settings: NuGetClientSettings;
  logger: NuGetClientLogger;
  signal?: AbortSignal | undefined;
}): Promise<NuGetPackageItem | undefined> {
  if (!options.feed) {
    return undefined;
  }

  return loadPackageDetailsFromFeedCached(options.packageId, options.feed, {
    includePrerelease: options.includePrerelease,
    cache: options.cache,
    settings: options.settings,
    logger: options.logger,
    signal: options.signal,
  });
}

export function loadPackageDetailsFromFeedCached(
  packageName: string,
  feed: PackageFeed,
  options: {
    includePrerelease?: boolean | undefined;
    cache?: PackageDetailsCache | undefined;
    settings: NuGetClientSettings;
    logger: NuGetClientLogger;
    signal?: AbortSignal | undefined;
  },
): Promise<NuGetPackageItem | undefined> {
  const key = packageDetailsCacheKey(
    packageName,
    feed,
    options.includePrerelease,
  );
  const persisted = options.cache?.get(key);
  if (persisted) {
    return Promise.resolve(persisted);
  }

  const cached = packageDetailsCache.get(key);
  if (cached) {
    return cached;
  }

  const promise = loadPackageDetailsFromFeed(packageName, feed, options).then(
    (details) => {
      if (!details) {
        packageDetailsCache.delete(key);
      } else {
        void options.cache?.set(key, details);
      }
      return details;
    },
    (error: unknown) => {
      packageDetailsCache.delete(key);
      throw error;
    },
  );
  packageDetailsCache.set(key, promise);
  return promise;
}

export function toFeedSummary(feed: PackageFeed): PackageFeedSummary {
  const displayName = displayFeedName(feed.name);
  return {
    id: feed.id,
    name: feed.name,
    displayName,
    url: feed.url,
    color: feedColor(displayName),
  };
}

function packageDetailsCacheKey(
  packageName: string,
  feed: PackageFeed,
  includePrerelease: boolean | undefined,
): string {
  return `${feed.id}:${packageName.toLowerCase()}:${includePrerelease !== false}`;
}

async function loadPackageDetailsFromFeed(
  packageName: string,
  feed: PackageFeed,
  options: {
    includePrerelease?: boolean | undefined;
    settings: NuGetClientSettings;
    logger: NuGetClientLogger;
    signal?: AbortSignal | undefined;
  },
): Promise<NuGetPackageItem | undefined> {
  if (!isHttpUrl(feed.url)) {
    options.logger.verbose(
      "nuget.http",
      `Skipping details for non-HTTP source ${feed.name}: ${feed.url}`,
    );
    return undefined;
  }

  try {
    const registrationResource = await getServiceResource(
      feed,
      "registrationsbaseurl",
      options.settings,
      options.logger,
      options.signal,
    );
    if (!registrationResource?.["@id"]) {
      options.logger.warning(
        "nuget.http",
        `${feed.name} has no RegistrationsBaseUrl`,
      );
      return undefined;
    }

    const registrationUrl = new URL(
      `${packageName.toLowerCase()}/index.json`,
      ensureTrailingSlash(registrationResource["@id"]),
    );
    const registration = await getFeedJson<RegistrationIndex>({
      url: registrationUrl.toString(),
      feed,
      settings: options.settings,
      logger: options.logger,
      signal: options.signal,
    });
    const entries = (
      await loadRegistrationEntries(registration, feed, options)
    ).filter(
      (entry) =>
        options.includePrerelease !== false ||
        !isPrereleaseVersion(entry.catalogEntry.version),
    );
    if (entries.length === 0) {
      return undefined;
    }

    const latest = entries[entries.length - 1];
    if (!latest) {
      return undefined;
    }
    const latestEntry = latest.catalogEntry;
    return {
      id: `${feed.id}:${packageName}`,
      name: latestEntry.id ?? packageName,
      availableVersion: latestEntry.version,
      sourceName: feed.name,
      sourceUrl: feed.url,
      iconUrl: latestEntry.iconUrl,
      description: latestEntry.description,
      authors: Array.isArray(latestEntry.authors)
        ? latestEntry.authors.join(", ")
        : latestEntry.authors,
      tags: Array.isArray(latestEntry.tags)
        ? latestEntry.tags
        : splitTags(latestEntry.tags),
      published: latestEntry.published,
      projectPaths: [],
      versions: entries.map((entry) => ({
        version: entry.catalogEntry.version,
        source: feed.name,
        published: entry.catalogEntry.published,
      })),
      dependencyGroups: toDependencyGroups(latestEntry.dependencyGroups),
      availableFeeds: [toFeedSummary(feed)],
      deprecated: latestEntry.deprecation !== undefined,
      alternatePackage: latestEntry.deprecation?.alternatePackage?.id,
    };
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) {
      throw error;
    }

    options.logger.warning(
      "nuget.http",
      `Failed to load details for ${packageName} from ${feed.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

async function loadRegistrationEntries(
  registration: RegistrationIndex,
  feed: PackageFeed,
  options: {
    settings: NuGetClientSettings;
    logger: NuGetClientLogger;
    signal?: AbortSignal | undefined;
  },
): Promise<RegistrationLeaf[]> {
  const pages = await Promise.all(
    (registration.items ?? []).map(async (page: RegistrationPage) => {
      if (page.items) {
        return page.items;
      }
      if (!page["@id"]) {
        return [];
      }
      const loadedPage = await getFeedJson<RegistrationPage>({
        url: page["@id"],
        feed,
        settings: options.settings,
        logger: options.logger,
        signal: options.signal,
      });
      return loadedPage.items ?? [];
    }),
  );
  const entries = pages.flat();

  return entries
    .filter((entry) => entry.catalogEntry?.version)
    .sort((a, b) =>
      comparePackageVersions(a.catalogEntry.version, b.catalogEntry.version),
    );
}

function toDependencyGroups(
  groups: RegistrationDependencyGroup[] | undefined,
): NuGetPackageDependencyGroup[] {
  return (groups ?? []).map((group) => ({
    framework: group.targetFramework ?? "",
    dependencies: (group.dependencies ?? []).map((dependency) => ({
      id: dependency.id,
      versionRange: dependency.range ?? "",
    })),
  }));
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function splitTags(tags: string | undefined): string[] | undefined {
  return tags?.split(/\s+/).filter(Boolean);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
