import { isBackendMethod, type BackendMethod } from "./backendMethods";
import { BridgeError, type BridgeErrorData } from "./errors";
import {
  isHostRequest,
  isMessage,
  type BridgeEvent,
  type BridgeEvents,
  type Channel,
  type HostRequest
} from "./messages";

export interface BridgeHandlers {
  /** Runs an allowed backend method. Rejections should be `BridgeError`s. */
  backend(method: BackendMethod, params: unknown): Promise<unknown>;
  host(method: HostRequest, params: unknown): Promise<unknown>;
}

/**
 * The host's side of the bridge. What arrives from the view is not trusted: a message that is not one of
 * the bridge's is ignored, and a method that is not on the lists is refused without reaching a handler.
 */
export class BridgeServer {
  private readonly subscription: { dispose(): void };
  private isReady = false;

  constructor(
    private readonly channel: Channel,
    private readonly handlers: BridgeHandlers,
    private readonly onReady: () => void
  ) {
    this.subscription = channel.onMessage((message) => this.receive(message));
  }

  emit<E extends BridgeEvent>(event: E, payload: BridgeEvents[E]): void {
    this.channel.post({ type: "event", event, payload });
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private receive(message: unknown): void {
    if (!isMessage(message)) {
      return;
    }

    if (message.type === "ready") {
      if (!this.isReady) {
        this.isReady = true;
        this.onReady();
      }

      return;
    }

    if (message.type === "backend") {
      this.answer(
        message.id,
        isBackendMethod(message.method)
          ? this.handlers.backend(message.method, message.params)
          : refused(message.method)
      );
    } else if (message.type === "host") {
      this.answer(
        message.id,
        isHostRequest(message.method) ? this.handlers.host(message.method, message.params) : refused(message.method)
      );
    }
  }

  private answer(id: number, outcome: Promise<unknown>): void {
    outcome.then(
      (result) => this.channel.post({ type: "result", id, result: result ?? {} }),
      (error: unknown) => this.channel.post({ type: "error", id, error: toData(error) })
    );
  }
}

function refused(method: unknown): Promise<never> {
  return Promise.reject(
    new BridgeError({ kind: "refused", message: `'${String(method)}' is not available to the view.` })
  );
}

function toData(error: unknown): BridgeErrorData {
  if (error instanceof BridgeError) {
    return error.toData();
  }

  return { kind: "host", message: error instanceof Error ? error.message : String(error) };
}
