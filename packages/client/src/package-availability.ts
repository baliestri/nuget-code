import fs from "node:fs/promises";
import type { NuGetClientLogger, NuGetClientSettings } from "#client/types";
import {
  loadPackageDetailsFromFeedCached,
  toFeedSummary,
  type PackageDetailsCache,
} from "#client/package-details";
import { isHttpUrl, mergePackageDetails } from "#manager";
import type {
  NuGetPackageItem,
  PackageFeed,
  PackageFeedSummary,
} from "#contracts/nuget";

interface PackageAvailability {
  feeds: PackageFeedSummary[];
  details: NuGetPackageItem[];
}

interface PackageAvailabilityLookupResult {
  feed: PackageFeedSummary;
  details?: NuGetPackageItem;
}

export async function enrichPackageAvailability(options: {
  packages: NuGetPackageItem[];
  feeds: PackageFeed[];
  includePrerelease: boolean;
  cache?: PackageDetailsCache | undefined;
  settings: NuGetClientSettings;
  logger: NuGetClientLogger;
  signal?: AbortSignal | undefined;
}): Promise<NuGetPackageItem[]> {
  const enabledFeeds = options.feeds.filter((feed) => feed.enabled);

  return Promise.all(
    options.packages.map(async (packageItem) => {
      const availability = await findPackageAvailability(
        packageItem.name,
        enabledFeeds,
        {
          includePrerelease: options.includePrerelease,
          cache: options.cache,
          settings: options.settings,
          logger: options.logger,
          signal: options.signal,
        },
      );
      return applyAvailabilityDetails(
        {
          ...packageItem,
          availableFeeds: availability.feeds,
        },
        availability.details,
      );
    }),
  );
}

async function findPackageAvailability(
  packageName: string,
  feeds: PackageFeed[],
  options: {
    includePrerelease: boolean;
    cache?: PackageDetailsCache | undefined;
    settings: NuGetClientSettings;
    logger: NuGetClientLogger;
    signal?: AbortSignal | undefined;
  },
): Promise<PackageAvailability> {
  const results: Array<PackageAvailabilityLookupResult | undefined> =
    await Promise.all(
      feeds.map(async (feed) => {
        if (isHttpUrl(feed.url)) {
          const details = await loadPackageDetailsFromFeedCached(
            packageName,
            feed,
            options,
          );
          return details ? { feed: toFeedSummary(feed), details } : undefined;
        }

        const available = await localPackageExists(
          packageName,
          feed,
          options.logger,
        );
        return available ? { feed: toFeedSummary(feed) } : undefined;
      }),
    );
  const available = results.filter(
    (result): result is PackageAvailabilityLookupResult => result !== undefined,
  );

  return {
    feeds: available.map((result) => result.feed),
    details: available
      .map((result) => result.details)
      .filter((details): details is NuGetPackageItem => details !== undefined),
  };
}

function applyAvailabilityDetails(
  packageItem: NuGetPackageItem,
  details: NuGetPackageItem[],
): NuGetPackageItem {
  return details.reduce(
    (current, detail) => mergePackageDetails(current, detail),
    packageItem,
  );
}

async function localPackageExists(
  packageName: string,
  feed: PackageFeed,
  logger: NuGetClientLogger,
): Promise<boolean> {
  try {
    const entries = await fs.readdir(feed.url);
    const prefix = `${packageName.toLowerCase()}.`;
    return entries.some((entry) => {
      const lower = entry.toLowerCase();
      return lower.startsWith(prefix) && lower.endsWith(".nupkg");
    });
  } catch (error) {
    logger.verbose(
      "nuget.packages",
      `Could not scan local source ${feed.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
