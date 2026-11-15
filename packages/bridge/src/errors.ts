/**
 * Why a request failed:
 * - `backend`: the backend answered with an error; `code` is one of the protocol's error codes.
 * - `stopped`: there is no backend process.
 * - `restarted`: the backend process ended while the request was waiting.
 * - `refused`: the host does not let the view call that method.
 * - `host`: the extension host could not do what was asked.
 */
export type BridgeErrorKind = "backend" | "stopped" | "restarted" | "refused" | "host";

export interface BridgeErrorData {
  kind: BridgeErrorKind;
  code?: number;
  message: string;
  data?: string;
}

export class BridgeError extends Error {
  readonly kind: BridgeErrorKind;
  readonly code: number | undefined;
  readonly data: string | undefined;

  constructor(error: BridgeErrorData) {
    super(error.message);
    this.name = "BridgeError";
    this.kind = error.kind;
    this.code = error.code;
    this.data = error.data;
  }

  toData(): BridgeErrorData {
    return {
      kind: this.kind,
      message: this.message,
      ...(this.code === undefined ? {} : { code: this.code }),
      ...(this.data === undefined ? {} : { data: this.data })
    };
  }
}
