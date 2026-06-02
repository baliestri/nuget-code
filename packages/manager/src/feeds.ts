import type {
  NuGetPackageItem,
  PackageFeed,
  PackageManagerState,
} from "#contracts";
import { allFeeds } from "#manager/constants";

export function selectInitialFeed(
  feeds: PackageFeed[],
  currentFeedId: string,
  defaultFeedId: string,
): string {
  if (feeds.some((feed) => feed.id === currentFeedId)) {
    return currentFeedId;
  }

  if (feeds.some((feed) => feed.id === defaultFeedId)) {
    return defaultFeedId;
  }

  return allFeeds.id;
}

export function detailFeedId(
  packageItem: NuGetPackageItem | undefined,
  state: PackageManagerState,
): string {
  const feeds = state.feeds.filter((feed) => feed.id !== allFeeds.id);
  const selected =
    state.selectedFeedId !== allFeeds.id
      ? feeds.find((feed) => feed.id === state.selectedFeedId)
      : undefined;
  if (selected && isHttpFeed(selected)) {
    return selected.id;
  }

  const available = packageItem?.availableFeeds
    ?.map((feed) => feeds.find((candidate) => candidate.id === feed.id))
    .find(
      (feed): feed is PackageFeed => feed !== undefined && isHttpFeed(feed),
    );
  return available?.id ?? feeds.find(isHttpFeed)?.id ?? feeds[0]?.id ?? "";
}

export function feedName(feedId: string, state: PackageManagerState): string {
  const feed = state.feeds.find((item) => item.id === feedId);
  return feed ? displayFeedName(feed.name) : "";
}

export function displayFeedName(name: string): string {
  return name === "Microsoft Visual Studio Offline Packages"
    ? "VS Offline"
    : name;
}

export function feedColor(name: string): string {
  if (name === "nuget.org") {
    return "#4da3ff";
  }
  if (name === "VS Offline") {
    return "#c586c0";
  }

  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return `hsl(${hash} 60% 58%)`;
}

export function isHttpFeed(feed: PackageFeed): boolean {
  return feed.url.startsWith("http://") || feed.url.startsWith("https://");
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
