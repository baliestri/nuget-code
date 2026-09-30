import { expect, it } from "vitest";
import { detailFeedId } from "./feeds";
import { createEmptyPackageManagerState } from "./state";
import type { NuGetPackageItem } from "#contracts";

it("selects a known package source under All feeds, ignoring disabled sources", () => {
  const state = createEmptyPackageManagerState();
  state.selectedFeedId = "__all__";
  state.feeds = [
    { id: "offline", name: "VS Offline", url: "c:/offline", enabled: true },
    { id: "unrelated", name: "Other", url: "https://other", enabled: true },
    { id: "nuget", name: "NuGet", url: "https://nuget", enabled: true },
  ];
  const item: NuGetPackageItem = {
    id: "demo",
    name: "Demo",
    projectPaths: [],
    versions: [],
    dependencyGroups: [],
    sourceUrl: "https://nuget",
  };
  expect(detailFeedId(item, state)).toBe("nuget");
  item.sourceUrl = "c:/offline";
  item.availableFeeds = [
    {
      id: "nuget",
      name: "NuGet",
      displayName: "NuGet",
      url: "https://nuget",
      color: "#000",
    },
  ];
  expect(detailFeedId(item, state)).toBe("nuget");
  state.feeds[2]!.enabled = false;
  expect(detailFeedId(item, state)).toBe("offline");
  state.selectedFeedId = "unrelated";
  expect(detailFeedId(item, state)).toBe("unrelated");
});
