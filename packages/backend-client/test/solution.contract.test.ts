import { writeFileSync } from "node:fs";
import { ErrorCodes, type SolutionDidChangeParams } from "@nuget-code/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { ResponseError } from "../src/index";
import { expectShape } from "./support/shape";
import { next, startBackend, type RunningBackend } from "./support/testBackend";
import { project, TestWorkspace } from "./support/testWorkspace";

describe("solution", () => {
  let workspace: TestWorkspace;
  let backend: RunningBackend;

  afterEach(async () => {
    await backend.stop();
    workspace.dispose();
  });

  it("open returns the projects and close ends the session", async () => {
    workspace = new TestWorkspace();
    const app = workspace.writeProject("App", { Alpha: "1.0.0" });
    const solution = workspace.writeSolution("Sample", "App");
    backend = await startBackend(workspace);

    const opened = await backend.api.openSolution({ path: solution });
    await backend.api.closeSolution();
    const afterClose = await backend.api.installedPackages().catch((error: unknown) => error);

    expectShape(opened, {
      path: "string",
      kind: "string",
      projects: [
        {
          name: "string",
          path: "string",
          frameworks: ["string"],
          centralPackageManagement: "boolean",
          "error?": "string"
        }
      ]
    });
    expect(opened.kind).toBe("slnx");
    expect(opened.projects.map((item) => item.path.toLowerCase())).toEqual([app.toLowerCase()]);
    expect(afterClose).toBeInstanceOf(ResponseError);
    expect((afterClose as ResponseError<unknown>).code).toBe(ErrorCodes.noSolutionOpen);
  });

  it("a folder without a solution file opens as an implicit solution", async () => {
    workspace = new TestWorkspace();
    const app = workspace.writeProject("App");
    backend = await startBackend(workspace);

    const opened = await backend.api.openSolution({ path: workspace.path, projects: [app] });

    expect(opened.kind).toBe("implicit");
    expect(opened.projects).toHaveLength(1);
  });

  it("a reported file change produces solution/didChange", async () => {
    workspace = new TestWorkspace();
    const app = workspace.writeProject("App");
    const solution = workspace.writeSolution("Sample", "App");
    backend = await startBackend(workspace);
    await backend.api.openSolution({ path: solution });
    const change = next<SolutionDidChangeParams>((listener) => backend.api.onSolutionDidChange(listener));

    writeFileSync(app, project({ Alpha: "1.0.0" }));
    await backend.api.didChangeFiles({ paths: [app] });
    const received = await change;
    const installed = await backend.api.installedPackages();

    expectShape(received, { projects: ["string"] });
    expect(received.projects.map((item) => item.toLowerCase())).toEqual([app.toLowerCase()]);
    expect(installed.projects[0]?.packages.some((item) => item.id === "Alpha")).toBe(true);
  });
});
