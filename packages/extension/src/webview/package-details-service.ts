import { NuGetClient } from "#client";
import type { PackageDetailsCache } from "#client/package-details";
import type {
  ExtensionToWebviewMessage,
  NuGetPackageItem,
  PackageFeed,
  PackageManagerState,
} from "#contracts";
import {
  allFeeds,
  isHttpFeed,
  mergePackageDetailsFromFeed,
  replacePackage,
} from "#manager";
import type { ExtensionLogger } from "#extension/logger";
import type { ExtensionSettings } from "#extension/settings";

interface PackageDetailsServiceOptions {
  getState: () => PackageManagerState;
  setState: (state: PackageManagerState) => void;
  getSettings: () => ExtensionSettings;
  getCache: () => PackageDetailsCache;
  logger: ExtensionLogger;
  publish: (message: ExtensionToWebviewMessage) => void;
  persistPackageCache: () => Promise<void>;
}

export class PackageDetailsService {
  private requestId = 0;

  constructor(private readonly options: PackageDetailsServiceOptions) {}

  async loadPackageDetails(packageId: string, feedId: string): Promise<void> {
    const requestId = ++this.requestId;
    const state = this.options.getState();
    const packageItem = findPackage(state, packageId);
    const feed = this.findDetailsFeed(packageItem, feedId);
    if (!packageItem || !feed) {
      this.options.publish({
        type: "packageDetailsChanged",
        requestId,
        packageId,
        feedId,
      });
      return;
    }

    const detailsResult = await this.loadPackageDetailsFromFeeds(
      packageItem,
      feed,
    );

    if (requestId !== this.requestId) {
      return;
    }

    if (!detailsResult) {
      this.options.logger.warning(
        "nuget.packages",
        `Could not load details for ${packageItem.name} from any enabled feed`,
      );
    }

    const merged = detailsResult
      ? mergePackageDetailsFromFeed(
          packageItem,
          detailsResult.details,
          detailsResult.feed,
        )
      : packageItem;
    const current = this.options.getState();
    this.options.setState({
      ...current,
      installedPackages: replacePackage(current.installedPackages, merged),
      implicitPackages: replacePackage(current.implicitPackages, merged),
      availablePackages: replacePackage(current.availablePackages, merged),
    });
    this.options.publish({
      type: "packageDetailsChanged",
      requestId,
      packageId,
      feedId: detailsResult?.feed.id ?? feed.id,
      packageItem: merged,
    });
    await this.options.persistPackageCache();
  }

  private async loadPackageDetailsFromFeeds(
    packageItem: NuGetPackageItem,
    selectedFeed: PackageFeed,
  ): Promise<{ details: NuGetPackageItem; feed: PackageFeed } | undefined> {
    for (const feed of this.detailsFeedFallbacks(packageItem, selectedFeed)) {
      const details = await NuGetClient.loadPackageDetails({
        packageId: packageItem.name,
        feed,
        includePrerelease: this.options.getState().includePrerelease,
        cache: this.options.getCache(),
        settings: this.options.getSettings(),
        logger: this.options.logger,
      });
      if (details) {
        return { details, feed };
      }
    }
    return undefined;
  }

  private findDetailsFeed(
    packageItem: NuGetPackageItem | undefined,
    feedId: string,
  ): PackageFeed | undefined {
    const feeds = this.options
      .getState()
      .feeds.filter((feed) => feed.id !== allFeeds.id);
    const selected = feeds.find((feed) => feed.id === feedId);
    if (selected) {
      return selected;
    }

    const firstAvailableFeed = packageItem?.availableFeeds
      ?.map((availableFeed) =>
        feeds.find((feed) => feed.id === availableFeed.id),
      )
      .find((feed): feed is PackageFeed => feed !== undefined);
    return (
      firstAvailableFeed ?? feeds.find((feed) => feed.url.startsWith("http"))
    );
  }

  private detailsFeedFallbacks(
    packageItem: NuGetPackageItem,
    selectedFeed: PackageFeed,
  ): PackageFeed[] {
    const feeds = this.options
      .getState()
      .feeds.filter(
        (feed) => feed.id !== allFeeds.id && feed.enabled && isHttpFeed(feed),
      );
    const ordered = [
      selectedFeed,
      ...(packageItem.availableFeeds
        ?.map((availableFeed) =>
          feeds.find((feed) => feed.id === availableFeed.id),
        )
        .filter((feed): feed is PackageFeed => feed !== undefined) ?? []),
      ...feeds,
    ];
    const seen = new Set<string>();
    return ordered.filter((feed) => {
      if (seen.has(feed.id)) {
        return false;
      }
      seen.add(feed.id);
      return true;
    });
  }
}

function findPackage(
  state: PackageManagerState,
  packageId: string,
): NuGetPackageItem | undefined {
  return [
    ...state.installedPackages,
    ...state.implicitPackages,
    ...state.availablePackages,
  ].find((item) => item.id === packageId);
}
