import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { RequestBroker } from "#client/request-broker";
import type { NuGetClientSettings } from "#client/types";

/** Lifecycle-owned by the extension. Credential processes never occupy an HTTP slot. */
export class ClientNetwork {
  readonly requests = new RequestBroker(6);
  readonly authentication = new RequestBroker(1);
  private readonly salt = randomBytes(32);
  private readonly contexts = new WeakMap<object, string>();
  private readonly authListeners = new Set<(settings: object) => void>();
  context(settings: object): string {
    let revision = this.contexts.get(settings);
    if (!revision) {
      revision = randomUUID();
      this.contexts.set(settings, revision);
    }
    return revision;
  }
  invalidateAuthentication(settings: object): void {
    this.contexts.set(settings, randomUUID());
    for (const listener of this.authListeners) listener(settings);
  }
  onAuthenticationChanged(listener: (settings: object) => void): {
    dispose(): void;
  } {
    this.authListeners.add(listener);
    return {
      dispose: () => {
        this.authListeners.delete(listener);
      },
    };
  }
  key(parts: readonly unknown[]): string {
    return createHmac("sha256", this.salt)
      .update(JSON.stringify(parts))
      .digest("hex");
  }
  dispose(): void {
    this.authListeners.clear();
    this.requests.dispose();
    this.authentication.dispose();
  }
}
const fallback = new ClientNetwork();
export function networkFor(
  settings: Pick<NuGetClientSettings, "network">,
): ClientNetwork {
  return settings.network ?? fallback;
}
