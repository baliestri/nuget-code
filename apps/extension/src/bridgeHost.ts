import {
  BackendRestartedError,
  BackendStoppedError,
  ResponseError,
  type BackendApi,
  type BackendState
} from "@nuget-code/backend-client";
import {
  BridgeError,
  type BackendMethod,
  type BackendMethods,
  type BridgeHandlers,
  type HostRequests,
  type SessionState
} from "@nuget-code/bridge";
import type { InitializeResult, SolutionOpenResult } from "@nuget-code/protocol";
import { Commands, type SolutionState } from "./statusBar";

type Call<M extends BackendMethod> = (api: BackendApi, params: BackendMethods[M]["params"]) => Promise<unknown>;

/*
 * One entry per method the view may call. The call is written out, not looked up by name on the client: a
 * method that takes no parameters must be called with none, or the empty params object would be taken for
 * its cancellation token.
 */
const calls: { readonly [M in BackendMethod]: Call<M> } = {
  installedPackages: (api) => api.installedPackages(),
  packageUpdates: (api, params) => api.packageUpdates(params),
  searchPackages: (api, params) => api.searchPackages(params),
  packageDetails: (api, params) => api.packageDetails(params),
  planPackages: (api, params) => api.planPackages(params),
  installPackage: (api, params) => api.installPackage(params),
  updatePackages: (api, params) => api.updatePackages(params),
  removePackage: (api, params) => api.removePackage(params),
  restore: (api, params) => api.restore(params),
  cancelOperation: (api) => api.cancelOperation(),
  listSources: (api) => api.listSources(),
  addSource: (api, params) => api.addSource(params),
  updateSource: (api, params) => api.updateSource(params),
  removeSource: (api, params) => api.removeSource(params),
  setSourceProperty: (api, params) => api.setSourceProperty(params),
  listFolders: (api) => api.listFolders(),
  folderSize: (api, params) => api.folderSize(params),
  clearFolders: (api, params) => api.clearFolders(params)
};

/** Forwards the view's backend requests to the backend client, turning its failures into bridge errors. */
export function createBackendHandler(api: BackendApi): BridgeHandlers["backend"] {
  return async (method, params) => {
    try {
      return await (calls[method] as Call<BackendMethod>)(api, params as never);
    } catch (error) {
      throw toBridgeError(error);
    }
  };
}

function toBridgeError(error: unknown): BridgeError {
  if (error instanceof ResponseError) {
    return new BridgeError({
      kind: "backend",
      code: error.code,
      message: error.message,
      ...(typeof error.data === "string" ? { data: error.data } : {})
    });
  }

  if (error instanceof BackendStoppedError) {
    return new BridgeError({ kind: "stopped", message: error.message });
  }

  if (error instanceof BackendRestartedError) {
    return new BridgeError({ kind: "restarted", message: error.message });
  }

  return new BridgeError({ kind: "host", message: error instanceof Error ? error.message : String(error) });
}

/** What the host handler needs from the editor; each is one editor call in the extension. */
export interface HostDeps {
  /** Whether the path is one of the folders the backend lists. Only those are shown in the file manager. */
  isKnownFolder(path: string): Promise<boolean>;
  revealFolder(path: string): Promise<void>;
  openSettings(query: string | undefined): Promise<void>;
  pickFolder(title: string): Promise<string | undefined>;
  openExternal(url: string): Promise<void>;
  /** Stores the credential; false when the source is not an HTTP URL. */
  saveCredential(source: string, username: string, password: string): Promise<boolean>;
  /** Lets the backend ask again for the credentials of the source. */
  resetCredentials(source: string): Promise<void>;
  runCommand(command: string): Promise<void>;
  /** Shows the notification; must not wait for the user to answer it. */
  notifyWarnings(title: string, messages: readonly string[]): void;
}

/** The one line a notification shows for the warnings of an operation: the first, and how many more. */
export function warningNotice(messages: readonly string[]): string {
  const [first = "", ...rest] = messages;
  return rest.length === 0 ? first : `${first} And ${rest.length} more; see the log.`;
}

type HostCall<M extends keyof HostRequests> = (
  deps: HostDeps,
  params: HostRequests[M]["params"]
) => Promise<HostRequests[M]["result"]>;

const hostCalls: { readonly [M in keyof HostRequests]: HostCall<M> } = {
  openFolder: async (deps, params) => {
    const path = text(params.path, "path");
    if (!(await deps.isKnownFolder(path))) {
      throw hostError("That folder is not one of the NuGet folders.");
    }

    await deps.revealFolder(path);
    return {};
  },
  openSettings: async (deps, params) => {
    await deps.openSettings(typeof params.query === "string" ? params.query : undefined);
    return {};
  },
  pickFolder: async (deps, params) => {
    const path = await deps.pickFolder(text(params.title, "title"));
    return path === undefined ? {} : { path };
  },
  openExternal: async (deps, params) => {
    const url = text(params.url, "url");
    // Links come from package metadata, which is written by third parties.
    if (!isWebAddress(url)) {
      throw hostError("Only http and https addresses can be opened.");
    }

    await deps.openExternal(url);
    return {};
  },
  saveCredential: async (deps, params) => {
    const source = text(params.source, "source");
    if (!(await deps.saveCredential(source, text(params.username, "username"), text(params.password, "password")))) {
      throw hostError("Credentials can only be saved for an http or https source.");
    }

    await deps.resetCredentials(source);
    return {};
  },
  selectSolution: async (deps) => {
    await deps.runCommand(Commands.selectSolution);
    return {};
  },
  showLog: async (deps) => {
    await deps.runCommand(Commands.showLog);
    return {};
  },
  restartBackend: async (deps) => {
    await deps.runCommand(Commands.restartBackend);
    return {};
  },
  notifyWarnings: (deps, params) => {
    const messages = Array.isArray(params.messages)
      ? params.messages.filter((message): message is string => typeof message === "string" && message !== "")
      : [];
    if (messages.length > 0) {
      deps.notifyWarnings(text(params.title, "title"), messages);
    }

    return Promise.resolve({});
  }
};

/** Answers the view's requests for what only the host can do. The params come from the view and are checked. */
export function createHostHandler(deps: HostDeps): BridgeHandlers["host"] {
  return (method, params) => {
    const given = typeof params === "object" && params !== null ? params : {};
    return (hostCalls[method] as HostCall<keyof HostRequests>)(deps, given as never);
  };
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "") {
    throw hostError(`'${name}' must be a non-empty string.`);
  }

  return value;
}

function isWebAddress(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function hostError(message: string): BridgeError {
  return new BridgeError({ kind: "host", message });
}

/** The session as the view is told about it. */
export function toSessionState(input: {
  backend: BackendState;
  solution: SolutionState;
  opened: SolutionOpenResult | undefined;
  initialized: InitializeResult | undefined;
}): SessionState {
  const solution: SessionState["solution"] =
    input.solution.kind === "open" && input.opened !== undefined
      ? { kind: "open", name: input.solution.name, path: input.opened.path, projects: input.opened.projects }
      : input.solution.kind === "open"
        ? { kind: "opening" }
        : { kind: input.solution.kind };
  return { backend: input.backend, solution, hasSdk: input.initialized?.sdk !== undefined };
}
