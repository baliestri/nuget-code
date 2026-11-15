import { BackendRestartedError, BackendStoppedError, ResponseError, type BackendApi } from "@nuget-code/backend-client";
import { ALLOWED_BACKEND_METHODS, BridgeError, type BackendMethod } from "@nuget-code/bridge";
import { describe, expect, it } from "vitest";
import {
  createBackendHandler,
  createHostHandler,
  FOLDER_SIZE_LIFETIME_MS,
  isInside,
  toSessionState,
  warningNotice,
  type HostDeps
} from "./bridgeHost";

const WITHOUT_PARAMS: readonly BackendMethod[] = ["installedPackages", "cancelOperation", "listSources", "listFolders"];

/** A backend client that records how each method was called and answers with the method's name. */
function fakeApi(fail?: unknown): { api: BackendApi; calls: { method: string; args: unknown[] }[] } {
  const calls: { method: string; args: unknown[] }[] = [];
  const api = new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        (...args: unknown[]) => {
          calls.push({ method, args });
          return fail === undefined ? Promise.resolve({ answeredBy: method }) : Promise.reject(fail);
        }
    }
  ) as BackendApi;
  return { api, calls };
}

const NOW = 1_800_000_000_000;

function fakeDeps(overrides: Partial<HostDeps> = {}): { deps: HostDeps; calls: string[] } {
  const calls: string[] = [];
  const record =
    <T>(name: string, result: T) =>
    (...args: unknown[]): Promise<T> => {
      calls.push(`${name}(${args.map((arg) => JSON.stringify(arg)).join(", ")})`);
      return Promise.resolve(result);
    };
  const deps: HostDeps = {
    isKnownFolder: record("isKnownFolder", true),
    revealFolder: record("revealFolder", undefined),
    openSettings: record("openSettings", undefined),
    pickFolder: record("pickFolder", "/chosen"),
    openExternal: record("openExternal", undefined),
    saveCredential: record("saveCredential", true),
    resetCredentials: record("resetCredentials", undefined),
    runCommand: record("runCommand", undefined),
    notifyWarnings: (...args) =>
      void calls.push(`notifyWarnings(${args.map((arg) => JSON.stringify(arg)).join(", ")})`),
    notify: (...args) => void calls.push(`notify(${args.map((arg) => JSON.stringify(arg)).join(", ")})`),
    readFolderSizes: () => undefined,
    writeFolderSizes: () => Promise.resolve(),
    now: () => NOW,
    packagesFolder: () => Promise.resolve("/home/me/.nuget/packages"),
    folderExists: () => true,
    copyText: record("copyText", undefined),
    platform: "linux",
    ...overrides
  };
  return { deps, calls };
}

describe("createBackendHandler", () => {
  it.each(ALLOWED_BACKEND_METHODS)("%s is forwarded to the client method of the same name", async (method) => {
    const { api, calls } = fakeApi();
    const params = { marker: method };

    const result = await createBackendHandler(api)(method, params);

    expect(result).toEqual({ answeredBy: method });
    // A method without parameters is called with none: the params object must not land in the token slot.
    expect(calls).toEqual([{ method, args: WITHOUT_PARAMS.includes(method) ? [] : [params] }]);
  });

  it("a backend error keeps its code, message and data", async () => {
    const { api } = fakeApi(new ResponseError(1108, "duplicate", "details"));

    const error = await createBackendHandler(api)("addSource", {}).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({ kind: "backend", code: 1108, message: "duplicate", data: "details" });
  });

  it.each([
    [new BackendStoppedError(), "stopped"],
    [new BackendRestartedError(), "restarted"],
    [new Error("boom"), "host"]
  ])("%s becomes a %s error", async (failure, kind) => {
    const { api } = fakeApi(failure);

    const error = await createBackendHandler(api)("listFolders", {}).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ kind });
  });
});

describe("createHostHandler", () => {
  it("openFolder reveals a folder the backend lists", async () => {
    const { deps, calls } = fakeDeps();

    await createHostHandler(deps)("openFolder", { path: "/cache" });

    expect(calls).toEqual(['isKnownFolder("/cache")', 'revealFolder("/cache")']);
  });

  it("openFolder refuses a folder the backend does not list", async () => {
    const { deps, calls } = fakeDeps({ isKnownFolder: () => Promise.resolve(false) });

    const error = await createHostHandler(deps)("openFolder", { path: "/etc" }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ kind: "host" });
    expect(calls).toEqual([]);
  });

  it("openFolder reveals the folder of a package inside the global packages folder", async () => {
    const { deps, calls } = fakeDeps({ isKnownFolder: () => Promise.resolve(false) });

    await createHostHandler(deps)("openFolder", { path: "/home/me/.nuget/packages/alpha/1.0.0" });

    expect(calls).toEqual(['revealFolder("/home/me/.nuget/packages/alpha/1.0.0")']);
  });

  it.each(["/home/me/.nuget/packages/../../.ssh", "/home/me/.nuget/packages-other/x", "alpha/1.0.0"])(
    "openFolder refuses %s, which is not inside the packages folder",
    async (path) => {
      const { deps, calls } = fakeDeps({ isKnownFolder: () => Promise.resolve(false) });

      const error = await createHostHandler(deps)("openFolder", { path }).catch((reason: unknown) => reason);

      expect(error).toMatchObject({ kind: "host" });
      expect(calls).toEqual([]);
    }
  );

  it("openFolder says so when the folder does not exist", async () => {
    const { deps, calls } = fakeDeps({ folderExists: () => false });

    const error = await createHostHandler(deps)("openFolder", { path: "/cache" }).catch((reason: unknown) => reason);

    expect((error as Error).message).toContain("does not exist");
    expect(calls).toEqual(['isKnownFolder("/cache")']);
  });

  it("isInside compares Windows paths without regard to case or separator", () => {
    expect(isInside("C:\\Users\\me\\.nuget\\packages\\", "c:/users/me/.nuget/packages/alpha", "win32")).toBe(true);
    expect(isInside("C:\\packages", "C:\\packages", "win32")).toBe(false);
    expect(isInside("C:\\packages", "D:\\packages\\alpha", "win32")).toBe(false);
  });

  it("copyText puts a short text on the clipboard", async () => {
    const { deps, calls } = fakeDeps();

    await createHostHandler(deps)("copyText", { text: "Newtonsoft.Json" });

    expect(calls).toEqual(['copyText("Newtonsoft.Json")']);
  });

  it.each([{ text: "" }, { text: "x".repeat(501) }, { text: 5 }])("copyText refuses %j", async (params) => {
    const { deps, calls } = fakeDeps();

    const error = await Promise.resolve()
      .then(() => createHostHandler(deps)("copyText", params))
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ kind: "host" });
    expect(calls).toEqual([]);
  });

  it("pickFolder answers with the chosen path, or with nothing when cancelled", async () => {
    const chosen = fakeDeps();
    const cancelled = fakeDeps({ pickFolder: () => Promise.resolve(undefined) });

    expect(await createHostHandler(chosen.deps)("pickFolder", { title: "Choose" })).toEqual({ path: "/chosen" });
    expect(await createHostHandler(cancelled.deps)("pickFolder", { title: "Choose" })).toEqual({});
  });

  it("openExternal opens an https address", async () => {
    const { deps, calls } = fakeDeps();

    await createHostHandler(deps)("openExternal", { url: "https://licenses.nuget.org/MIT" });

    expect(calls).toEqual(['openExternal("https://licenses.nuget.org/MIT")']);
  });

  it.each(["file:///etc/passwd", "command:workbench.action.terminal.new", "vscode://settings", "javascript:1", "x"])(
    "openExternal refuses %s",
    async (url) => {
      const { deps, calls } = fakeDeps();

      const error = await createHostHandler(deps)("openExternal", { url }).catch((reason: unknown) => reason);

      expect(error).toMatchObject({ kind: "host" });
      expect(calls).toEqual([]);
    }
  );

  it("saveCredential stores, then lets the backend ask again for that source", async () => {
    const { deps, calls } = fakeDeps();
    const params = { source: "https://feed.example/v3/index.json", username: "user", password: "s3cr3t" };

    await createHostHandler(deps)("saveCredential", params);

    expect(calls).toEqual([
      'saveCredential("https://feed.example/v3/index.json", "user", "s3cr3t")',
      'resetCredentials("https://feed.example/v3/index.json")'
    ]);
  });

  it("saveCredential for a source that is not a URL is an error and resets nothing", async () => {
    const { deps, calls } = fakeDeps({ saveCredential: () => Promise.resolve(false) });

    const error = await createHostHandler(deps)("saveCredential", {
      source: "C:\\feed",
      username: "user",
      password: "s3cr3t"
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ kind: "host" });
    expect(calls).toEqual([]);
  });

  it("an error never repeats the password", async () => {
    const { deps } = fakeDeps({ saveCredential: () => Promise.resolve(false) });

    const error = (await createHostHandler(deps)("saveCredential", {
      source: "feed",
      username: "user",
      password: "s3cr3t"
    }).catch((reason: unknown) => reason)) as Error;

    expect(error.message).not.toContain("s3cr3t");
  });

  it.each([
    ["selectSolution", "nuget.selectSolution"],
    ["showLog", "nuget.showLog"],
    ["restartBackend", "nuget.restartBackend"],
    ["openConsole", "nuget.openConsole"]
  ] as const)("%s runs the command %s", async (request, command) => {
    const { deps, calls } = fakeDeps();

    await createHostHandler(deps)(request, {});

    expect(calls).toEqual([`runCommand("${command}")`]);
  });

  it("notifyWarnings passes the title and the sentences on, dropping what is not text", async () => {
    const { deps, calls } = fakeDeps();

    await createHostHandler(deps)("notifyWarnings", { title: "Update", messages: ["One.", 5, "", "Two."] });

    expect(calls).toEqual([`notifyWarnings("Update", ["One.","Two."])`]);
  });

  it("notify passes the kind and the sentences on; an unknown kind is plain information", async () => {
    const { deps, calls } = fakeDeps();
    const handler = createHostHandler(deps);

    await handler("notify", { kind: "warning", messages: ["One.", null, "Two."] });
    await handler("notify", { kind: "shout", messages: ["Three."] });
    await handler("notify", { kind: "info", messages: [] });

    expect(calls).toEqual([`notify("warning", ["One.","Two."])`, `notify("info", ["Three."])`]);
  });

  it("folderSizes answers with the stored sizes that are well formed and under thirty days old", async () => {
    const fresh = { exists: true, bytes: 10, at: NOW - FOLDER_SIZE_LIFETIME_MS + 1 };
    const { deps } = fakeDeps({
      readFolderSizes: () => ({
        "/fresh": fresh,
        "/old": { exists: true, bytes: 10, at: NOW - FOLDER_SIZE_LIFETIME_MS },
        "/broken": { exists: "yes", bytes: 10, at: NOW },
        "/nothing": null
      })
    });

    expect(await createHostHandler(deps)("folderSizes", {})).toEqual({ sizes: { "/fresh": fresh } });
  });

  it.each([undefined, "text", [1, 2], 5])("folderSizes with %j stored has no sizes", async (stored) => {
    const { deps } = fakeDeps({ readFolderSizes: () => stored });

    expect(await createHostHandler(deps)("folderSizes", {})).toEqual({ sizes: {} });
  });

  it("saveFolderSize stores the size with the time, beside the fresh ones, and answers with it", async () => {
    const written: unknown[] = [];
    const other = { exists: true, bytes: 1, at: NOW - 1000 };
    const { deps } = fakeDeps({
      readFolderSizes: () => ({ "/other": other, "/old": { exists: true, bytes: 1, at: 0 } }),
      writeFolderSizes: (sizes) => {
        written.push(sizes);
        return Promise.resolve();
      }
    });

    const answer = await createHostHandler(deps)("saveFolderSize", { path: "/cache", exists: true, bytes: 2048 });

    const size = { exists: true, bytes: 2048, at: NOW };
    expect(answer).toEqual({ size });
    expect(written).toEqual([{ "/other": other, "/cache": size }]);
  });

  it("saveFolderSize refuses a folder the backend does not list", async () => {
    const written: unknown[] = [];
    const { deps } = fakeDeps({
      isKnownFolder: () => Promise.resolve(false),
      writeFolderSizes: (sizes) => {
        written.push(sizes);
        return Promise.resolve();
      }
    });

    const error = await createHostHandler(deps)("saveFolderSize", { path: "/etc", exists: true, bytes: 1 }).catch(
      (reason: unknown) => reason
    );

    expect(error).toBeInstanceOf(BridgeError);
    expect(written).toEqual([]);
  });

  it.each([
    { path: "/cache", exists: "yes", bytes: 1 },
    { path: "/cache", exists: true, bytes: -1 },
    { path: "/cache", exists: true, bytes: "many" },
    { path: "", exists: true, bytes: 1 }
  ])("saveFolderSize refuses %j", async (params) => {
    const { deps } = fakeDeps();

    const error = await Promise.resolve()
      .then(() => createHostHandler(deps)("saveFolderSize", params))
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(BridgeError);
  });

  it("notifyWarnings with nothing to say shows nothing", async () => {
    const { deps, calls } = fakeDeps();

    await createHostHandler(deps)("notifyWarnings", { title: "Update", messages: [] });

    expect(calls).toEqual([]);
  });

  it("the notice is the first sentence and how many more there are", () => {
    expect(warningNotice(["One."])).toBe("One.");
    expect(warningNotice(["One.", "Two.", "Three."])).toBe("One. And 2 more; see the log.");
  });

  it.each([null, "text", { path: 5 }, {}])(
    "params that are not what the request needs (%j) are an error",
    async (params) => {
      const { deps, calls } = fakeDeps();

      const error = await Promise.resolve()
        .then(() => createHostHandler(deps)("openFolder", params))
        .catch((reason: unknown) => reason);

      expect(error).toMatchObject({ kind: "host" });
      expect(calls).toEqual([]);
    }
  );

  it("openSettings passes the query, or none", async () => {
    const { deps, calls } = fakeDeps();
    const handler = createHostHandler(deps);

    await handler("openSettings", { query: "nuget.dotnetPath" });
    await handler("openSettings", {});

    expect(calls).toEqual(['openSettings("nuget.dotnetPath")', "openSettings()"]);
  });
});

describe("toSessionState", () => {
  const opened = {
    path: "/work/Sample.slnx",
    kind: "slnx" as const,
    projects: [{ name: "App", path: "/work/App/App.csproj", frameworks: ["net10.0"], centralPackageManagement: false }]
  };
  const withSdk = { protocolVersion: 1, backendVersion: "1.0.0", sdk: { dotnetPath: "dotnet", version: "10.0.403" } };

  it("an open solution carries its path and projects", () => {
    const state = toSessionState({
      backend: "ready",
      solution: { kind: "open", name: "Sample.slnx" },
      opened,
      initialized: withSdk,
      audit: true,
      console: true
    });

    expect(state).toEqual({
      backend: "ready",
      solution: { kind: "open", name: "Sample.slnx", path: opened.path, projects: opened.projects },
      hasSdk: true,
      audit: true,
      console: true
    });
  });

  it.each(["none", "opening"] as const)("a solution that is %s has no projects", (kind) => {
    const state = toSessionState({
      backend: "ready",
      solution: { kind },
      opened: undefined,
      initialized: withSdk,
      audit: true,
      console: true
    });

    expect(state.solution).toEqual({ kind });
  });

  it.each(["starting", "stopped"] as const)("a backend that is %s is reported as such", (backend) => {
    const state = toSessionState({
      backend,
      solution: { kind: "none" },
      opened: undefined,
      initialized: undefined,
      audit: true,
      console: true
    });

    expect(state).toEqual({ backend, solution: { kind: "none" }, hasSdk: false, audit: true, console: true });
  });

  it("no SDK in the answer of initialize means hasSdk is false", () => {
    const state = toSessionState({
      backend: "ready",
      solution: { kind: "none" },
      opened: undefined,
      initialized: { protocolVersion: 1, backendVersion: "1.0.0" },
      audit: true,
      console: true
    });

    expect(state.hasSdk).toBe(false);
  });

  it("the audit and console settings are passed on as they are", () => {
    const state = toSessionState({
      backend: "ready",
      solution: { kind: "none" },
      opened: undefined,
      initialized: withSdk,
      audit: false,
      console: false
    });

    expect(state.audit).toBe(false);
    expect(state.console).toBe(false);
  });
});
