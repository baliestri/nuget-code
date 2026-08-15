import { describe, expect, it } from "vitest";
import {
  allFeeds,
  applyAvailablePackageMetadata,
  applyAvailablePackages,
  applyCachedFolderSizes,
  applyPackageDetails,
  applyPackageInventory,
  comparePackageVersions,
  createEmptyPackageManagerState,
  createFolderSizeCache,
  createInitialPackageManagerState,
  defaultPackageVersion,
  defaultSelectedProjectPaths,
  detailFeedId,
  displayFeedName,
  feedColor,
  feedName,
  filterPackagesForTarget,
  filterTargetsForActiveSolution,
  globalProjectActions,
  isHttpFeed,
  isHttpUrl,
  isPrereleaseVersion,
  latestPackageVersion,
  mergeAvailableFeeds,
  mergeInstalled,
  mergePackageDetails,
  mergePackageDetailsFromFeed,
  mergePackageResults,
  mergeProjectStates,
  mergeVersions,
  normalizeProjectPath,
  PackageManagementCore,
  packageChangeAction,
  packageProjectState,
  packageVersions,
  prependVersion,
  projectName,
  projectSelectionKey,
  projectStates,
  projectVersionAction,
  replacePackage,
  samePackageVersion,
  sameProjectPath,
  selectInitialFeed,
  selectedPackage,
  selectedSource,
  selectedTarget,
  targetIcon,
  toggleSingleFolderSelection,
  updatePackageProjectState,
  updatePackageProjectStates,
  upgradablePackageVersion,
} from "#manager";
import type {
  NuGetCacheFolder,
  NuGetConfigFile,
  NuGetPackageItem,
  PackageFeed,
  PackageManagerState,
  WorkspaceTarget,
} from "#contracts";

describe("package manager state helpers", () => {
  it("creates initial and empty states", () => {
    expect(
      createInitialPackageManagerState(
        { defaultFeed: "nuget", includePrerelease: true },
        [
          {
            id: 1,
            timestamp: "t",
            level: "information",
            context: "vscode",
            message: "m",
            formatted: "m",
          },
        ],
      ),
    ).toMatchObject({
      activeTab: "packages",
      feeds: [allFeeds],
      selectedFeedId: "nuget",
      includePrerelease: true,
      logs: [{ message: "m" }],
    });

    expect(createEmptyPackageManagerState()).toMatchObject({
      selectedFeedId: "",
      feeds: [],
      installedPackagesStatus: "idle",
      implicitPackagesStatus: "idle",
    });
    expect(
      PackageManagementCore.state.createInitialPackageManagerState(
        { defaultFeed: "nuget", includePrerelease: false },
        [],
      ).selectedFeedId,
    ).toBe("nuget");
  });

  it("selects feeds, targets, sources, and package overlays", () => {
    const state = stateWithPackages({
      targets: [target("solution", "src/App.sln", ["src/App.csproj"])],
      selectedTargetId: "solution",
      feeds: [allFeeds, httpFeed("nuget"), fileFeed("offline")],
      selectedFeedId: "missing",
      sources: [config("source")],
      selectedSourceId: "source",
      installedPackages: [
        packageItem("installed:demo", "Demo", "1.0.0", undefined, {
          availableFeeds: [
            {
              id: "offline",
              name: "Offline",
              displayName: "Offline",
              url: "c:/offline",
              color: "#fff",
            },
          ],
        }),
      ],
      availablePackages: [
        packageItem("nuget:demo", "Demo", undefined, "2.0.0", {
          availableFeeds: [
            {
              id: "nuget",
              name: "nuget.org",
              displayName: "nuget.org",
              url: "https://nuget",
              color: "#4da3ff",
            },
          ],
        }),
      ],
      selectedPackageId: "nuget:demo",
    });

    expect(selectInitialFeed(state.feeds, "missing", "nuget")).toBe("nuget");
    expect(selectInitialFeed(state.feeds, "offline", "nuget")).toBe("offline");
    expect(selectInitialFeed([allFeeds], "missing", "missing")).toBe("__all__");
    expect(selectedTarget(state)?.name).toBe("App");
    expect(selectedSource(state)?.id).toBe("source");
    expect(selectedPackage(state)?.installedVersion).toBe("1.0.0");
    expect(
      selectedPackage(state)?.availableFeeds?.map((feed) => feed.id),
    ).toEqual(["nuget", "offline"]);
    expect(selectedPackage(state, "missing")).toBeUndefined();
  });

  it("normalizes project paths and filters packages for a selected target", () => {
    const packageItemA = packageItem("a", "A", "1.0.0", undefined, {
      projectPaths: ["src/App/App.csproj"],
    });
    const packageItemB = packageItem("b", "B", "1.0.0", undefined, {
      projectStates: [
        {
          projectPath: "tests/App.Tests.csproj",
          installedVersion: "1.0.0",
          implicit: false,
        },
      ],
    });
    const selected = target("app", "src/App.sln", ["App/App.csproj"]);

    expect(targetIcon(selected)).toBe("sln");
    expect(targetIcon(target("slnx", "src/App.slnx", []))).toBe("sln");
    expect(targetIcon(target("unknown", "README.md", []))).toBeUndefined();
    expect(projectName("src\\App.Tests.csproj")).toBe("App.Tests");
    expect(normalizeProjectPath(".\\Src\\App.csproj")).toBe("src/app.csproj");
    expect(sameProjectPath("src/App/App.csproj", "App/App.csproj")).toBe(true);
    expect(
      filterPackagesForTarget([packageItemA, packageItemB], selected),
    ).toEqual([packageItemA]);
    expect(filterPackagesForTarget([packageItemA], undefined)).toEqual([
      packageItemA,
    ]);
  });

  it("filters targets down to the active solution and its own projects", () => {
    const singleSolution = target("solution:a", "src/A.sln", [
      "src/A/A.csproj",
    ]);
    const singleProject = target("project:a", "src/A/A.csproj", [
      "src/A/A.csproj",
    ]);
    expect(
      filterTargetsForActiveSolution(
        [singleSolution, singleProject],
        singleSolution.id,
      ),
    ).toEqual([singleSolution, singleProject]);

    const solutionA = target("solution:a", "src/A.sln", [
      "src/A/A.csproj",
      "src/Shared/Shared.csproj",
    ]);
    const solutionB = target("solution:b", "src/B.sln", ["src/B/B.csproj"]);
    const projectA = target("project:a", "src/A/A.csproj", ["src/A/A.csproj"]);
    const projectShared = target("project:shared", "src/Shared/Shared.csproj", [
      "src/Shared/Shared.csproj",
    ]);
    const projectB = target("project:b", "src/B/B.csproj", ["src/B/B.csproj"]);
    const allTargets = [
      solutionA,
      solutionB,
      projectA,
      projectShared,
      projectB,
    ];

    expect(filterTargetsForActiveSolution(allTargets, solutionA.id)).toEqual([
      solutionA,
      projectA,
      projectShared,
    ]);
    expect(filterTargetsForActiveSolution(allTargets, projectA.id)).toEqual([
      solutionA,
      projectA,
      projectShared,
    ]);
    expect(filterTargetsForActiveSolution(allTargets, "")).toEqual(allTargets);
  });

  it("computes project selection and project state fallbacks", () => {
    const item = packageItem("demo", "Demo", "1.0.0", undefined, {
      projectPaths: ["src/App.csproj", "src/Api.csproj"],
      projectStates: [
        {
          projectPath: "src/App.csproj",
          installedVersion: "1.0.0",
          implicit: false,
        },
        {
          projectPath: "src/Api.csproj",
          installedVersion: "1.0.0",
          implicit: true,
        },
      ],
    });

    expect(
      defaultSelectedProjectPaths(
        item,
        target("app", "App.sln", ["src/App.csproj", "src/Api.csproj"]),
      ),
    ).toEqual(["src/App.csproj"]);
    expect(projectSelectionKey(item, target("app", "App.sln", []))).toBe(
      "demo:app",
    );
    expect(
      projectStates(packageItem("fallback", "Fallback", "1.0.0")).at(0),
    ).toMatchObject({
      projectPath: "src/App.csproj",
      implicit: false,
    });
    expect(packageProjectState(item, "src/Api.csproj")).toBeUndefined();
  });
});

describe("feed and version helpers", () => {
  it("chooses the package detail feed from selected and available feeds", () => {
    const state = stateWithPackages({
      feeds: [
        allFeeds,
        fileFeed("offline"),
        httpFeed("nuget"),
        httpFeed("private"),
      ],
      selectedFeedId: "private",
    });

    expect(detailFeedId(undefined, state)).toBe("private");
    expect(
      detailFeedId(undefined, { ...state, selectedFeedId: "__all__" }),
    ).toBe("nuget");
    expect(
      detailFeedId(
        packageItem("demo", "Demo", undefined, "2.0.0", {
          availableFeeds: [
            {
              id: "private",
              name: "private",
              displayName: "private",
              url: "https://private",
              color: "#000",
            },
          ],
        }),
        { ...state, selectedFeedId: "offline" },
      ),
    ).toBe("private");
    expect(feedName("private", state)).toBe("private");
    expect(feedName("missing", state)).toBe("");
  });

  it("formats feed display and URL checks", () => {
    expect(displayFeedName("Microsoft Visual Studio Offline Packages")).toBe(
      "VS Offline",
    );
    expect(feedColor("nuget.org")).toBe("#4da3ff");
    expect(feedColor("VS Offline")).toBe("#c586c0");
    expect(feedColor("custom")).toMatch(/^hsl\(/);
    expect(isHttpFeed(httpFeed("nuget"))).toBe(true);
    expect(isHttpFeed(fileFeed("local"))).toBe(false);
    expect(isHttpUrl("https://example.test")).toBe(true);
    expect(isHttpUrl("file:///tmp")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });

  it("sorts, merges, and selects package versions", () => {
    expect(["1.0.10", "1.0.2"].sort(comparePackageVersions)).toEqual([
      "1.0.2",
      "1.0.10",
    ]);
    expect(samePackageVersion("1.0.0", "1.0.0")).toBe(true);
    expect(isPrereleaseVersion("1.0.0-beta.1")).toBe(true);
    expect(isPrereleaseVersion("1.0.0")).toBe(false);
    expect(
      mergeVersions(
        [{ version: "2.0.0", source: "A" }],
        [{ version: "1.0.0", source: "B" }],
      ),
    ).toEqual([
      { version: "1.0.0", source: "B" },
      { version: "2.0.0", source: "A" },
    ]);
    expect(
      prependVersion([{ version: "1.0.0", source: "A" }], {
        version: "1.0.0",
        source: "B",
      }),
    ).toEqual([{ version: "1.0.0", source: "A" }]);

    const item = packageItem("demo", "Demo", "1.0.0", "2.0.0", {
      versions: [{ version: "1.5.0", source: "nuget" }],
    });
    expect(packageVersions(item)).toEqual(["1.0.0", "1.5.0", "2.0.0"]);
    expect(latestPackageVersion(item)).toBe("2.0.0");
    expect(defaultPackageVersion(item)).toBe("1.0.0");
    expect(
      defaultPackageVersion(packageItem("new", "New", undefined, "2.0.0")),
    ).toBe("2.0.0");
    expect(upgradablePackageVersion(item)).toBe("2.0.0");
    expect(
      upgradablePackageVersion(packageItem("same", "Same", "1.0.0", "1.0.0")),
    ).toBeUndefined();
  });
});

describe("package merge and metadata helpers", () => {
  it("merges feeds, installed packages, search results, and project states", () => {
    expect(
      mergeAvailableFeeds(
        [{ id: "a", name: "A", displayName: "A", url: "a", color: "#aaa" }],
        [
          { id: "a", name: "A", displayName: "A", url: "a", color: "#aaa" },
          { id: "b", name: "B", displayName: "B", url: "b", color: "#bbb" },
        ],
      )?.map((feed) => feed.id),
    ).toEqual(["a", "b"]);
    expect(mergeAvailableFeeds(undefined, undefined)).toBeUndefined();
    expect(
      mergeProjectStates(
        [{ projectPath: "a", implicit: false }],
        [
          { projectPath: "a", implicit: false },
          { projectPath: "a", implicit: true },
        ],
      ),
    ).toEqual([
      { projectPath: "a", implicit: false },
      { projectPath: "a", implicit: true },
    ]);

    const installed = mergeInstalled([
      packageItem("one", "Demo", "1.0.0", undefined, {
        projectPaths: ["a.csproj"],
      }),
      packageItem("two", "demo", "1.0.0", undefined, {
        projectPaths: ["b.csproj"],
        versions: [{ version: "2.0.0", source: "Installed" }],
      }),
    ]);
    expect(installed).toHaveLength(1);
    expect(installed[0]?.projectPaths).toEqual(["a.csproj", "b.csproj"]);

    const results = mergePackageResults([
      packageItem("nuget:demo", "Demo", undefined, "1.0.0", {
        sourceName: "nuget",
        iconUrl: "icon",
      }),
      packageItem("private:demo", "demo", undefined, "2.0.0", {
        sourceName: "private",
      }),
    ]);
    expect(results[0]).toMatchObject({
      sourceName: "nuget, private",
      iconUrl: "icon",
    });
    expect(results[0]?.versions.map((version) => version.version)).toEqual([
      "1.0.0",
      "2.0.0",
    ]);
  });

  it("applies available metadata and package details", () => {
    const installed = packageItem("installed:demo", "Demo", "1.0.0");
    const available = packageItem("nuget:demo", "demo", undefined, "2.0.0", {
      sourceName: "nuget.org",
      sourceUrl: "https://nuget",
      iconUrl: "icon",
      description: "desc",
      authors: "Author",
      tags: ["tag"],
      published: "2026-01-01",
      dependencyGroups: [
        {
          framework: "net8.0",
          dependencies: [{ id: "Dep", versionRange: "[1,2)" }],
        },
      ],
      availableFeeds: [
        {
          id: "nuget",
          name: "nuget.org",
          displayName: "nuget.org",
          url: "https://nuget",
          color: "#4da3ff",
        },
      ],
    });

    expect(
      applyAvailablePackageMetadata([installed], [available])[0],
    ).toMatchObject({
      availableVersion: "2.0.0",
      sourceName: "nuget.org",
      iconUrl: "icon",
      description: "desc",
      authors: "Author",
    });

    expect(
      mergePackageDetails(
        packageItem("current", "Demo", "1.0.0", undefined, { versions: [] }),
        available,
      ),
    ).toMatchObject({ availableVersion: "2.0.0", deprecated: undefined });

    expect(
      mergePackageDetailsFromFeed(installed, available, httpFeed("private")),
    ).toMatchObject({
      sourceName: "private",
      sourceUrl: "https://private/index.json",
      availableVersion: "2.0.0",
    });
  });

  it("replaces package instances and applies inventory updates", () => {
    const installed = packageItem("installed", "Demo", "1.0.0");
    const available = packageItem("available", "Demo", undefined, "2.0.0");
    const state = stateWithPackages({
      installedPackages: [installed],
      implicitPackages: [packageItem("implicit", "Other", "1.0.0")],
      availablePackages: [available],
      selectedPackageId: "installed",
    });

    expect(
      replacePackage([installed], { ...installed, description: "updated" })[0]
        ?.description,
    ).toBe("updated");
    expect(
      replacePackage([installed], { ...installed, id: "missing" }),
    ).toEqual([installed]);
    expect(
      applyPackageDetails(state, { ...installed, description: "updated" })
        .installedPackages[0]?.description,
    ).toBe("updated");
    expect(
      applyAvailablePackages(state, [available]).availablePackages,
    ).toEqual([available]);
    expect(
      applyPackageInventory(
        state,
        {
          installed: [{ ...installed, availableVersion: "2.0.0" }],
          implicit: [],
        },
        [available],
      ),
    ).toMatchObject({
      installedPackagesStatus: "ready",
      implicitPackagesStatus: "ready",
      hasUpgrades: true,
    });
  });
});

describe("project actions and folder cache helpers", () => {
  it("computes per-project actions and package change labels", () => {
    const item = packageItem("demo", "Demo", "1.0.0", "2.0.0", {
      projectStates: [
        {
          projectPath: "src/App.csproj",
          installedVersion: "1.0.0",
          implicit: false,
        },
        {
          projectPath: "src/Api.csproj",
          installedVersion: "3.0.0",
          implicit: false,
        },
      ],
    });

    expect(projectVersionAction(undefined, "1.0.0")).toBe("add");
    expect(projectVersionAction("1.0.0", "")).toBe("remove");
    expect(projectVersionAction("1.0.0", "2.0.0")).toBe("update");
    expect(projectVersionAction("2.0.0", "1.0.0")).toBe("downgrade");
    expect(
      packageChangeAction("addPackage", item, "2.0.0", ["src/App.csproj"]),
    ).toBe("Installing");
    expect(
      packageChangeAction("upgradeSelectedPackage", item, "2.0.0", [
        "src/App.csproj",
      ]),
    ).toBe("Updating");
    expect(
      packageChangeAction("upgradeSelectedPackage", item, "2.0.0", [
        "src/Api.csproj",
      ]),
    ).toBe("Downgrading");
    expect(
      packageChangeAction("upgradeSelectedPackage", item, "2.0.0", [
        "src/App.csproj",
        "src/Api.csproj",
      ]),
    ).toBe("Changing");
    expect(
      globalProjectActions(item, "", ["src/App.csproj", "src/New.csproj"]),
    ).toEqual({
      add: [],
      update: [],
      downgrade: [],
      remove: ["src/App.csproj"],
    });
    expect(
      globalProjectActions(item, "2.0.0", ["src/App.csproj", "src/New.csproj"]),
    ).toEqual({
      add: ["src/New.csproj"],
      update: ["src/App.csproj"],
      downgrade: [],
      remove: ["src/App.csproj"],
    });
  });

  it("updates explicit project package state only", () => {
    const item = packageItem("demo", "Demo", "1.0.0", undefined, {
      projectStates: [
        {
          projectPath: "src/App.csproj",
          installedVersion: "1.0.0",
          implicit: false,
        },
        {
          projectPath: "src/Transitive.csproj",
          installedVersion: "1.0.0",
          implicit: true,
        },
      ],
    });
    const updated = updatePackageProjectState(
      item,
      "Demo",
      ["src/App.csproj", "src/Api.csproj"],
      "2.0.0",
    );

    expect(updated.installedVersion).toBe("2.0.0");
    expect(updated.projectPaths).toEqual(["src/App.csproj", "src/Api.csproj"]);
    expect(updated.projectStates?.some((state) => state.implicit)).toBe(true);
    expect(updated.versions[0]).toEqual({
      version: "2.0.0",
      source: "Installed",
    });
    expect(
      updatePackageProjectState(item, "Other", ["src/App.csproj"], "2.0.0"),
    ).toBe(item);
    expect(
      updatePackageProjectState(item, "Demo", ["src/App.csproj"], undefined)
        .installedVersion,
    ).toBeUndefined();
    expect(
      updatePackageProjectStates([item], "Demo", ["src/App.csproj"], "2.0.0")[0]
        ?.installedVersion,
    ).toBe("2.0.0");
  });

  it("toggles single folder selection and persists calculated sizes", () => {
    const folders: NuGetCacheFolder[] = [
      { id: "a", title: "A", path: "a", selected: false },
      {
        id: "b",
        title: "B",
        path: "b",
        selected: true,
        sizeBytes: 10,
        sizeCalculatedAt: "old",
      },
    ];

    expect(
      toggleSingleFolderSelection(stateWithPackages({ folders }), "a").folders,
    ).toMatchObject([
      { id: "a", selected: true },
      { id: "b", selected: false },
    ]);
    expect(
      toggleSingleFolderSelection(stateWithPackages({ folders }), "b").folders,
    ).toMatchObject([
      { id: "a", selected: false },
      { id: "b", selected: false },
    ]);
    expect(
      applyCachedFolderSizes(folders, {
        a: { sizeBytes: 42, calculatedAt: "now" },
      }),
    ).toMatchObject([
      { id: "a", sizeBytes: 42, sizeCalculatedAt: "now" },
      { id: "b", sizeBytes: 10, sizeCalculatedAt: "old" },
    ]);
    expect(
      createFolderSizeCache(
        { existing: { sizeBytes: 1, calculatedAt: "x" } },
        folders,
      ),
    ).toEqual({
      existing: { sizeBytes: 1, calculatedAt: "x" },
      b: { sizeBytes: 10, calculatedAt: "old" },
    });
  });
});

function packageItem(
  id: string,
  name: string,
  installedVersion?: string,
  availableVersion?: string,
  overrides: Partial<NuGetPackageItem> = {},
): NuGetPackageItem {
  const projectPaths =
    overrides.projectPaths ?? (installedVersion ? ["src/App.csproj"] : []);
  return {
    id,
    name,
    installedVersion,
    availableVersion,
    projectPaths,
    projectStates:
      overrides.projectStates ??
      (installedVersion
        ? projectPaths.map((projectPath) => ({
            projectPath,
            installedVersion,
            implicit: false,
          }))
        : undefined),
    versions: overrides.versions ?? [
      ...(installedVersion
        ? [{ version: installedVersion, source: "Installed" }]
        : []),
      ...(availableVersion
        ? [{ version: availableVersion, source: "nuget.org" }]
        : []),
    ],
    dependencyGroups: [],
    ...overrides,
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

function target(
  id: string,
  path: string,
  projectPaths: string[],
): WorkspaceTarget {
  return {
    id,
    kind:
      path.endsWith(".sln") || path.endsWith(".slnx") ? "solution" : "project",
    name: projectName(path),
    path,
    projectPaths,
  };
}

function httpFeed(id: string): PackageFeed {
  return {
    id,
    name: id === "nuget" ? "nuget.org" : id,
    url: `https://${id}/index.json`,
    enabled: true,
  };
}

function fileFeed(id: string): PackageFeed {
  return {
    id,
    name: id,
    url: `c:/${id}`,
    enabled: true,
  };
}

function config(id: string): NuGetConfigFile {
  return {
    id,
    name: id,
    path: id,
    origin: "workspace",
    hasCredentials: false,
    scope: "workspace",
    feeds: [],
  };
}
