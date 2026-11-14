import type {
  InstalledPackage,
  PackagesInstalledResult,
  PackagesUpdatesResult,
  ProjectInfo
} from "@nuget-code/protocol";
import { describe, expect, it } from "vitest";
import { buildRows, filterRows, sortRows, targetOptions, updateChanges, type RowsInput } from "./model";

const APP = "/work/App/App.csproj";
const LIB = "/work/Lib/Lib.csproj";

const PROJECTS: ProjectInfo[] = [
  { name: "App", path: APP, frameworks: ["net10.0"], centralPackageManagement: false },
  { name: "Lib", path: LIB, frameworks: ["net10.0"], centralPackageManagement: false }
];

function pkg(id: string, requested: string | undefined, resolved?: string, implicit = false): InstalledPackage {
  return {
    id,
    frameworks: ["net10.0"],
    implicit,
    restored: resolved !== undefined,
    ...(requested === undefined ? {} : { requestedVersion: requested }),
    ...(resolved === undefined ? {} : { resolvedVersion: resolved })
  };
}

function installed(app: InstalledPackage[], lib: InstalledPackage[] = []): PackagesInstalledResult {
  return {
    projects: [
      { projectPath: APP, packages: app, transitive: [] },
      { projectPath: LIB, packages: lib, transitive: [] }
    ]
  };
}

function updates(...packages: [id: string, ...versions: [feed: string, version: string][]][]): PackagesUpdatesResult {
  return {
    packages: packages.map(([id, ...versions]) => ({
      id,
      versions: versions.map(([feed, version]) => ({ feed, version }))
    })),
    failures: []
  };
}

function rows(input: Partial<RowsInput> & Pick<RowsInput, "installed">) {
  return buildRows({ projects: PROJECTS, target: null, feed: null, prerelease: false, ...input });
}

describe("buildRows", () => {
  it("a package in several projects is one row with every version", () => {
    const [row] = rows({ installed: installed([pkg("Alpha", "1.2.0", "1.2.0")], [pkg("Alpha", "1.0.0", "1.0.0")]) });

    expect(row).toMatchObject({ id: "Alpha", versions: ["1.0.0", "1.2.0"], implicit: false, restored: true });
    expect(row?.projects.map((use) => use.name)).toEqual(["App", "Lib"]);
  });

  it("the same version in two projects is listed once", () => {
    const [row] = rows({ installed: installed([pkg("Alpha", "1.0.0", "1.0.0")], [pkg("Alpha", "1.0.0", "1.0.0")]) });

    expect(row?.versions).toEqual(["1.0.0"]);
  });

  it("the target limits the projects", () => {
    const result = rows({
      installed: installed([pkg("Alpha", "1.0.0", "1.0.0")], [pkg("Beta", "1.0.0", "1.0.0")]),
      target: LIB
    });

    expect(result.map((row) => row.id)).toEqual(["Beta"]);
  });

  it("ids are merged ignoring case, and so are paths", () => {
    const result = rows({
      installed: installed([pkg("Alpha", "1.0.0", "1.0.0")], [pkg("alpha", "1.0.0", "1.0.0")]),
      target: null
    });
    const forTarget = rows({ installed: installed([pkg("Alpha", "1.0.0", "1.0.0")]), target: APP.toUpperCase() });

    expect(result).toHaveLength(1);
    expect(forTarget).toHaveLength(1);
  });

  it("a newer version on the feed marks an update", () => {
    const [row] = rows({
      installed: installed([pkg("Alpha", "1.0.0", "1.0.0")]),
      updates: updates(["Alpha", ["nuget.org", "2.0.0"]])
    });

    expect(row).toMatchObject({ latest: "2.0.0", hasUpdate: true });
  });

  it("the same version on the feed is not an update", () => {
    const [row] = rows({
      installed: installed([pkg("Alpha", "2.0.0", "2.0.0")]),
      updates: updates(["Alpha", ["nuget.org", "2.0.0"]])
    });

    expect(row).toMatchObject({ latest: "2.0.0", hasUpdate: false });
  });

  it("the comparison uses the resolved version of a floating request", () => {
    const [current] = rows({
      installed: installed([pkg("Alpha", "1.*", "1.2.0")]),
      updates: updates(["Alpha", ["nuget.org", "1.2.0"]])
    });
    const [behind] = rows({
      installed: installed([pkg("Alpha", "1.*", "1.2.0")]),
      updates: updates(["Alpha", ["nuget.org", "2.0.0"]])
    });

    expect(current?.hasUpdate).toBe(false);
    expect(behind?.hasUpdate).toBe(true);
  });

  it("a floating request that was never restored has no update", () => {
    const [row] = rows({
      installed: installed([pkg("Alpha", "1.*")]),
      updates: updates(["Alpha", ["nuget.org", "2.0.0"]])
    });

    expect(row).toMatchObject({ versions: ["1.*"], latest: "2.0.0", hasUpdate: false, restored: false });
  });

  it("a plain request that was never restored is compared by what it asks for", () => {
    const [row] = rows({
      installed: installed([pkg("Alpha", "1.0.0")]),
      updates: updates(["Alpha", ["nuget.org", "2.0.0"]])
    });

    expect(row?.hasUpdate).toBe(true);
  });

  it("pre-release versions count only when asked", () => {
    const input = {
      installed: installed([pkg("Alpha", "1.0.0", "1.0.0")]),
      updates: updates(["Alpha", ["nuget.org", "1.0.0"], ["nightly", "2.0.0-beta"]])
    };

    expect(rows(input)[0]).toMatchObject({ latest: "1.0.0", hasUpdate: false });
    expect(rows({ ...input, prerelease: true })[0]).toMatchObject({ latest: "2.0.0-beta", hasUpdate: true });
  });

  it("a feed filter limits which latest version is considered", () => {
    const input = {
      installed: installed([pkg("Alpha", "1.0.0", "1.0.0")]),
      updates: updates(["Alpha", ["nuget.org", "1.5.0"], ["private", "3.0.0"]])
    };

    expect(rows(input)[0]?.latest).toBe("3.0.0");
    expect(rows({ ...input, feed: "nuget.org" })[0]?.latest).toBe("1.5.0");
    expect(rows({ ...input, feed: "other" })[0]).toMatchObject({ hasUpdate: false });
  });

  it("implicit packages never have an update", () => {
    const [row] = rows({
      installed: installed([pkg("Microsoft.NET.ILLink.Tasks", "10.0.0", "10.0.0", true)]),
      updates: updates(["Microsoft.NET.ILLink.Tasks", ["nuget.org", "11.0.0"]])
    });

    expect(row).toMatchObject({ implicit: true, hasUpdate: false });
  });

  it("a package unknown to every feed has no latest", () => {
    const [row] = rows({ installed: installed([pkg("Alpha", "1.0.0", "1.0.0")]), updates: updates(["Alpha"]) });

    expect(row?.latest).toBeUndefined();
    expect(row?.hasUpdate).toBe(false);
  });

  it("a project the session does not list is named after its file", () => {
    const [row] = buildRows({
      installed: {
        projects: [{ projectPath: "C:\\work\\New\\New.fsproj", packages: [pkg("Alpha", "1.0.0")], transitive: [] }]
      },
      projects: [],
      target: null,
      feed: null,
      prerelease: false
    });

    expect(row?.projects[0]?.name).toBe("New");
  });
});

describe("ordering and filtering", () => {
  const list = rows({
    installed: installed([
      pkg("beta", "1.0.0", "1.0.0"),
      pkg("Alpha", "1.0.0", "1.0.0"),
      pkg("Gamma", "1.0.0", "1.0.0")
    ]),
    updates: updates(["Gamma", ["nuget.org", "2.0.0"]])
  });

  it("smart sort puts updates first, then by id", () => {
    expect(sortRows(list, "smart").map((row) => row.id)).toEqual(["Gamma", "Alpha", "beta"]);
  });

  it("alphabetical sort ignores case and updates", () => {
    expect(sortRows(list, "alphabetical").map((row) => row.id)).toEqual(["Alpha", "beta", "Gamma"]);
  });

  it("filter matches the id anywhere, ignoring case", () => {
    expect(filterRows(list, " MM ").map((row) => row.id)).toEqual(["Gamma"]);
    expect(filterRows(list, "")).toHaveLength(3);
    expect(filterRows(list, "zzz")).toEqual([]);
  });
});

describe("updateChanges", () => {
  it("groups the projects of each selected package", () => {
    const list = rows({
      installed: installed(
        [pkg("Alpha", "1.0.0", "1.0.0"), pkg("Beta", "1.0.0", "1.0.0")],
        [pkg("Alpha", "1.1.0", "1.1.0")]
      ),
      updates: updates(["Alpha", ["nuget.org", "2.0.0"]], ["Beta", ["nuget.org", "3.0.0"]])
    });

    expect(updateChanges(list, new Set(["Alpha"]))).toEqual([
      { kind: "update", id: "Alpha", version: "2.0.0", projects: [APP, LIB] }
    ]);
    expect(updateChanges(list, new Set(["Alpha", "Beta"]))).toHaveLength(2);
    expect(updateChanges(list, new Set())).toEqual([]);
  });

  it("skips a selected package that has no latest version", () => {
    const list = rows({ installed: installed([pkg("Alpha", "1.0.0", "1.0.0")]) });

    expect(updateChanges(list, new Set(["Alpha"]))).toEqual([]);
  });
});

describe("targetOptions", () => {
  it("lists the solution, then each project with the packages that are not implicit", () => {
    const options = targetOptions(
      PROJECTS,
      installed(
        [pkg("Alpha", "1.0.0"), pkg("Sdk", "1.0.0", "1.0.0", true)],
        [pkg("Beta", "1.0.0"), pkg("Gamma", "1.0.0")]
      )
    );

    expect(options).toEqual([
      { value: null, label: "Solution" },
      { value: APP, label: "App", count: 1 },
      { value: LIB, label: "Lib", count: 2 }
    ]);
  });

  it("carries the error of a project that could not be evaluated", () => {
    const broken: ProjectInfo = { ...PROJECTS[0]!, error: "MSB4025" };

    expect(targetOptions([broken], undefined)[1]).toEqual({ value: APP, label: "App", count: 0, error: "MSB4025" });
  });
});
