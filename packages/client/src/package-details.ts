import { getServiceResource, getFeedJson } from "#client/feed-http";
import {
  readRegistrationEntries,
  listPackageVersions,
} from "#client/package-registration";
import { networkFor } from "#client/client-network";
import { cachePolicy } from "#client/cache";
import {
  sameNuGetVersion,
  packageMetadataUrl,
  compareNuGetVersions,
  parseNuGetVersion,
} from "#manager";
import type { NuGetClientLogger, NuGetClientSettings } from "#client/types";
import type {
  RegistrationDependencyGroup,
  RegistrationIndex,
} from "#client/package-types";
import {
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

export interface PackageDetailsCache {
  get(key: string): NuGetPackageItem | undefined;
  set(key: string, value: NuGetPackageItem): void | Promise<void>;
}

export async function loadPackageDetails(options: {
  force?: boolean;
  generation?: number;
  version?: string;
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
    ...(options.force !== undefined ? { force: options.force } : {}),
    ...(options.generation !== undefined
      ? { generation: options.generation }
      : {}),
    ...(options.version !== undefined ? { version: options.version } : {}),
  });
}

export function loadPackageDetailsFromFeedCached(
  packageName: string,
  feed: PackageFeed,
  options: {
    force?: boolean;
    generation?: number;
    version?: string;
    includePrerelease?: boolean | undefined;
    cache?: PackageDetailsCache | undefined;
    settings: NuGetClientSettings;
    logger: NuGetClientLogger;
    signal?: AbortSignal | undefined;
  },
): Promise<NuGetPackageItem | undefined> {
  return loadPackageDetailsFromFeed(packageName, feed, options);
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

export async function loadPackageDetailsFromFeed(
  packageName: string,
  feed: PackageFeed,
  options: {
    force?: boolean;
    generation?: number;
    version?: string;
    includePrerelease?: boolean | undefined;
    settings: NuGetClientSettings;
    logger: NuGetClientLogger;
    signal?: AbortSignal | undefined;
  },
): Promise<NuGetPackageItem | undefined> {
  const network = networkFor(options.settings);
  const generation =
    options.generation ??
    (options.force ? network.refresh() : network.facts.generation);
  return network.facts.read(
    network.key([
      "details",
      feed.url,
      packageName.toLowerCase(),
      options.version ?? "latest",
      options.includePrerelease !== false,
      network.context(options.settings),
    ]),
    cachePolicy.metadataTtlMs,
    generation,
    (signal) =>
      loadDetailsUncached(packageName, feed, {
        ...options,
        signal,
        generation,
      }),
    options.signal,
  );
}

async function loadDetailsUncached(
  packageName: string,
  feed: PackageFeed,
  options: {
    includePrerelease?: boolean | undefined;
    version?: string;
    generation: number;
    settings: NuGetClientSettings;
    logger: NuGetClientLogger;
    signal: AbortSignal;
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
    if (
      !/^[\p{L}\p{Mn}\p{Nd}\p{Pc}]+(?:[.-][\p{L}\p{Mn}\p{Nd}\p{Pc}]+)*(?![\s\S])/u.test(
        packageName,
      )
    )
      throw new Error("Invalid package identity.");
    const versionNames = options.version
      ? await listPackageVersions(packageName, feed, options)
      : undefined;
    const registrationResource = await getServiceResource(
      feed,
      "registrationsbaseurl",
      options.settings,
      options.logger,
      options.signal,
      { generation: options.generation },
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
      generation: options.generation,
    });
    const pages =
      options.version && versionNames
        ? registration.items?.filter(
            (page) =>
              page.lower &&
              page.upper &&
              parseNuGetVersion(page.lower) &&
              parseNuGetVersion(page.upper) &&
              compareNuGetVersions(page.lower, options.version!) <= 0 &&
              compareNuGetVersions(options.version!, page.upper) <= 0,
          )
        : undefined;
    const registrationEntries = await readRegistrationEntries(
      pages?.length === 1 ? { items: pages, count: 1 } : registration,
      feed,
      options,
    );
    if (!registrationEntries.complete)
      throw new Error("Incomplete package registration metadata.");
    const entries = registrationEntries.entries.filter(
      (entry) =>
        options.includePrerelease !== false ||
        !isPrereleaseVersion(entry.catalogEntry.version),
    );
    if (entries.length === 0 && !options.version) {
      return undefined;
    }

    const latest = options.version
      ? registrationEntries.entries.find((entry) =>
          sameNuGetVersion(entry.catalogEntry.version, options.version!),
        )
      : entries[entries.length - 1];
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
      iconUrl: packageMetadataUrl(latestEntry.iconUrl),
      projectUrl: packageMetadataUrl(latestEntry.projectUrl),
      licenseUrl: packageMetadataUrl(latestEntry.licenseUrl),
      licenseExpression: latestEntry.licenseExpression,
      packageUrl: packageMetadataUrl(latestEntry.packageDetailsUrl),
      totalDownloads:
        typeof latestEntry.totalDownloads === "number" &&
        Number.isFinite(latestEntry.totalDownloads) &&
        latestEntry.totalDownloads >= 0
          ? latestEntry.totalDownloads
          : undefined,
      frameworks: [
        ...new Set(
          (latestEntry.dependencyGroups ?? [])
            .map((group) => group.targetFramework)
            .filter((value): value is string => !!value),
        ),
      ],
      description: latestEntry.description,
      authors: Array.isArray(latestEntry.authors)
        ? latestEntry.authors.join(", ")
        : latestEntry.authors,
      tags: Array.isArray(latestEntry.tags)
        ? latestEntry.tags
        : splitTags(latestEntry.tags),
      published: latestEntry.published,
      projectPaths: [],
      versions: versionNames
        ? versionNames
            .filter(
              (version) =>
                options.includePrerelease !== false ||
                !isPrereleaseVersion(version),
            )
            .map((version) => ({ version, source: feed.name }))
        : entries.map((entry) => ({
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
