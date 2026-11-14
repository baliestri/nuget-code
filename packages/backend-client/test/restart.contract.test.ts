import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  BackendClient,
  BackendRestartedError,
  BackendStoppedError,
  RestartPolicy,
  type BackendState
} from "../src/index";
import { resolveTestBackend } from "./support/testBackend";
import { TestWorkspace } from "./support/testWorkspace";

interface Supervised {
  client: BackendClient;
  starts: () => number;
}

function supervise(workspace: TestWorkspace, policy?: RestartPolicy): Supervised {
  let starts = 0;
  const client = new BackendClient({
    launch: resolveTestBackend,
    cwd: workspace.path,
    onStarted: async (api) => {
      starts++;
      await api.initialize({ restoreOnOpen: false });
    },
    ...(policy === undefined ? {} : { policy })
  });
  return { client, starts: () => starts };
}

/** Resolves once the client is in the state, which it may already be. */
function reaches(client: BackendClient, state: BackendState): Promise<void> {
  if (client.state === state) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The backend did not become ${state}.`)), 60_000);
    const subscription = client.onDidChangeState((current) => {
      if (current === state) {
        clearTimeout(timer);
        subscription.dispose();
        resolve();
      }
    });
  });
}

/** Kills the process the way a crash would and waits for the client to notice. */
async function crash(client: BackendClient, then: BackendState): Promise<void> {
  const left = new Promise<void>((resolve) => {
    const subscription = client.onDidChangeState(() => {
      subscription.dispose();
      resolve();
    });
  });
  process.kill(client.pid!);
  await left;
  await reaches(client, then);
}

describe("restart", () => {
  let workspace: TestWorkspace;
  let client: BackendClient;

  afterEach(async () => {
    await client.dispose();
    workspace.dispose();
  });

  it("a killed backend comes back and onStarted runs again", async () => {
    workspace = new TestWorkspace();
    const supervised = supervise(workspace);
    client = supervised.client;
    await client.start();
    const first = client.pid;

    await crash(client, "ready");
    const folders = await client.api.listFolders();

    expect(supervised.starts()).toBe(2);
    expect(client.pid).not.toBe(first);
    expect(folders.folders.length).toBeGreaterThan(0);
  });

  it("a request in flight fails with BackendRestartedError", async () => {
    workspace = new TestWorkspace();
    // A feed that accepts the connection and never answers keeps the request waiting.
    const silent = createServer(() => {});
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const port = (silent.address() as AddressInfo).port;
    workspace.writeSources(
      `    <add key="silent" value="http://localhost:${port}/v3/index.json" allowInsecureConnections="true" />`
    );
    client = supervise(workspace).client;
    await client.start();
    try {
      const waiting = client.api
        .searchPackages({ query: "Alpha", feed: "silent", prerelease: false, skip: 0, take: 10 })
        .catch((reason: unknown) => reason);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await crash(client, "ready");

      expect(await waiting).toBeInstanceOf(BackendRestartedError);
    } finally {
      silent.closeAllConnections();
      silent.close();
    }
  });

  it("listeners survive a restart", async () => {
    workspace = new TestWorkspace();
    client = supervise(workspace).client;
    const messages: string[] = [];
    client.api.onLogEntry((entry) => messages.push(entry.message));
    await client.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const beforeCrash = messages.length;

    await crash(client, "ready");
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(beforeCrash).toBeGreaterThan(0);
    expect(messages.length).toBeGreaterThan(beforeCrash);
  });

  it("three crashes inside the window stop the client", async () => {
    workspace = new TestWorkspace();
    const supervised = supervise(workspace, new RestartPolicy(3, 60_000));
    client = supervised.client;
    await client.start();

    await crash(client, "ready");
    await crash(client, "ready");
    await crash(client, "stopped");
    const error = await client.api.listFolders().catch((reason: unknown) => reason);

    expect(supervised.starts()).toBe(3);
    expect(client.state).toBe("stopped");
    expect(error).toBeInstanceOf(BackendStoppedError);
  });

  it("restart on request does not count as a crash", async () => {
    workspace = new TestWorkspace();
    const supervised = supervise(workspace, new RestartPolicy(3, 60_000));
    client = supervised.client;
    await client.start();

    await client.restart();
    await client.restart();
    await client.restart();
    await crash(client, "ready");

    expect(supervised.starts()).toBe(5);
    expect(client.state).toBe("ready");
  });

  it("a stopped client can be started again by a restart", async () => {
    workspace = new TestWorkspace();
    const supervised = supervise(workspace, new RestartPolicy(1, 60_000));
    client = supervised.client;
    await client.start();
    await crash(client, "stopped");

    await client.restart();

    expect(client.state).toBe("ready");
    expect((await client.api.listFolders()).folders.length).toBeGreaterThan(0);
  });

  it("dispose stops the process and nothing restarts", async () => {
    workspace = new TestWorkspace();
    const supervised = supervise(workspace);
    client = supervised.client;
    await client.start();
    const pid = client.pid!;

    await client.dispose();
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(() => process.kill(pid, 0)).toThrow();
    expect(supervised.starts()).toBe(1);
    expect(client.state).toBe("stopped");
  });

  it("a backend that cannot be started rejects start and leaves the client stopped", async () => {
    workspace = new TestWorkspace();
    client = new BackendClient({
      launch: () => ({ command: workspace.resolve("no-such-backend"), args: [] }),
      cwd: workspace.path,
      onStarted: async (api) => {
        await api.initialize({});
      }
    });

    const error = await client.start().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(client.state).toBe("stopped");
  });
});
