import { existsSync } from "node:fs";
import {
  ErrorCodes,
  RestoreEngines,
  RestoreReasons,
  RestoreStates,
  type RestoreDidFinishParams
} from "@nuget-code/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { ResponseError } from "../src/index";
import { next, startBackend, type RunningBackend } from "./support/testBackend";
import { TestWorkspace } from "./support/testWorkspace";

describe("restore", () => {
  let workspace: TestWorkspace;
  let backend: RunningBackend;

  function prepare(): string {
    workspace = new TestWorkspace();
    workspace.addPackage("Alpha", "1.0.0");
    workspace.writeProject("App", { Alpha: "1.0.0" });
    return workspace.writeSolution("Sample", "App");
  }

  afterEach(async () => {
    await backend.stop();
    workspace.dispose();
  });

  it.each(Object.values(RestoreEngines))("restore/run restores with the %s engine", async (engine) => {
    const solution = prepare();
    backend = await startBackend(workspace);
    await backend.api.openSolution({ path: solution });

    const result = await backend.api.restore({ engine, force: false });

    expect(result.engine).toBe(engine);
    expect(result.fellBack).toBe(false);
    expect(result.projects.map((item) => item.restore)).toEqual([RestoreStates.succeeded]);
    expect(existsSync(workspace.resolve("App", "obj", "project.assets.json"))).toBe(true);
  });

  it("an unknown engine is error 1105", async () => {
    const solution = prepare();
    backend = await startBackend(workspace);
    await backend.api.openSolution({ path: solution });

    const error = await backend.api
      .restore({ engine: "nope" as never, force: false })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ResponseError);
    expect((error as ResponseError<unknown>).code).toBe(ErrorCodes.unknownRestoreEngine);
  });

  it("a configuration change selects the engine of the next restore", async () => {
    const solution = prepare();
    backend = await startBackend(workspace);
    await backend.api.openSolution({ path: solution });

    await backend.api.didChangeConfiguration({ restoreEngine: RestoreEngines.console });
    const result = await backend.api.restore({ force: false });

    expect(result.engine).toBe(RestoreEngines.console);
  });

  it("restore on open reports through restore/didFinish", async () => {
    const solution = prepare();
    backend = await startBackend(workspace, { restoreOnOpen: true });
    const finished = next<RestoreDidFinishParams>((listener) => backend.api.onRestoreDidFinish(listener));

    await backend.api.openSolution({ path: solution });
    const notification = await finished;

    expect(notification.reason).toBe(RestoreReasons.solutionOpen);
    expect(notification.result.projects.map((item) => item.restore)).toEqual([RestoreStates.succeeded]);
  });
});
