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
  /** Shows one of the NuGet folders, or the folder of a restored package, in the system's file manager. */
  openFolder: { params: { path: string }; result: Empty };
  /** Puts a short text, such as a package name, on the clipboard. */
  copyText: { params: { text: string }; result: Empty };
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
  /**
   * Tells the user what a change did beyond what was asked, as a notification of the editor that can be
   * silenced. `title` is the operation; each message is one sentence. Answers without waiting for the user.
   */
  notifyWarnings: { params: { title: string; messages: readonly string[] }; result: Empty };
  /**
   * Tells the user how something they asked for ended, as a notification of the editor. Each message is one
   * sentence; they are also written to the log. Answers without waiting for the user.
   */
  notify: { params: { kind: "info" | "warning"; messages: readonly string[] }; result: Empty };
  /** The folder sizes measured before, on this machine, that are not too old to be shown; by path. */
  folderSizes: { params: Empty; result: { sizes: Readonly<Record<string, MeasuredSize>> } };
  /** Remembers the size just measured of one of the NuGet folders, and answers with what was stored. */
  saveFolderSize: { params: { path: string; exists: boolean; bytes: number }; result: { size: MeasuredSize } };
}

/** The size a folder had when it was last measured. */
export interface MeasuredSize {
  exists: boolean;
  bytes: number;
  /** When it was measured, in milliseconds since the epoch. */
  at: number;
}

export type HostRequest = keyof HostRequests;

const hostRequests: { readonly [M in HostRequest]: true } = {
  openFolder: true,
  copyText: true,
  openSettings: true,
  pickFolder: true,
  openExternal: true,
  saveCredential: true,
  selectSolution: true,
  showLog: true,
  restartBackend: true,
  notifyWarnings: true,
  notify: true,
  folderSizes: true,
  saveFolderSize: true
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
  /** Whether packages are checked for known vulnerabilities: the `nuget.audit.enabled` setting. */
  audit: boolean;
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
