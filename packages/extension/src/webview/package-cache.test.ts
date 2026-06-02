import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
  folderSizeCacheKey,
  hydrateCachedPackages,
  persistFolderSizeCache,
  persistPackageCache,
  readPackageCacheEntry,
} from "./package-cache.js";
import type { NuGetPackageItem, PackageManagerState } from "#contracts";

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

  it("persists and reads cache entries scoped by workspace and query state", async () => {
    vscodeMock.workspace.workspaceFolders = [
      { uri: { fsPath: "c:/a", toString: () => "file:///c:/a" } },
    ];
    const storage = memento();
    const state = stateWithPackages({
      selectedTargetId: "target",
      selectedFeedId: "nuget",
      search: "json",
      includePrerelease: true,
      installedPackages: [packageItem("demo", "Demo")],
      availablePackages: [packageItem("available", "Available")],
      hasUpgrades: true,
    });

    await persistPackageCache(storage as never, state, {
      fingerprint: "fingerprint",
      packageDetails: { "nuget:demo:true": packageItem("detail", "Demo") },
    });

    expect(readPackageCacheEntry(storage as never, state)).toMatchObject({
      fingerprint: "fingerprint",
      installedPackages: [{ name: "Demo" }],
      availablePackages: [{ name: "Available" }],
      packageDetails: {
        "nuget:demo:true": { name: "Demo" },
      },
      hasUpgrades: true,
      updatedAt: expect.any(String),
    });
    expect(storage.update).toHaveBeenCalledWith(
      expect.stringContaining("packageStateCache:"),
      expect.objectContaining({ entries: expect.any(Object) }),
    );
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
