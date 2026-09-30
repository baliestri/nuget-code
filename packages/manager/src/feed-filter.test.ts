import { expect, it } from "vitest";
import { normalizeFeedFilter, queryFeeds, queryFeedUrls } from "./feed-filter";
const feeds = [
  { id: "__all__", name: "All", url: "", enabled: true },
  { id: "a", name: "A", url: "https://a.test/index.json", enabled: true },
  { id: "b", name: "B", url: "https://b.test/index.json", enabled: true },
  { id: "off", name: "Off", url: "https://off.test", enabled: false },
];
it("resolves all, partial, single and explicit empty without modifying feeds", () => {
  const state = {
    feeds,
    selectedFeedId: "a",
    feedFilter: { mode: "all" as const },
  };
  expect(queryFeeds(state).map((feed) => feed.id)).toEqual(["a", "b"]);
  for (const ids of [["a", "b"], ["a"], []])
    expect(
      queryFeeds({ ...state, feedFilter: { mode: "selected", ids } }).map(
        (feed) => feed.id,
      ),
    ).toEqual(ids);
  expect(
    normalizeFeedFilter(
      { mode: "selected", ids: ["a", "a", "off", "missing"] },
      feeds,
    ),
  ).toEqual({ mode: "selected", ids: ["a"] });
  expect(feeds[3]?.enabled).toBe(false);
});
it("migrates legacy values and all follows newly enabled feeds", () => {
  expect(normalizeFeedFilter(undefined, feeds, "__all__")).toEqual({
    mode: "all",
  });
  expect(normalizeFeedFilter(undefined, feeds, "b")).toEqual({
    mode: "selected",
    ids: ["b"],
  });
  expect(normalizeFeedFilter(undefined, feeds, "removed")).toEqual({
    mode: "selected",
    ids: [],
  });
  expect(
    queryFeedUrls({
      feeds: [...feeds, { ...feeds[1]!, id: "alias" }],
      selectedFeedId: "__all__",
    }),
  ).toEqual([feeds[1]!.url, feeds[2]!.url]);
});
