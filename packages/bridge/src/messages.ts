import type {
  Empty,
  LogEntry,
  OperationProgressParams,
  ProjectInfo,
  RestoreDidFinishParams,
  SolutionDidChangeParams
} from "@nuget-code/protocol";
import type { BridgeErrorData } from "./errors";

/** What only the extension host can do for the view. */
export interface HostRequests {
  /** Shows a folder in the system's file manager. */
  openFolder: { params: { path: string }; result: Empty };
  /** Opens the editor's settings, filtered by the query. */
  openSettings: { params: { query?: string }; result: Empty };
  /** Lets the user choose a folder; no `path` when they cancel. */
  pickFolder: { params: { title: string }; result: { path?: string } };
  /** Opens an http or https address in the browser. */
  openExternal: { params: { url: string }; result: Empty };
  /** Stores a credential for the server of the source. Stored credentials are never read back. */
  saveCredential: { params: { source: string; username: string; password: string }; result: Empty };
  selectSolution: { params: Empty; result: Empty };
  showLog: { params: Empty; result: Empty };
  restartBackend: { params: Empty; result: Empty };
}

export type HostRequest = keyof HostRequests;

const hostRequests: { readonly [M in HostRequest]: true } = {
  openFolder: true,
  openSettings: true,
  pickFolder: true,
  openExternal: true,
  saveCredential: true,
  selectSolution: true,
  showLog: true,
  restartBackend: true
};

export function isHostRequest(name: unknown): name is HostRequest {
  return typeof name === "string" && Object.hasOwn(hostRequests, name);
}

export type SolutionSession =
  | { kind: "none" }
  | { kind: "opening" }
  | { kind: "open"; name: string; path: string; projects: readonly ProjectInfo[] };

/** The state of the backend and of the solution, as the host sees it. */
export interface SessionState {
  backend: "starting" | "ready" | "stopped";
  solution: SolutionSession;
  /** Whether the backend found a .NET SDK. Without one no solution can be opened. */
  hasSdk: boolean;
}

/** What the host tells the view without being asked. */
export interface BridgeEvents {
  session: SessionState;
  solutionDidChange: SolutionDidChangeParams;
  operationProgress: OperationProgressParams;
  restoreDidFinish: RestoreDidFinishParams;
  logEntry: LogEntry;
}

export type BridgeEvent = keyof BridgeEvents;

export type Message =
  /** View to host, once, when the page has loaded and can receive events. */
  | { type: "ready" }
  | { type: "backend"; id: number; method: string; params: unknown }
  | { type: "host"; id: number; method: string; params: unknown }
  | { type: "result"; id: number; result: unknown }
  | { type: "error"; id: number; error: BridgeErrorData }
  | { type: "event"; event: string; payload: unknown };

/** A way to exchange messages: `postMessage` on each side, or a pair in memory for tests. */
export interface Channel {
  post(message: Message): void;
  onMessage(listener: (message: unknown) => void): { dispose(): void };
}

const MESSAGE_TYPES = new Set(["ready", "backend", "host", "result", "error", "event"]);

/** Whether a value received on the channel is one of the bridge's messages. Anything else is ignored. */
export function isMessage(value: unknown): value is Message {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const message = value as { type?: unknown; id?: unknown };
  if (typeof message.type !== "string" || !MESSAGE_TYPES.has(message.type)) {
    return false;
  }

  return message.type === "ready" || message.type === "event" || typeof message.id === "number";
}
