import { describe, expect, it } from "vitest";
import {
  ALLOWED_BACKEND_METHODS,
  BridgeClient,
  BridgeError,
  BridgeServer,
  type BridgeHandlers,
  type Channel,
  type Message
} from "./index";

type Listener = (message: unknown) => void;

/** Two channels joined in memory. Delivery is asynchronous, as `postMessage` is. */
function pair(): { view: Channel; host: Channel; sentToView: Message[]; inject(message: unknown): void } {
  const viewListeners = new Set<Listener>();
  const hostListeners = new Set<Listener>();
  const sentToView: Message[] = [];
  const channel = (mine: Set<Listener>, theirs: Set<Listener>, record?: Message[]): Channel => ({
    post: (message) => {
      record?.push(message);
      queueMicrotask(() => theirs.forEach((listener) => listener(structuredClone(message))));
    },
    onMessage: (listener) => {
      mine.add(listener);
      return { dispose: () => mine.delete(listener) };
    }
  });
  return {
    view: channel(viewListeners, hostListeners),
    host: channel(hostListeners, viewListeners, sentToView),
    sentToView,
    inject: (message) => hostListeners.forEach((listener) => listener(message))
  };
}

function connect(handlers: Partial<BridgeHandlers> = {}) {
  const channels = pair();
  const calls: { kind: string; method: string; params: unknown }[] = [];
  let readyCalls = 0;
  const server = new BridgeServer(
    channels.host,
    {
      backend: (method, params) => {
        calls.push({ kind: "backend", method, params });
        return handlers.backend?.(method, params) ?? Promise.resolve({});
      },
      host: (method, params) => {
        calls.push({ kind: "host", method, params });
        return handlers.host?.(method, params) ?? Promise.resolve({});
      }
    },
    () => readyCalls++
  );
  return { client: new BridgeClient(channels.view), server, calls, channels, readyCalls: () => readyCalls };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("requests", () => {
  it("a backend request resolves with the handler's result", async () => {
    const { client, calls } = connect({ backend: () => Promise.resolve({ folders: [] }) });

    const result = await client.backend("listFolders", {});

    expect(result).toEqual({ folders: [] });
    expect(calls).toEqual([{ kind: "backend", method: "listFolders", params: {} }]);
  });

  it("concurrent requests are matched by id", async () => {
    const release: (() => void)[] = [];
    const { client } = connect({
      backend: (method) =>
        new Promise((resolve) => {
          const answer = (): void => resolve({ method });
          if (method === "listFolders") {
            release.push(answer);
          } else {
            answer();
          }
        })
    });

    const slow = client.backend("listFolders", {});
    const fast = client.backend("listSources", {});
    expect(await fast).toEqual({ method: "listSources" });
    release.forEach((answer) => answer());

    expect(await slow).toEqual({ method: "listFolders" });
  });

  it("a handler error reaches the client as a BridgeError", async () => {
    const { client } = connect({
      backend: () =>
        Promise.reject(new BridgeError({ kind: "backend", code: 1108, message: "duplicate", data: "details" }))
    });

    const error = await client.backend("addSource", { name: "x", source: "y" }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({ kind: "backend", code: 1108, message: "duplicate", data: "details" });
  });

  it("an error that is not a BridgeError is reported as a host error", async () => {
    const { client } = connect({ host: () => Promise.reject(new Error("no window")) });

    const error = await client.host("showLog", {}).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ kind: "host", message: "no window" });
  });

  it("host requests go to the host handler", async () => {
    const { client, calls } = connect({ host: () => Promise.resolve({ path: "/chosen" }) });

    const result = await client.host("pickFolder", { title: "Choose" });

    expect(result).toEqual({ path: "/chosen" });
    expect(calls).toEqual([{ kind: "host", method: "pickFolder", params: { title: "Choose" } }]);
  });

  it("a handler that resolves with nothing answers with an empty object", async () => {
    const { client } = connect({ host: () => Promise.resolve(undefined) });

    expect(await client.host("showLog", {})).toEqual({});
  });
});

describe("what the host refuses and ignores", () => {
  it.each(["openSolution", "initialize", "shutdown", "constructor", "__proto__", "toString"])(
    "the backend method %s is refused without reaching the handler",
    async (method) => {
      const { client, calls } = connect();

      const error = await client.backend(method as never, {} as never).catch((reason: unknown) => reason);

      expect(error).toMatchObject({ kind: "refused" });
      expect(calls).toEqual([]);
    }
  );

  it("an unknown host request is refused", async () => {
    const { client, calls } = connect();

    const error = await client.host("runCommand" as never, {} as never).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ kind: "refused" });
    expect(calls).toEqual([]);
  });

  it.each([null, "text", 5, {}, { type: "backend" }, { type: "nope", id: 1 }, { type: "backend", id: "1" }])(
    "a malformed message (%j) is ignored",
    async (message) => {
      const { calls, channels } = connect();

      channels.inject(message);
      await settle();

      expect(calls).toEqual([]);
      expect(channels.sentToView).toEqual([]);
    }
  );

  it("the allowed list has every backend method the view uses and none that control the session", () => {
    expect(ALLOWED_BACKEND_METHODS).toContain("installedPackages");
    expect(ALLOWED_BACKEND_METHODS).toContain("clearFolders");
    expect(ALLOWED_BACKEND_METHODS).toContain("packageVulnerabilities");
    expect(ALLOWED_BACKEND_METHODS).toHaveLength(19);
    for (const method of ["initialize", "shutdown", "openSolution", "closeSolution", "resetCredentials"]) {
      expect(ALLOWED_BACKEND_METHODS).not.toContain(method);
    }
  });
});

describe("events and readiness", () => {
  it("events reach every listener and stop after dispose", async () => {
    const { client, server } = connect();
    const first: string[] = [];
    const second: string[] = [];
    const subscription = client.on("solutionDidChange", (change) => first.push(...change.projects));
    client.on("solutionDidChange", (change) => second.push(...change.projects));

    server.emit("solutionDidChange", { projects: ["A"] });
    await settle();
    subscription.dispose();
    server.emit("solutionDidChange", { projects: ["B"] });
    await settle();

    expect(first).toEqual(["A"]);
    expect(second).toEqual(["A", "B"]);
  });

  it("an event nobody listens to is dropped", async () => {
    const { server } = connect();

    server.emit("logEntry", { level: "info", time: "t", context: "NUGET", message: "m" });

    await expect(settle()).resolves.toBeUndefined();
  });

  it("ready calls onReady once", async () => {
    const { client, readyCalls } = connect();

    client.ready();
    client.ready();
    await settle();

    expect(readyCalls()).toBe(1);
  });

  it("a result for an unknown id and messages that are not the bridge's are ignored by the client", async () => {
    const channels = pair();
    const client = new BridgeClient(channels.view);
    const pending = client.backend("listFolders", {});

    channels.host.post({ type: "result", id: 999, result: {} });
    channels.host.post("noise" as never);
    channels.host.post({ type: "result", id: 1, result: { folders: [] } });

    await expect(pending).resolves.toEqual({ folders: [] });
  });

  it("a disposed server answers nothing", async () => {
    const { client, server, calls } = connect();
    server.dispose();

    void client.backend("listFolders", {});
    await settle();

    expect(calls).toEqual([]);
  });
});
