import { randomUUID } from "node:crypto";
import type {
  ExtensionToWebviewMessage,
  PackageManagerEvent,
} from "#contracts";

/** One sequence for every message emitted by a host instance, including legacy event adapters. */
export class StateMessageSequence {
  private revision = 0;
  constructor(readonly sessionId: string = randomUUID()) {}
  next(message: PackageManagerEvent): ExtensionToWebviewMessage {
    const baseRevision = this.revision++;
    if (message.type === "state")
      return { ...message, sessionId: this.sessionId, revision: this.revision };
    return {
      ...message,
      sessionId: this.sessionId,
      baseRevision,
      revision: this.revision,
    };
  }
}
