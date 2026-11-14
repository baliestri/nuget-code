import { readFileSync } from "node:fs";
import { OperationSteps, PackageChangeKinds, RestoreStates, type OperationProgressParams } from "@nuget-code/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectShape, type Shape } from "./support/shape";
import { startBackend, type RunningBackend } from "./support/testBackend";
import { TestWorkspace } from "./support/testWorkspace";

const failures: Shape = [{ feed: "string", kind: "string", message: "string" }];

const operationResult: Shape = {
  "engine?": "string",
  fellBack: "boolean",
  projects: [
    {
      project: "string",
      changedFiles: ["string"],
      editErrors: ["string"],
      restore: "string",
      messages: [{ level: "string", "code?": "string", message: "string" }]
    }
  ]
};

describe("packages", () => {
  let workspace: TestWorkspace;
  let backend: RunningBackend;
  let app: string;

  beforeEach(async () => {
    workspace = new TestWorkspace();
    workspace.addPackage("Alpha", "1.0.0");
    workspace.addPackage("Alpha", "2.0.0");
    workspace.addPackage("Beta", "1.0.0");
    app = workspace.writeProject("App", { Alpha: "1.0.0" });
    const solution = workspace.writeSolution("Sample", "App");
    backend = await startBackend(workspace);
    await backend.api.openSolution({ path: solution });
  });

  afterEach(async () => {
    await backend.stop();
    workspace.dispose();
  });

  it("installed has the documented shape", async () => {
    const installed = await backend.api.installedPackages();

    expectShape(installed, {
      projects: [
        {
          projectPath: "string",
          packages: [
            {
              id: "string",
              "requestedVersion?": "string",
              "resolvedVersion?": "string",
              frameworks: ["string"],
              implicit: "boolean",
              restored: "boolean",
              "origin?": { kind: "string", "file?": "string", "line?": "number", "column?": "number" }
            }
          ],
          transitive: [{ id: "string", resolvedVersion: "string", frameworks: ["string"], via: ["string"] }]
        }
      ]
    });
    const alpha = installed.projects[0]?.packages.find((item) => item.id === "Alpha");
    expect(alpha?.requestedVersion).toBe("1.0.0");
    expect(alpha?.origin?.kind).toBe("project");
    // Not restored yet: what comes with the packages is not known.
    expect(installed.projects[0]?.transitive).toEqual([]);
  });

  it("a restored project lists its transitive packages, and their newest versions are asked for apart", async () => {
    workspace.addPackage("Inner", "1.0.0");
    workspace.addPackage("Inner", "2.0.0");
    workspace.addPackage("Outer", "1.0.0", { Inner: "1.0.0" });
    await backend.api.installPackage({ id: "Outer", version: "1.0.0", projects: [app] });

    const installed = await backend.api.installedPackages();
    const direct = await backend.api.packageUpdates({ prerelease: false, noCache: false });
    const transitive = await backend.api.packageUpdates({ prerelease: false, noCache: false, transitive: true });

    expect(installed.projects[0]?.transitive).toEqual([
      { id: "Inner", resolvedVersion: "1.0.0", frameworks: ["net10.0"], via: ["Outer"] }
    ]);
    expect(direct.packages.map((item) => item.id)).toEqual(["Alpha", "Outer"]);
    expect(transitive.packages).toEqual([{ id: "Inner", versions: [{ feed: "local", version: "2.0.0" }] }]);
  });

  it("search, details and updates have the documented shape", async () => {
    const search = await backend.api.searchPackages({ query: "Alpha", prerelease: false, skip: 0, take: 10 });
    const details = await backend.api.packageDetails({ id: "Alpha", prerelease: false, noCache: false });
    const updates = await backend.api.packageUpdates({ prerelease: false, noCache: false });

    expectShape(search, {
      packages: [
        {
          id: "string",
          version: "string",
          "description?": "string",
          "authors?": "string",
          "iconUrl?": "string",
          "downloadCount?": "number",
          feed: "string"
        }
      ],
      failures
    });
    expectShape(details, {
      id: "string",
      versions: ["string"],
      "description?": "string",
      "authors?": "string",
      "license?": "string",
      "licenseUrl?": "string",
      "projectUrl?": "string",
      "iconUrl?": "string",
      dependencyGroups: [{ framework: "string", dependencies: [{ id: "string", range: "string" }] }],
      "feed?": "string",
      failures
    });
    expectShape(updates, {
      packages: [{ id: "string", versions: [{ feed: "string", version: "string" }] }],
      failures
    });
    expect(search.packages.map((item) => item.id)).toEqual(["Alpha"]);
    expect(details.versions).toEqual(["2.0.0", "1.0.0"]);
    expect(updates.packages[0]?.versions[0]?.version).toBe("2.0.0");
  });

  it("plan describes the edit without writing it", async () => {
    const before = readFileSync(app, "utf8");

    const plan = await backend.api.planPackages({
      changes: [{ kind: PackageChangeKinds.update, id: "Alpha", version: "2.0.0", projects: [app] }]
    });

    expectShape(plan, {
      edits: [{ file: "string", line: "number", oldText: "string", newText: "string" }],
      warnings: [
        {
          kind: "string",
          packageId: "string",
          "file?": "string",
          projects: ["string"],
          packages: ["string"],
          "detail?": "string"
        }
      ]
    });
    expect(plan.edits).toEqual([{ file: plan.edits[0]?.file, line: 6, oldText: "1.0.0", newText: "2.0.0" }]);
    expect(readFileSync(app, "utf8")).toBe(before);
  });

  it("install, update and remove return an operation result and report progress", async () => {
    const steps: string[] = [];
    backend.api.onOperationProgress((progress: OperationProgressParams) => steps.push(progress.step));

    const updated = await backend.api.updatePackages({
      changes: [{ kind: PackageChangeKinds.update, id: "Alpha", version: "2.0.0", projects: [app] }]
    });
    const stepsOfUpdate = [...steps];
    const installed = await backend.api.installPackage({ id: "Beta", version: "1.0.0", projects: [app] });
    const afterInstall = readFileSync(app, "utf8");
    const removed = await backend.api.removePackage({ id: "Beta", projects: [app] });

    for (const result of [updated, installed, removed]) {
      expectShape(result, operationResult);
      expect(result.projects.map((item) => item.restore)).toEqual([RestoreStates.succeeded]);
      expect(result.engine).toBe("embedded");
    }
    expect(stepsOfUpdate).toEqual(Object.values(OperationSteps));
    expect(afterInstall).toContain('<PackageReference Include="Alpha" Version="2.0.0" />');
    expect(afterInstall).toContain('<PackageReference Include="Beta" Version="1.0.0" />');
    expect(readFileSync(app, "utf8")).not.toContain("Beta");
  });
});
