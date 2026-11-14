import { PlanWarningKinds, type OperationResult, type PlanWarningInfo, type RestoreState } from "@nuget-code/protocol";
import { describe, expect, it } from "vitest";
import { summarizeResult } from "../state/operation";
import { describeWarning } from "./warnings";

function warning(kind: string, extra: Partial<PlanWarningInfo> = {}): PlanWarningInfo {
  return { kind: kind as PlanWarningInfo["kind"], packageId: "Alpha", projects: [], packages: [], ...extra };
}

describe("describeWarning", () => {
  it.each(Object.values(PlanWarningKinds))("%s has a sentence that names the package", (kind) => {
    const text = describeWarning(
      warning(kind, {
        file: "/work/Directory.Packages.props",
        projects: ["/work/App/App.csproj", "/work/Lib/Lib.csproj"],
        packages: ["Beta"],
        detail: "detail"
      })
    );

    expect(text).toMatch(/^Alpha: /);
    expect(text.endsWith(".")).toBe(true);
  });

  it("a shared central version names the file and the projects", () => {
    expect(
      describeWarning(
        warning(PlanWarningKinds.centralShared, {
          file: "/work/Directory.Packages.props",
          projects: ["/work/App/App.csproj", "C:\\work\\Lib\\Lib.csproj"]
        })
      )
    ).toBe("Alpha: the version in Directory.Packages.props is shared, so it changed for App, Lib.");
  });

  it("a shared property names the property and the other packages", () => {
    const text = describeWarning(
      warning(PlanWarningKinds.propertyShared, {
        file: "/work/App.csproj",
        packages: ["Beta", "Gamma"],
        detail: "LibVersion"
      })
    );

    expect(text).toContain("LibVersion");
    expect(text).toContain("Beta, Gamma");
  });

  it("a framework mismatch names the frameworks and the project", () => {
    const text = describeWarning(
      warning(PlanWarningKinds.frameworkMismatch, { projects: ["/work/App/App.csproj"], detail: "net10.0" })
    );

    expect(text).toContain("net10.0");
    expect(text).toContain("App");
  });

  it("a long list of projects is cut short", () => {
    const projects = ["A", "B", "C", "D", "E"].map((name) => `/work/${name}/${name}.csproj`);

    expect(
      describeWarning(warning(PlanWarningKinds.importedShared, { file: "/work/Directory.Build.props", projects }))
    ).toContain("A, B, C and 2 more");
  });

  it("a kind it does not know is still reported", () => {
    expect(describeWarning(warning("somethingNew", { detail: "x" }))).toBe("Alpha: somethingNew (x).");
  });
});

describe("summarizeResult", () => {
  function result(...states: [RestoreState, editErrors?: number][]): OperationResult {
    return {
      fellBack: false,
      projects: states.map(([restore, editErrors = 0], index) => ({
        project: `P${index}`,
        changedFiles: [],
        editErrors: Array.from({ length: editErrors }, () => "error"),
        restore,
        messages: []
      }))
    };
  }

  it("counts failures, edit errors and cancellation", () => {
    expect(summarizeResult(result(["succeeded"], ["failed"], ["notRun", 1], ["cancelled"]))).toEqual({
      total: 4,
      failed: 1,
      editErrors: 1,
      cancelled: true
    });
  });

  it("a clean result has nothing to report", () => {
    expect(summarizeResult(result(["succeeded"], ["succeededWithWarnings"]))).toEqual({
      total: 2,
      failed: 0,
      editErrors: 0,
      cancelled: false
    });
  });
});
