import {
  BridgeClient,
  BridgeError,
  BridgeServer,
  type BackendMethod,
  type BackendMethods,
  type BridgeEvent,
  type BridgeEvents,
  type Channel,
  type HostRequest,
  type HostRequests,
  type SessionState
} from "@nuget-code/bridge";

type BackendFakes = {
  [M in BackendMethod]?: (params: BackendMethods[M]["params"]) => Promise<BackendMethods[M]["result"]>;
};

type HostFakes = {
  [M in HostRequest]?: (params: HostRequests[M]["params"]) => Promise<HostRequests[M]["result"]>;
};

export interface FakeCall {
  kind: "backend" | "host";
  method: string;
  params: unknown;
}

export interface FakeBridge {
  client: BridgeClient;
  /** Replace an entry to decide what a backend method answers. A method without one fails. */
  backend: BackendFakes;
  /** Replace an entry to decide what a host request answers. A request without one answers with nothing. */
  host: HostFakes;
  /** Every request the view made, in order. */
  calls: FakeCall[];
  callsOf(method: string): unknown[];
  emit<E extends BridgeEvent>(event: E, payload: BridgeEvents[E]): void;
  /** How many times the view said it was ready. */
  readyCount(): number;
}

export const READY: SessionState = {
  backend: "ready",
  solution: { kind: "none" },
  hasSdk: true,
  audit: true,
  console: true
};

/**
 * A bridge whose host side is in the same process: the real client and server, over a channel in memory,
 * with the handlers of the host replaced by fakes. `session` is what the host reports when the view says
 * it is ready; `null` reports nothing.
 */
export function createFakeBridge(session: SessionState | null = READY): FakeBridge {
  const viewListeners = new Set<(message: unknown) => void>();
  const hostListeners = new Set<(message: unknown) => void>();
  const channel = (mine: Set<(message: unknown) => void>, theirs: Set<(message: unknown) => void>): Channel => ({
    post: (message) => queueMicrotask(() => theirs.forEach((listener) => listener(structuredClone(message)))),
    onMessage: (listener) => {
      mine.add(listener);
      return { dispose: () => mine.delete(listener) };
    }
  });

  let ready = 0;
  const fake: FakeBridge = {
    client: new BridgeClient(channel(viewListeners, hostListeners)),
    backend: {},
    host: {},
    calls: [],
    callsOf: (method) => fake.calls.filter((call) => call.method === method).map((call) => call.params),
    emit: (event, payload) => server.emit(event, payload),
    readyCount: () => ready
  };
  const server = new BridgeServer(
    channel(hostListeners, viewListeners),
    {
      backend: (method, params) => {
        fake.calls.push({ kind: "backend", method, params });
        const handler = fake.backend[method] as ((params: unknown) => Promise<unknown>) | undefined;
        return handler === undefined
          ? Promise.reject(new BridgeError({ kind: "host", message: `The test did not fake '${method}'.` }))
          : handler(params);
      },
      host: (method, params) => {
        fake.calls.push({ kind: "host", method, params });
        const handler = fake.host[method] as ((params: unknown) => Promise<unknown>) | undefined;
        return handler === undefined ? Promise.resolve({}) : handler(params);
      }
    },
    () => {
      ready++;
      if (session !== null) {
        server.emit("session", session);
      }
    }
  );
  return fake;
}

/** A place for the preferences that lives in memory. */
export function createMemoryStorage(initial?: unknown): { get(): unknown; set(value: unknown): void } {
  let state = initial;
  return { get: () => state, set: (value) => (state = value) };
}
