import { fileURLToPath } from "node:url";
import type { InitializeParams } from "@nuget-code/protocol";
import { BackendApi, BackendProcess, type BackendLaunch } from "../../src/index";
import type { TestWorkspace } from "./testWorkspace";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));

export const backendProject = `${repository}backend/src/NuGet.VisualStudioCode`;

/**
 * The backend the contract tests talk to: the published binary named by NUGET_VSCODE_BACKEND_PATH, or the
 * Debug build run with `dotnet`, which `globalSetup` builds.
 */
export function resolveTestBackend(): BackendLaunch {
  const published = process.env["NUGET_VSCODE_BACKEND_PATH"];
  return published === undefined || published === ""
    ? { command: "dotnet", args: [`${backendProject}/bin/Debug/net10.0/NuGet.VisualStudioCode.dll`] }
    : { command: published, args: [] };
}

export interface RunningBackend {
  process: BackendProcess;
  api: BackendApi;
  stop(): Promise<void>;
}

/** Starts a backend in the workspace and initializes it. Restore on open is off unless asked for. */
export async function startBackend(workspace: TestWorkspace, params: InitializeParams = {}): Promise<RunningBackend> {
  const backend = BackendProcess.start(resolveTestBackend(), workspace.path);
  const api = new BackendApi();
  api.attach(backend.connection);
  await api.initialize({ restoreOnOpen: false, ...params });
  return { process: backend, api, stop: () => backend.stop(5000) };
}

/** Resolves with the first value the event delivers that satisfies `accept`. */
export function next<T>(
  subscribe: (listener: (value: T) => void) => { dispose(): void },
  accept: (value: T) => boolean = () => true,
  timeoutMs = 120_000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error("The expected notification did not arrive."));
    }, timeoutMs);
    const subscription = subscribe((value) => {
      if (accept(value)) {
        clearTimeout(timer);
        subscription.dispose();
        resolve(value);
      }
    });
  });
}
