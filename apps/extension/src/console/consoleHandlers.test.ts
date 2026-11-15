import { BackendStoppedError, Emitter, ResponseError } from "@nuget-code/backend-client";
import type { OperationProgressParams, OperationResult, ProjectInfo } from "@nuget-code/protocol";
import { describe, expect, it } from "vitest";
import { createConsoleHandlers, type ConsoleHandlerDeps } from "./consoleHandlers";

const APP: ProjectInfo = {
  name: "App",
  path: "/work/App/App.csproj",
  frameworks: ["net10.0"],
  centralPackageManagement: false
};
const LIB: ProjectInfo = {
  name: "Lib",
  path: "/work/Lib/Lib.csproj",
  frameworks: ["net8.0"],
  centralPackageManagement: true
};
const DONE: OperationResult = { fellBack: false, projects: [] };

function setup(options: { projects?: readonly ProjectInfo[] | null; platform?: string; picked?: string } = {}) {
  const calls: [string, unknown][] = [];
  const steps = new Emitter<OperationProgressParams>();
  const record =
    <T>(name: string, result: T) =>
    (params?: unknown): Promise<T> => {
      calls.push([name, params]);
      return Promise.resolve(result);
    };
  const api: ConsoleHandlerDeps["api"] = {
    installedPackages: record("installed", { projects: [] }),
    packageUpdates: record("updates", { packages: [], failures: [] }),
    searchPackages: record("search", { packages: [], failures: [] }),
    packageDetails: record("details", {
      id: "Alpha",
      versions: [],
      dependencyGroups: [],
      failures: [],
      vulnerableVersions: []
    }),
    packageVulnerabilities: record("vulnerabilities", { packages: [], failures: [] }),
    planPackages: record("plan", { edits: [], warnings: [] }),
    installPackage: record("install", DONE),
    updatePackages: record("update", DONE),
    removePackage: record("remove", DONE),
    restore: record("restore", DONE),
    listSources: record("sources", {
      files: [],
      effective: [
        {
          name: "nuget.org",
          source: "https://api.nuget.org/v3/index.json",
          enabled: true,
          allowInsecureConnections: false,
          protocolVersion: 3,
          isLocal: false,
          disableTlsCertificateValidation: false,
          isMachineWide: false
        }
      ],
      fallbackFolders: [],
      globalPackagesFolder: "/packages"
    }),
    cancelOperation: async () => {
      await record("cancel", undefined)();
    },
    onOperationProgress: (listener) => steps.on(listener)
  };
  const picks: [readonly string[], string | undefined][] = [];
  const handlers = createConsoleHandlers({
    api,
    projects: () => (options.projects === null ? undefined : (options.projects ?? [APP, LIB])),
    pickProject: (projects, current) => {
      picks.push([projects.map((project) => project.name), current]);
      return Promise.resolve(options.picked);
    },
    platform: options.platform ?? "linux"
  });
  return { api, calls, handlers, picks, steps };
}

const nothing = (): void => {};

describe("the requests of the console", () => {
  it("the projects are the ones of the open solution, without what the console does not need", async () => {
    const { handlers } = setup();

    expect(await handlers.projects({}, nothing)).toEqual({
      projects: [
        { name: "App", path: APP.path, frameworks: ["net10.0"] },
        { name: "Lib", path: LIB.path, frameworks: ["net8.0"] }
      ]
    });
  });

  it("a read is answered with what the backend says, never asking it to skip its cache", async () => {
    const { calls, handlers } = setup();

    expect(await handlers.installed({}, nothing)).toEqual({ projects: [] });
    await handlers.updates({ prerelease: true, transitive: false }, nothing);
    await handlers.details({ id: "Alpha", prerelease: false }, nothing);
    await handlers.vulnerabilities({}, nothing);
    await handlers.search({ query: "json", prerelease: false, skip: 0, take: 20 }, nothing);

    expect(calls).toEqual([
      ["installed", undefined],
      ["updates", { prerelease: true, transitive: false, noCache: false }],
      ["details", { id: "Alpha", prerelease: false, noCache: false }],
      ["vulnerabilities", { noCache: false }],
      ["search", { query: "json", prerelease: false, skip: 0, take: 20 }]
    ]);
  });

  it("the sources are the effective ones, by name, address and whether they are enabled", async () => {
    const { handlers } = setup();

    expect(await handlers.sources({}, nothing)).toEqual({
      sources: [{ name: "nuget.org", source: "https://api.nuget.org/v3/index.json", enabled: true }]
    });
  });

  it("a change passes on the steps the backend announces while it runs, and no longer after", async () => {
    const { api, handlers, steps } = setup();
    const seen: OperationProgressParams[] = [];
    api.installPackage = async () => {
      steps.fire({ step: "planning" });
      await Promise.resolve();
      steps.fire({ step: "done" });
      return DONE;
    };

    const result = await handlers.install({ id: "Alpha", version: "1.0.0", projects: [APP.path] }, (step) =>
      seen.push(step)
    );
    steps.fire({ step: "editing" });

    expect(result).toBe(DONE);
    expect(seen).toEqual([{ step: "planning" }, { step: "done" }]);
  });

  it("every change is passed to the backend with the projects as the solution has them", async () => {
    const { calls, handlers } = setup({ platform: "win32", projects: [{ ...APP, path: "D:\\Work\\App.csproj" }] });
    const lower = "d:\\work\\app.csproj";
    const change = { kind: "update" as const, id: "Alpha", version: "2.0.0", projects: [lower] };

    await handlers.install({ id: "Alpha", version: "1.0.0", projects: [lower] }, nothing);
    await handlers.update({ changes: [change] }, nothing);
    await handlers.remove({ id: "Alpha", projects: [lower] }, nothing);
    await handlers.restore({ force: true, projects: [lower] }, nothing);
    await handlers.restore({ force: false }, nothing);
    await handlers.plan({ changes: [change] }, nothing);

    const projects = ["D:\\Work\\App.csproj"];
    expect(calls).toEqual([
      ["install", { id: "Alpha", version: "1.0.0", projects }],
      ["update", { changes: [{ ...change, projects }] }],
      ["remove", { id: "Alpha", projects }],
      ["restore", { force: true, projects }],
      ["restore", { force: false }],
      ["plan", { changes: [{ ...change, projects }] }]
    ]);
  });

  it("a project that is not of the open solution is refused, and the backend is not asked", async () => {
    const { calls, handlers } = setup();
    const other = "/elsewhere/Other.csproj";

    await expect(handlers.install({ id: "Alpha", version: "1.0.0", projects: [other] }, nothing)).rejects.toMatchObject(
      {
        code: "invalidParams",
        message: `Not a project of the open solution: ${other}`
      }
    );
    await expect(handlers.remove({ id: "Alpha", projects: [APP.path, other] }, nothing)).rejects.toMatchObject({
      code: "invalidParams"
    });
    await expect(handlers.restore({ force: false, projects: [APP.path.toUpperCase()] }, nothing)).rejects.toMatchObject(
      {
        code: "invalidParams"
      }
    );
    expect(calls).toEqual([]);
  });

  it("cancel asks the backend to cancel the running operation", async () => {
    const { calls, handlers } = setup();

    expect(await handlers.cancel({}, nothing)).toEqual({});
    expect(calls).toEqual([["cancel", undefined]]);
  });

  it("pickProject shows the projects and returns the chosen one", async () => {
    const { handlers, picks } = setup({ picked: LIB.path });

    expect(await handlers.pickProject({ current: APP.path }, nothing)).toEqual({ path: LIB.path });
    expect(picks).toEqual([[["App", "Lib"], APP.path]]);
  });

  it("pickProject returns nothing when the list is dismissed", async () => {
    const { handlers } = setup();

    expect(await handlers.pickProject({}, nothing)).toEqual({});
  });

  it("without an open solution every request says so, and the backend is not asked", async () => {
    const { calls, handlers } = setup({ projects: null });
    const noSolution = { code: "noSolution", message: "No solution is open in the editor." };

    await expect(handlers.projects({}, nothing)).rejects.toMatchObject(noSolution);
    await expect(handlers.pickProject({}, nothing)).rejects.toMatchObject(noSolution);
    await expect(handlers.installed({}, nothing)).rejects.toMatchObject(noSolution);
    await expect(handlers.sources({}, nothing)).rejects.toMatchObject(noSolution);
    await expect(handlers.cancel({}, nothing)).rejects.toMatchObject(noSolution);
    await expect(
      handlers.install({ id: "Alpha", version: "1.0.0", projects: [APP.path] }, nothing)
    ).rejects.toMatchObject(noSolution);
    expect(calls).toEqual([]);
  });

  it("an error of the backend, and a backend that is not running, are said as such", async () => {
    const { api, handlers } = setup();
    api.installedPackages = () => Promise.reject(new ResponseError(1005, "The feed did not answer."));
    api.listSources = () => Promise.reject(new BackendStoppedError());

    await expect(handlers.installed({}, nothing)).rejects.toMatchObject({
      code: "backend",
      message: "The feed did not answer."
    });
    await expect(handlers.sources({}, nothing)).rejects.toMatchObject({
      code: "stopped",
      message: "The NuGet backend is not running."
    });
  });
});
