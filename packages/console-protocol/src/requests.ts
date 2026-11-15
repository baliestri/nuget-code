import type {
  Empty,
  OperationProgressParams,
  OperationResult,
  PackageChangeParams,
  PackageDetailsResult,
  PackagesInstalledResult,
  PackagesPlanResult,
  PackagesSearchResult,
  PackagesUpdatesResult,
  PackagesVulnerabilitiesResult
} from "@nuget-code/protocol";

/**
 * What the Package Manager Console may ask of the extension, by name. The module of the console has the
 * same names in `Channel/ConsoleRequestNames.cs`; a test there fails when the two differ.
 */
export const ConsoleRequestNames = {
  projects: "projects",
  pickProject: "pickProject",
  installed: "installed",
  updates: "updates",
  search: "search",
  details: "details",
  vulnerabilities: "vulnerabilities",
  plan: "plan",
  install: "install",
  update: "update",
  remove: "remove",
  restore: "restore",
  sources: "sources",
  cancel: "cancel"
} as const;

/** A project of the open solution, as the console needs it. */
export interface ConsoleProject {
  name: string;
  path: string;
  frameworks: readonly string[];
}

/** A package source, as the console needs it. */
export interface ConsoleSource {
  name: string;
  source: string;
  enabled: boolean;
}

export interface ConsoleRequests {
  projects: { params: Empty; result: { projects: readonly ConsoleProject[] } };
  /** Shows the list of projects in the editor; no `path` when the user dismisses it. */
  pickProject: { params: { current?: string }; result: { path?: string } };
  installed: { params: Empty; result: PackagesInstalledResult };
  updates: { params: { prerelease: boolean; transitive: boolean }; result: PackagesUpdatesResult };
  search: {
    params: { query?: string; feed?: string; prerelease: boolean; skip: number; take: number };
    result: PackagesSearchResult;
  };
  details: { params: { id: string; feed?: string; prerelease: boolean }; result: PackageDetailsResult };
  vulnerabilities: { params: Empty; result: PackagesVulnerabilitiesResult };
  plan: { params: { changes: readonly PackageChangeParams[] }; result: PackagesPlanResult };
  install: { params: { id: string; version: string; projects: readonly string[] }; result: OperationResult };
  update: { params: { changes: readonly PackageChangeParams[] }; result: OperationResult };
  remove: { params: { id: string; projects: readonly string[] }; result: OperationResult };
  restore: { params: { projects?: readonly string[]; force: boolean }; result: OperationResult };
  sources: { params: Empty; result: { sources: readonly ConsoleSource[] } };
  /** Cancels the operation that is running; that operation still answers. */
  cancel: { params: Empty; result: Empty };
}

export type ConsoleRequest = keyof ConsoleRequests;

export function isConsoleRequest(name: unknown): name is ConsoleRequest {
  return typeof name === "string" && Object.hasOwn(ConsoleRequestNames, name);
}

/** Why a request of the console was not answered. */
export const ConsoleErrorCodes = {
  /** The line was not a request. */
  invalidRequest: "invalidRequest",
  methodNotAllowed: "methodNotAllowed",
  invalidParams: "invalidParams",
  /** No solution is open in the editor. */
  noSolution: "noSolution",
  /** The backend answered with an error. */
  backend: "backend",
  /** The backend is not running, or was restarted while it worked. */
  stopped: "stopped",
  internal: "internal"
} as const;

export type ConsoleErrorCode = (typeof ConsoleErrorCodes)[keyof typeof ConsoleErrorCodes];

export class ConsoleError extends Error {
  constructor(
    readonly code: ConsoleErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ConsoleError";
  }
}

/** One line from the console: a request. The token is the one the extension gave the shell. */
export interface ConsoleRequestMessage {
  id: number;
  token: string;
  method: string;
  params?: unknown;
}

/** One line to the console: a step of the operation the request started, its result, or its failure. */
export type ConsoleResponseMessage =
  | { id: number; progress: OperationProgressParams }
  | { id: number; result: unknown }
  | { id: number; error: { code: ConsoleErrorCode; message: string } };

/** The names of the environment variables through which the shell learns where the extension listens. */
export const ConsoleEnvironment = {
  address: "NUGET_CODE_CONSOLE_ADDRESS",
  token: "NUGET_CODE_CONSOLE_TOKEN",
  project: "NUGET_CODE_CONSOLE_PROJECT"
} as const;
