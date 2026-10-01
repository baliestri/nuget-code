import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
  folderSizeCacheKey,
  hydrateCachedPackages,
  persistFolderSizeCache,
  PackageCache,
  packageDetailCacheIdentity,
  migrateLegacyPackageCache,
} from "./package-cache.js";
import type { NuGetPackageItem, PackageManagerState } from "#contracts";
import { CacheStore, memoryCacheStorage } from "./cache-store";
import { createReadFlowStates, createEmptyUpdateProjection } from "#manager";

const vscodeMock = vscode as unknown as {
  __resetVscodeMock(): void;
  workspace: {
    workspaceFolders:
      | Array<{ uri: { fsPath: string; toString: () => string } }>
      | undefined;
  };
};

describe("package cache", () => {
  beforeEach(() => {
    vscodeMock.__resetVscodeMock();
  });

  it("shares search cache for equal resolved URL sets while explicit empty retains inventory only", async () => {
    const cache = new PackageCache(
      new CacheStore(memoryCacheStorage(), 1024 * 1024, Date.now),
    );
    const state = stateWithPackages({
      feeds: [
        { id: "a", name: "A", url: "https://a.test/index.json", enabled: true },
        { id: "b", name: "B", url: "https://b.test/index.json", enabled: true },
      ],
      feedFilter: { mode: "selected", ids: ["b", "a"] },
      installedPackagesStatus: "ready",
      implicitPackagesStatus: "ready",
      availablePackages: [packageItem("search", "Search")],
    });
    await cache.persist(state, { fingerprint: "facts" });
    expect(
      (
        await cache.read({
          ...state,
          feedFilter: { mode: "selected", ids: ["a", "b"] },
        })
      )?.availablePackages,
    ).toHaveLength(1);
    const empty = await cache.read({
      ...state,
      feedFilter: { mode: "selected", ids: [] },
    });
    expect(empty?.availablePackages).toEqual([]);
    expect(empty?.installedPackages).toEqual(state.installedPackages);
  });

  it("hydrates cached packages and optionally preserves selection", () => {
    const cached = packageItem("cached", "Cached");
    const state = stateWithPackages({ selectedPackageId: "current" });

    expect(
      hydrateCachedPackages(state, {
        installedPackages: [cached],
        implicitPackages: [],
        availablePackages: [],
        hasUpgrades: true,
        updatedAt: "now",
      }),
    ).toMatchObject({
      installedPackages: [cached],
      installedPackagesStatus: "ready",
      selectedPackageId: undefined,
      hasUpgrades: true,
    });

    expect(
      hydrateCachedPackages(
        state,
        {
          installedPackages: [cached],
          implicitPackages: [],
          availablePackages: [],
          hasUpgrades: false,
          updatedAt: "now",
        },
        { preserveSelection: true },
      ).selectedPackageId,
    ).toBe("current");

    expect(hydrateCachedPackages(state, undefined)).toBe(state);
  });

  it("partitions inventory/details without persisting search snapshots", async () => {
    vscodeMock.workspace.workspaceFolders = [
      { uri: { fsPath: "c:/a", toString: () => "file:///c:/a" } },
    ];
    const storage = memoryCacheStorage();
    let now = 100;
    const store = new CacheStore(storage, 25 * 1024 * 1024, () => now);
    const cache = new PackageCache(store, () => now);
    const state = stateWithPackages({
      selectedTargetId: "target",
      selectedFeedId: "nuget",
      search: "json",
      includePrerelease: true,
      installedPackages: [packageItem("demo", "Demo")],
      availablePackages: [packageItem("available", "Available")],
      hasUpgrades: true,
      installedPackagesStatus: "ready",
      implicitPackagesStatus: "ready",
    });

    const options = {
      fingerprint: "fingerprint",
      packageDetails: { "nuget:demo:true": packageItem("detail", "Demo") },
    };
    await cache.persist(state, options);

    expect(await cache.read(state)).toMatchObject({
      fingerprint: "fingerprint",
      installedPackages: [{ name: "Demo" }],
      availablePackages: [{ name: "Available" }],
      packageDetails: {
        [packageDetailCacheIdentity("nuget:demo:true")]: { name: "Demo" },
      },
      hasUpgrades: false,
      updatedAt: expect.any(String),
    });
    for (let i = 0; i < 110; i++) {
      now++;
      await cache.persist({ ...state, search: String(i) }, options);
    }
    expect((await storage.list()).length).toBe(3);
    expect((await cache.read(state))?.availablePackages).toEqual([]);
    const restarted = new PackageCache(
      new CacheStore(storage, 25 * 1024 * 1024, () => 100),
      () => 100,
    );
    expect((await restarted.read(state))?.installedPackages[0]?.name).toBe(
      "Demo",
    );
    expect((await restarted.read(state))?.availablePackages).toEqual([]);
    const payloads = await Promise.all(
      (await storage.list()).map((key) => storage.read(key)),
    );
    expect(payloads.join()).not.toContain("Available");
    vscodeMock.workspace.workspaceFolders = [
      { uri: { fsPath: "c:/b", toString: () => "file:///c:/b" } },
    ];
    expect(await restarted.read(state)).toBeUndefined();
  });

  it("expires metadata/search and never overwrites inventory with a loading placeholder", async () => {
    let now = 100;
    const storage = memoryCacheStorage();
    const cache = new PackageCache(
      new CacheStore(storage, 25 * 1024 * 1024, () => now),
      () => now,
    );
    const state = stateWithPackages({
      installedPackagesStatus: "ready",
      implicitPackagesStatus: "ready",
      installedPackages: [packageItem("a", "A")],
    });
    await cache.persist(state, {
      fingerprint: "f",
      packageDetails: { key: packageItem("detail", "Detail") },
    });
    await cache.persist(
      { ...state, installedPackagesStatus: "loading", installedPackages: [] },
      { fingerprint: "new" },
    );
    expect((await cache.read(state))?.fingerprint).toBe("f");
    now += 900_000;
    expect((await cache.read(state))?.packageDetails).toEqual({});
    expect((await cache.read(state))?.installedPackages[0]?.name).toBe("A");
  });

  it("migrates known legacy snapshots only and skips credential-bearing metadata", async () => {
    const key = `nuget-code.packageManager.packageStateCache:${"a".repeat(64)}`;
    const storage = memento({
      [key]: {},
      preference: "keep",
      [folderSizeCacheKey]: {},
    });
    await migrateLegacyPackageCache(storage as never);
    expect(storage.update).toHaveBeenCalledExactlyOnceWith(key, undefined);
    const backend = memoryCacheStorage();
    const cache = new PackageCache(
      new CacheStore(backend, 1024 * 1024, () => 100),
      () => 100,
    );
    await cache.persist(stateWithPackages({}), {
      packageDetails: {
        key: {
          ...packageItem("private", "Private"),
          sourceUrl: "https://user:password@example.test/index.json",
        },
      },
    });
    const payloads = await Promise.all(
      (await backend.list()).map((name) => backend.read(name)),
    );
    expect(payloads.join()).not.toContain("password");
  });

  it("persists folder size cache entries", async () => {
    const storage = memento({
      [folderSizeCacheKey]: { old: { sizeBytes: 1, calculatedAt: "old" } },
    });

    await persistFolderSizeCache(storage as never, [
      {
        id: "global",
        title: "global",
        path: "c:/packages",
        selected: false,
        sizeBytes: 10,
        sizeCalculatedAt: "now",
      },
    ]);

    expect(storage.update).toHaveBeenCalledWith(folderSizeCacheKey, {
      old: { sizeBytes: 1, calculatedAt: "old" },
      global: { sizeBytes: 10, calculatedAt: "now" },
    });
  });

  it("rejects malformed package payloads and changes metadata identity with authentication", async () => {
    const storage = memoryCacheStorage();
    const state = stateWithPackages({
      installedPackagesStatus: "ready",
      implicitPackagesStatus: "ready",
      installedPackages: [packageItem("a", "A")],
    });
    const cache = new PackageCache(
      new CacheStore(storage, 1024 * 1024, () => 100),
      () => 100,
    );
    let revision = "first-user";
    cache.setConfigurationRevision(() => revision);
    await cache.persist(state, {
      fingerprint: "f",
      packageDetails: { key: packageItem("detail", "Detail") },
    });
    expect(
      Object.keys((await cache.read(state))!.packageDetails!),
    ).toHaveLength(1);
    revision = "second-user";
    expect((await cache.read(state))?.packageDetails).toEqual({});
    for (const file of await storage.list()) {
      const record = JSON.parse((await storage.read(file))!);
      if (record.value.installedPackages) {
        record.value.installedPackages[0].installedVersion = [];
        await storage.write(file, JSON.stringify(record));
      }
    }
    const restored = new PackageCache(
      new CacheStore(storage, 1024 * 1024, () => 100),
      () => 100,
    );
    expect(await restored.read(state)).toBeUndefined();
  });
});

function memento(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: vi.fn((key: string, fallback: unknown) =>
      values.has(key) ? values.get(key) : fallback,
    ),
    update: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
    keys: vi.fn(() => Array.from(values.keys())),
  };
}

function packageItem(id: string, name: string): NuGetPackageItem {
  return {
    id,
    name,
    projectPaths: [],
    versions: [],
    dependencyGroups: [],
  };
}

function stateWithPackages(
  state: Partial<PackageManagerState>,
): PackageManagerState {
  return {
    flows: createReadFlowStates(),
    updates: createEmptyUpdateProjection(),
    operations: [],
    installedReferences: [],
    catalogs: [],
    activeTab: "packages",
    targets: [],
    selectedTargetId: "",
    feeds: [],
    selectedFeedId: "",
    includePrerelease: false,
    search: "",
    installedPackages: [],
    installedPackagesStatus: "idle",
    implicitPackages: [],
    implicitPackagesStatus: "idle",
    availablePackages: [],
    sources: [],
    folders: [],
    logs: [],
    hasUpgrades: false,
    ...state,
  };
}
