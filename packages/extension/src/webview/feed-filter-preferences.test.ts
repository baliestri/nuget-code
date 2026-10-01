import { expect, it } from "vitest";
import type { PackageManagerState } from "#contracts";
import { createEmptyPackageManagerState } from "#manager";
import { PackageManagerController } from "./controller";

it("restores per-target preferences, migrates legacy input, and permanently reconciles removed sources", () => {
  const values = new Map<string, unknown>();
  const host = Object.create(PackageManagerController.prototype) as {
    state: PackageManagerState;
    settings: { defaultFeed: string };
    feedFilterTargetId: string;
    storage: {
      get(key: string): unknown;
      update(key: string, value: unknown): Promise<void>;
    };
    restoreFeedFilter(): void;
  };
  host.settings = { defaultFeed: "__all__" };
  host.feedFilterTargetId = "";
  host.storage = {
    get: (key) => values.get(key),
    update: async (key, value) => {
      values.set(key, value);
    },
  };
  const feeds = [
    { id: "a", name: "A", url: "https://a.test", enabled: true },
    { id: "b", name: "B", url: "https://b.test", enabled: true },
  ];
  host.state = {
    ...createEmptyPackageManagerState(),
    selectedTargetId: "one",
    selectedFeedId: "a",
    feeds,
  };
  host.restoreFeedFilter();
  expect(host.state.feedFilter).toEqual({ mode: "selected", ids: ["a"] });
  host.state = { ...host.state, selectedTargetId: "two" };
  host.restoreFeedFilter();
  expect(host.state.feedFilter).toEqual({ mode: "all" });
  values.set("nuget-code.packageManager.feedFilter:two", {
    mode: "selected",
    ids: [],
  });
  host.restoreFeedFilter();
  expect(host.state.feedFilter).toEqual({ mode: "selected", ids: [] });
  host.state = {
    ...host.state,
    selectedTargetId: "one",
    feeds: feeds.map((feed) => ({ ...feed, enabled: false })),
  };
  host.restoreFeedFilter();
  expect(host.state.feedFilter).toEqual({ mode: "selected", ids: [] });
  host.state = { ...host.state, feeds };
  host.restoreFeedFilter();
  expect(host.state.feedFilter).toEqual({ mode: "selected", ids: [] });
});
