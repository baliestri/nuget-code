import type { ProjectInfo } from "@nuget-code/protocol";
import { describe, expect, it } from "vitest";
import type { PackageRow, PackageUse } from "./model";
import { projectActions } from "./projectActions";

const APP: ProjectInfo = { name: "App", path: "/work/App.csproj", frameworks: [], centralPackageManagement: false };
const LIB: ProjectInfo = { name: "Lib", path: "/work/Lib.csproj", frameworks: [], centralPackageManagement: false };

function row(...uses: Partial<PackageUse>[]): PackageRow {
  return {
    id: "Alpha",
    versions: [],
    projects: uses.map((use) => ({ path: APP.path, name: "App", restored: true, implicit: false, ...use })),
    implicit: false,
    restored: true,
    hasUpdate: false
  };
}

describe("projectActions", () => {
  it("a project with the package offers update and remove; one without offers install", () => {
    expect(projectActions(row({ resolved: "1.0.0" }), [APP, LIB], "2.0.0")).toEqual([
      { path: APP.path, name: "App", installed: "1.0.0", canInstall: false, canUpdate: true, canRemove: true },
      { path: LIB.path, name: "Lib", canInstall: true, canUpdate: false, canRemove: false }
    ]);
  });

  it("update is not offered when the selected version is the installed one", () => {
    expect(projectActions(row({ resolved: "2.0.0" }), [APP], "2.0.0")[0]).toMatchObject({
      canUpdate: false,
      canRemove: true
    });
  });

  it("the requested version stands in when the project was never restored", () => {
    expect(projectActions(row({ requested: "1.*", restored: false }), [APP], "2.0.0")[0]).toMatchObject({
      installed: "1.*",
      canUpdate: true
    });
  });

  it("without a version nothing is installed or updated, but removing still works", () => {
    expect(projectActions(row({ resolved: "1.0.0" }), [APP, LIB], undefined)).toMatchObject([
      { canUpdate: false, canRemove: true },
      { canInstall: false }
    ]);
  });

  it("an implicit package offers nothing", () => {
    expect(projectActions(row({ resolved: "1.0.0", implicit: true }), [APP], "2.0.0")[0]).toMatchObject({
      canInstall: false,
      canUpdate: false,
      canRemove: false
    });
  });

  it("nothing is installed into a project that could not be evaluated", () => {
    expect(projectActions(undefined, [{ ...APP, error: "MSB4025" }], "1.0.0")[0]?.canInstall).toBe(false);
  });

  it("the projects that have the package come first", () => {
    const actions = projectActions(row({ path: LIB.path, name: "Lib", resolved: "1.0.0" }), [APP, LIB], "2.0.0");

    expect(actions.map((action) => action.name)).toEqual(["Lib", "App"]);
  });

  it("paths are matched ignoring case", () => {
    expect(projectActions(row({ path: APP.path.toUpperCase(), resolved: "1.0.0" }), [APP], "2.0.0")[0]?.installed).toBe(
      "1.0.0"
    );
  });
});
