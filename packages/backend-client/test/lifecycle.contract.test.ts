import type { LogEntry } from "@nuget-code/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { BackendApi, BackendProcess } from "../src/index";
import { expectShape } from "./support/shape";
import { next, resolveTestBackend, startBackend } from "./support/testBackend";
import { TestWorkspace } from "./support/testWorkspace";

describe("lifecycle", () => {
  let workspace: TestWorkspace;

  afterEach(() => workspace.dispose());

  it("initialize reports the protocol version and the SDK", async () => {
    workspace = new TestWorkspace();
    const backend = BackendProcess.start(resolveTestBackend(), workspace.path);
    const api = new BackendApi();
    api.attach(backend.connection);

    const result = await api.initialize({ restoreOnOpen: false });
    await backend.stop(5000);

    expectShape(result, {
      protocolVersion: "number",
      backendVersion: "string",
      "sdk?": { dotnetPath: "string", version: "string" }
    });
    expect(result.protocolVersion).toBe(1);
    expect(result.sdk?.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("stop ends the process within the grace period", async () => {
    workspace = new TestWorkspace();
    const backend = await startBackend(workspace);

    await backend.stop();
    const exit = await backend.process.exited;

    expect(exit.code).toBe(0);
  });

  it("a killed process is observable through exited", async () => {
    workspace = new TestWorkspace();
    const backend = await startBackend(workspace);

    backend.process.kill();
    const exit = await backend.process.exited;

    expect(exit.code !== 0 || exit.signal !== null).toBe(true);
    await backend.stop();
  });

  it("a command that does not exist is reported, not thrown", async () => {
    workspace = new TestWorkspace();
    const backend = BackendProcess.start({ command: workspace.resolve("no-such-backend"), args: [] }, workspace.path);

    const exit = await backend.exited;
    await backend.stop(1000);

    expect(exit.error).toBeInstanceOf(Error);
  });

  it("log entries arrive as notifications", async () => {
    workspace = new TestWorkspace();
    const backend = BackendProcess.start(resolveTestBackend(), workspace.path);
    const api = new BackendApi();
    api.attach(backend.connection);
    const entry = next<LogEntry>((listener) => api.onLogEntry(listener));

    await api.initialize({ restoreOnOpen: false });
    const received = await entry;
    await backend.stop(5000);

    expectShape(received, { level: "string", time: "string", context: "string", message: "string" });
    expect(Number.isNaN(Date.parse(received.time))).toBe(false);
  });
});
