import { expect, it, vi } from "vitest";
import { createEmptyPackageManagerState } from "#manager";
import { loadPackageDetailsFromFeed } from "#client/package-details";
import { PackageDetailsService } from "./package-details-service";
import type { NuGetPackageItem } from "#contracts";
vi.mock("#client/package-details", async (original) => ({
  ...(await original<typeof import("#client/package-details")>()),
  loadPackageDetailsFromFeed: vi.fn(),
}));

it("drops delayed details after a target change and never writes installed facts or candidate versions", async () => {
  const item: NuGetPackageItem = {
    id: "demo",
    name: "Demo",
    installedVersion: "1.0.0",
    projectPaths: ["/a.csproj"],
    versions: [],
    dependencyGroups: [],
  };
  let state = {
    ...createEmptyPackageManagerState(),
    selectedTargetId: "a",
    selectedPackageId: "demo",
    installedPackages: [item],
    feeds: [
      { id: "feed", name: "Feed", url: "https://feed.test", enabled: true },
    ],
  };
  const settings = {};
  let resolve!: (value: NuGetPackageItem) => void;
  vi.mocked(loadPackageDetailsFromFeed).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const publish = vi.fn();
  const service = new PackageDetailsService({
    getState: () => state,
    setState: (next) => {
      state = next as typeof state;
    },
    getSettings: () => settings as never,
    getCache: () => ({ get: () => undefined, set: () => {} }),
    logger: {} as never,
    publish,
    persistPackageCache: async () => {},
  });
  const pending = service.loadPackageDetails("demo", "feed");
  state = { ...state, selectedTargetId: "b" };
  resolve({
    ...item,
    installedVersion: "9.0.0",
    availableVersion: "10.0.0",
    description: "late",
  });
  await pending;
  expect(state.packageDetails).toBeNull();
  expect(
    JSON.parse(JSON.stringify(publish.mock.calls.at(-1)![0])).patch
      .packageDetails,
  ).toBeNull();
  expect(state.flows.details.status).toBe("idle");
  expect(state.installedPackages).toEqual([item]);
  vi.mocked(loadPackageDetailsFromFeed).mockResolvedValueOnce({
    ...item,
    installedVersion: "9.0.0",
    availableVersion: "10.0.0",
    description: "metadata",
  });
  await service.loadPackageDetails("demo", "feed");
  expect(state.packageDetails?.packageItem.description).toBe("metadata");
  expect(state.installedPackages).toEqual([item]);
  expect(state.hasUpgrades).toBe(false);
  service.dispose();
});
