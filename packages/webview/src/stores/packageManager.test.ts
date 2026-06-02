// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { usePackageManagerStore } from "./packageManager.js";
import type {
  ExtensionToWebviewMessage,
  NuGetPackageItem,
  PackageManagerState,
  WorkspaceTarget,
} from "#contracts";

const vscode = vi.hoisted(() => ({
  postMessage: vi.fn(),
}));

vi.mock("#webview/composables/useVsCodeApi", () => ({
  useVsCodeApi: () => vscode,
}));

describe("package manager store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vscode.postMessage.mockReset();
    vi.useFakeTimers();
  });

  it("connects to the extension, posts ready, and disconnects cleanly", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const store = usePackageManagerStore();

    const disconnect = store.connect();

    expect(add).toHaveBeenCalledWith("message", expect.any(Function));
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: "ready" });

    disconnect();
    expect(remove).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("debounces search while preserving pending input over incoming state", () => {
    const store = usePackageManagerStore();
    store.connect();

    store.setSearch("newton");
    dispatch({ type: "state", state: state({ search: "" }) });

    expect(store.model.search).toBe("newton");
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      type: "setSearch",
      search: "newton",
    });

    vi.advanceTimersByTime(1000);
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "setSearch",
      search: "newton",
    });
  });

  it("selects target, feed, source, folders, and include-prerelease", () => {
    const store = usePackageManagerStore();
    store.connect();
    dispatch({ type: "state", state: state({ targets: [target()] }) });

    store.selectTargetId("app");
    store.selectFeedId("nuget");
    store.selectSourceId("source");
    store.toggleFolder("global");
    store.setIncludePrerelease(true);
    store.runCommand("refreshPackages");
    store.runCommand("refreshPackages", { feedId: "__all__" });
    store.runCommand("refreshLogs");

    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "selectTarget",
      targetId: "app",
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "selectFeed",
      feedId: "nuget",
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "selectSource",
      sourceId: "source",
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "toggleFolder",
      folderId: "global",
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "setIncludePrerelease",
      includePrerelease: true,
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "runCommand",
      command: "refreshPackages",
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "runCommand",
      command: "refreshPackages",
      feedId: "__all__",
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "runCommand",
      command: "refreshLogs",
    });
  });

  it("selects packages locally and requests selected-feed details", () => {
    const store = usePackageManagerStore();
    store.connect();
    const available = packageItem("nuget:demo", "Demo", undefined, "2.0.0", {
      availableFeeds: [
        {
          id: "private",
          name: "private",
          displayName: "private",
          url: "https://private",
          color: "#000",
        },
      ],
    });
    dispatch({
      type: "state",
      state: state({
        selectedFeedId: "private",
        feeds: [
          { id: "__all__", name: "All feeds", url: "", enabled: true },
          {
            id: "private",
            name: "private",
            url: "https://private",
            enabled: true,
          },
        ],
        targets: [target()],
        selectedTargetId: "app",
        installedPackages: [packageItem("installed:demo", "Demo", "1.0.0")],
        availablePackages: [available],
      }),
    });

    store.selectPackageItem(available);

    expect(store.selectedPackageId).toBe("nuget:demo");
    expect(store.selectedVersion).toBe("1.0.0");
    expect(store.selectedDetailFeedId).toBe("private");
    expect(store.selectedProjectPaths).toEqual(["src/App.csproj"]);
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "selectPackage",
      packageId: "nuget:demo",
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "loadPackageDetails",
      packageId: "nuget:demo",
      feedId: "private",
    });

    store.setSelectedVersion("2.0.0");
    expect(store.selectedVersion).toBe("2.0.0");
    store.setSelectedDetailFeed("private");
    expect(
      vscode.postMessage.mock.calls.filter(
        ([message]) => message.type === "loadPackageDetails",
      ),
    ).toHaveLength(1);
  });

  it("updates state from extension messages", () => {
    const store = usePackageManagerStore();
    store.connect();
    const selected = packageItem("nuget:demo", "Demo", undefined, "2.0.0");
    dispatch({
      type: "state",
      state: state({
        feeds: [
          { id: "__all__", name: "All feeds", url: "", enabled: true },
          {
            id: "nuget",
            name: "nuget.org",
            url: "https://nuget",
            enabled: true,
          },
        ],
      }),
    });

    dispatch({
      type: "availablePackagesChanged",
      requestId: 1,
      availablePackages: [selected],
      selectedPackageId: selected.id,
    });
    expect(store.model.availablePackages).toEqual([selected]);
    expect(store.selectedPackageId).toBe(selected.id);

    dispatch({
      type: "packageInventoryChanged",
      requestId: 2,
      installedPackages: [packageItem("installed:demo", "Demo", "1.0.0")],
      implicitPackages: [packageItem("implicit:dep", "Dep", "1.0.0")],
      installedPackagesStatus: "ready",
      implicitPackagesStatus: "ready",
      selectedPackageId: selected.id,
      hasUpgrades: true,
    });
    expect(store.model.hasUpgrades).toBe(true);
    expect(store.model.installedPackagesStatus).toBe("ready");

    dispatch({
      type: "packageAvailabilityChanged",
      requestId: 3,
      installedPackages: [
        packageItem("installed:demo", "Demo", "1.0.0", "2.0.0"),
      ],
      implicitPackages: [],
      hasUpgrades: true,
    });
    expect(store.model.installedPackages[0]?.availableVersion).toBe("2.0.0");
    expect(store.model.hasUpgrades).toBe(true);

    dispatch({
      type: "packageDetailsChanged",
      requestId: 4,
      packageId: selected.id,
      feedId: "nuget",
      packageItem: { ...selected, description: "Details" },
    });
    expect(store.model.availablePackages[0]?.description).toBe("Details");
    expect(store.selectedDetailFeedId).toBe("nuget");

    dispatch({
      type: "foldersChanged",
      folders: [
        { id: "global", title: "global", path: "c:/packages", selected: false },
      ],
    });
    expect(store.model.folders).toHaveLength(1);

    dispatch({
      type: "log",
      entry: {
        id: 1,
        timestamp: "now",
        level: "warning",
        context: "vscode",
        message: "hello",
        formatted: "hello",
      },
    });
    expect(store.model.logs).toHaveLength(1);

    dispatch({ type: "logs", entries: [] });
    expect(store.model.logs).toEqual([]);

    dispatch({
      type: "operationStarted",
      operationId: "1",
      kind: "availablePackages",
      label: "Loading",
    });
    dispatch({
      type: "operationFinished",
      operationId: "1",
      kind: "availablePackages",
      label: "Loading",
    });
    dispatch({
      type: "operationFailed",
      operationId: "1",
      kind: "availablePackages",
      label: "Loading",
      error: "bad",
    });
  });

  it("runs optimistic project install, update, and remove commands", () => {
    const store = usePackageManagerStore();
    store.connect();
    const item = packageItem("nuget:demo", "Demo", "1.0.0", "2.0.0", {
      projectStates: [
        {
          projectPath: "src/App.csproj",
          installedVersion: "1.0.0",
          implicit: false,
        },
        {
          projectPath: "src/Api.csproj",
          installedVersion: undefined,
          implicit: false,
        },
      ],
    });
    dispatch({
      type: "state",
      state: state({
        targets: [target(["src/App.csproj", "src/Api.csproj"])],
        selectedTargetId: "app",
        feeds: [
          { id: "__all__", name: "All feeds", url: "", enabled: true },
          {
            id: "nuget",
            name: "nuget.org",
            url: "https://nuget",
            enabled: true,
          },
        ],
        selectedFeedId: "nuget",
        availablePackages: [item],
      }),
    });
    store.selectPackageItem(item);
    store.setProjectSelected("src/Api.csproj", true);

    expect(store.selectedProjectPathsForTarget()).toEqual([
      "src/App.csproj",
      "src/Api.csproj",
    ]);
    expect(
      store.getGlobalProjectActions(item, "2.0.0", store.selectedProjectPaths),
    ).toMatchObject({ add: ["src/Api.csproj"], update: ["src/App.csproj"] });

    store.runPackageCommandForProjects(
      "upgradeSelectedPackage",
      "2.0.0",
      "nuget",
      ["src/App.csproj", "src/Api.csproj"],
    );
    expect(store.model.availablePackages[0]?.installedVersion).toBe("2.0.0");
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "runCommand",
      command: "upgradeSelectedPackage",
      version: "2.0.0",
      feedId: "nuget",
      projectPaths: ["src/App.csproj", "src/Api.csproj"],
    });

    store.runPackageCommandForProjects("removePackage", "", "nuget", [
      "src/App.csproj",
    ]);
    expect(store.selectedProjectPaths).toEqual(["src/Api.csproj"]);
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "runCommand",
      command: "removePackage",
      version: "",
      feedId: "nuget",
      projectPaths: ["src/App.csproj"],
    });

    const calls = vscode.postMessage.mock.calls.length;
    store.runPackageCommandForProjects("addPackage", "2.0.0", "nuget", []);
    expect(vscode.postMessage).toHaveBeenCalledTimes(calls);
  });
});

function dispatch(message: ExtensionToWebviewMessage): void {
  window.dispatchEvent(new MessageEvent("message", { data: message }));
}

function state(
  overrides: Partial<PackageManagerState> = {},
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
    ...overrides,
  };
}

function target(projectPaths = ["src/App.csproj"]): WorkspaceTarget {
  return {
    id: "app",
    kind: "solution",
    name: "App",
    path: "src/App.sln",
    projectPaths,
  };
}

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
    versions: [
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
