import type { BackendMethod, BackendMethods } from "./backendMethods";
import { BridgeError } from "./errors";
import {
  isMessage,
  type BridgeEvent,
  type BridgeEvents,
  type Channel,
  type HostRequest,
  type HostRequests
} from "./messages";

interface Pending {
  resolve(result: unknown): void;
  reject(error: BridgeError): void;
}

/** The view's side of the bridge. */
export class BridgeClient {
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<(payload: never) => void>>();
  private readonly subscription: { dispose(): void };
  private nextId = 1;

  constructor(private readonly channel: Channel) {
    this.subscription = channel.onMessage((message) => this.receive(message));
  }

  /** Calls a backend method through the host. Rejects with a `BridgeError`. */
  backend<M extends BackendMethod>(
    method: M,
    params: BackendMethods[M]["params"]
  ): Promise<BackendMethods[M]["result"]> {
    return this.request("backend", method, params) as Promise<BackendMethods[M]["result"]>;
  }

  /** Asks the host to do something only it can do. Rejects with a `BridgeError`. */
  host<M extends HostRequest>(method: M, params: HostRequests[M]["params"]): Promise<HostRequests[M]["result"]> {
    return this.request("host", method, params) as Promise<HostRequests[M]["result"]>;
  }

  on<E extends BridgeEvent>(event: E, listener: (payload: BridgeEvents[E]) => void): { dispose(): void } {
    let listeners = this.listeners.get(event);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }

    listeners.add(listener as (payload: never) => void);
    return { dispose: () => listeners.delete(listener as (payload: never) => void) };
  }

  /** Tells the host the page has loaded and its listeners are in place. */
  ready(): void {
    this.channel.post({ type: "ready" });
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private request(type: "backend" | "host", method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.channel.post({ type, id, method, params });
    });
  }

  private receive(message: unknown): void {
    if (!isMessage(message)) {
      return;
    }

    if (message.type === "event") {
      for (const listener of this.listeners.get(message.event) ?? []) {
        (listener as (payload: unknown) => void)(message.payload);
      }

      return;
    }

    if (message.type !== "result" && message.type !== "error") {
      return;
    }

    const pending = this.pending.get(message.id);
    if (pending === undefined) {
      return;
    }

    this.pending.delete(message.id);
    if (message.type === "result") {
      pending.resolve(message.result);
    } else {
      pending.reject(new BridgeError(message.error));
    }
  }
}
