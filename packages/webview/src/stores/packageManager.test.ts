// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { usePackageManagerStore } from "./packageManager.js";
import type {
  ExtensionToWebviewMessage,
  PackageManagerEvent,
  NuGetPackageItem,
  PackageManagerState,
  WorkspaceTarget,
} from "#contracts";
import { createReadFlowStates } from "#manager";

let fixtureRevision = 0;
const connections: Array<() => void> = [];
afterEach(() => {
  for (const disconnect of connections.splice(0)) disconnect();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const vscode = vi.hoisted(() => ({
  postMessage: vi.fn(),
}));

vi.mock("#webview/composables/useVsCodeApi", () => ({
  useVsCodeApi: () => vscode,
}));

describe("package manager store", () => {
  beforeEach(() => {
    fixtureRevision = 0;
    setActivePinia(createPinia());
    vscode.postMessage.mockReset();
    vi.useFakeTimers();
  });

  it("connects to the extension, posts ready, and disconnects cleanly", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const store = usePackageManagerStore();

    const disconnect = connect(store);

    expect(add).toHaveBeenCalledWith("message", expect.any(Function));
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: "ready" });

    disconnect();
    expect(remove).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("debounces search while preserving pending input over incoming state", () => {
    const store = usePackageManagerStore();
    connect(store);

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
    connect(store);
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
    connect(store);
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
    connect(store);
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
    connect(store);
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

  it("accepts only contiguous deltas and ignores delayed snapshots and duplicates", () => {
    const store = usePackageManagerStore();
    const disconnect = connect(store);
    try {
      wire({
        type: "state",
        sessionId: "revision-test",
        revision: 10,
        state: state({ search: "snapshot" }),
      });
      wire({
        type: "stateDelta",
        sessionId: "revision-test",
        baseRevision: 10,
        revision: 11,
        patch: { search: "current" },
      });
      expect(store.model.search).toBe("current");
      wire({
        type: "state",
        sessionId: "revision-test",
        revision: 9,
        state: state({ search: "late" }),
      });
      wire({
        type: "stateDelta",
        sessionId: "revision-test",
        baseRevision: 10,
        revision: 11,
        patch: { search: "duplicate" },
      });
      expect(store.model.search).toBe("current");
      vscode.postMessage.mockClear();
      wire({
        type: "stateDelta",
        sessionId: "revision-test",
        baseRevision: 12,
        revision: 13,
        patch: { search: "gap" },
      });
      wire({
        type: "logs",
        sessionId: "revision-test",
        baseRevision: 14,
        revision: 15,
        entries: [],
      });
      expect(store.model.search).toBe("current");
      expect(vscode.postMessage).toHaveBeenCalledExactlyOnceWith({
        type: "ready",
      });
      wire({
        type: "state",
        sessionId: "revision-test",
        revision: 14,
        state: state({ search: "recovered" }),
      });
      expect(store.model.search).toBe("recovered");
    } finally {
      disconnect();
    }
  });

  it("resynchronizes a new session and clears old controls and pending input", () => {
    const store = usePackageManagerStore();
    const disconnect = connect(store);
    try {
      wire({
        type: "state",
        sessionId: "old-host",
        revision: 8,
        state: state({
          availablePackages: [packageItem("demo", "Demo", "1.0.0")],
        }),
      });
      store.setSelectedVersion("9.0.0");
      store.setSearch("old pending input");
      wire({
        type: "stateDelta",
        sessionId: "new-host",
        baseRevision: 0,
        revision: 1,
        patch: { search: "invalid without snapshot" },
      });
      expect(store.model.search).toBe("old pending input");
      expect(vscode.postMessage).toHaveBeenCalledWith({ type: "ready" });
      wire({
        type: "state",
        sessionId: "new-host",
        revision: 2,
        state: state({
          search: "new snapshot",
          selectedPackageId: "other",
          availablePackages: [packageItem("other", "Other", "2.0.0", "9.0.0")],
        }),
      });
      expect(store.model.search).toBe("new snapshot");
      expect(store.selectedVersion).toBe("2.0.0");
      expect(store.selectedProjectPaths).toEqual([]);
      wire({
        type: "state",
        sessionId: "old-host",
        revision: 99,
        state: state({ search: "retired" }),
      });
      expect(store.model.search).toBe("new snapshot");
      vscode.postMessage.mockClear();
      vi.advanceTimersByTime(1000);
      expect(vscode.postMessage).not.toHaveBeenCalledWith({
        type: "setSearch",
        search: "old pending input",
      });
    } finally {
      disconnect();
    }
  });
});

function wire(message: ExtensionToWebviewMessage): void {
  window.dispatchEvent(new MessageEvent("message", { data: message }));
}

function connect(store: ReturnType<typeof usePackageManagerStore>): () => void {
  const disconnect = store.connect();
  connections.push(disconnect);
  return disconnect;
}

function dispatch(message: PackageManagerEvent): void {
  const baseRevision = fixtureRevision++;
  if (message.type === "state")
    wire({ ...message, sessionId: "fixture", revision: fixtureRevision });
  else
    wire({
      ...message,
      sessionId: "fixture",
      baseRevision,
      revision: fixtureRevision,
    });
}

function state(
  overrides: Partial<PackageManagerState> = {},
): PackageManagerState {
  return {
    flows: createReadFlowStates(),
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
