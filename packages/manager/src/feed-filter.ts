import type {
  PackageFeed,
  PackageFeedFilter,
  PackageManagerState,
} from "#contracts";
import { normalizeCatalogFeedUrl } from "#manager/package-catalog";

export function normalizeFeedFilter(
  filter: PackageFeedFilter | undefined,
  feeds: readonly PackageFeed[],
  legacy = "__all__",
): PackageFeedFilter {
  if (
    !filter ||
    (filter.mode !== "all" &&
      (filter.mode !== "selected" || !Array.isArray(filter.ids)))
  )
    filter =
      legacy && legacy !== "__all__"
        ? { mode: "selected", ids: [legacy] }
        : { mode: "all" };
  if (filter.mode === "all") return { mode: "all" };
  const enabled = new Set(
    feeds
      .filter((feed) => feed.enabled && feed.id !== "__all__")
      .map((feed) => feed.id),
  );
  return {
    mode: "selected",
    ids: [...new Set(filter.ids.filter((id) => enabled.has(id)))].sort(),
  };
}
export function queryFeeds(
  state: Pick<PackageManagerState, "feeds" | "feedFilter" | "selectedFeedId">,
): PackageFeed[] {
  const filter = normalizeFeedFilter(
    state.feedFilter,
    state.feeds,
    state.selectedFeedId,
  );
  return state.feeds.filter(
    (feed) =>
      feed.enabled &&
      feed.id !== "__all__" &&
      (filter.mode === "all" || filter.ids.includes(feed.id)),
  );
}
export function queryFeedUrls(
  state: Pick<PackageManagerState, "feeds" | "feedFilter" | "selectedFeedId">,
): string[] {
  return [
    ...new Set(
      queryFeeds(state).map(
        (feed) => normalizeCatalogFeedUrl(feed.url) ?? feed.url,
      ),
    ),
  ].sort();
}
