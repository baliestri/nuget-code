import { BackendRestartedError, BackendStoppedError, ResponseError, type BackendApi } from "@nuget-code/backend-client";
import { ConsoleError, ConsoleErrorCodes, type ConsoleProject } from "@nuget-code/console-protocol";
import type { OperationProgressParams, OperationResult, ProjectInfo } from "@nuget-code/protocol";
import type { ConsoleHandlers } from "./consoleServer";

/** What the console's requests need from the extension. */
export interface ConsoleHandlerDeps {
  api: Pick<
    BackendApi,
    | "installedPackages"
    | "packageUpdates"
    | "searchPackages"
    | "packageDetails"
    | "packageVulnerabilities"
    | "planPackages"
    | "installPackage"
    | "updatePackages"
    | "removePackage"
    | "restore"
    | "listSources"
    | "cancelOperation"
    | "onOperationProgress"
  >;
  /** The projects of the open solution; undefined when no solution is open. */
  projects(): readonly ProjectInfo[] | undefined;
  /** Shows the list of projects in the editor; undefined when the user dismisses it. */
  pickProject(projects: readonly ConsoleProject[], current: string | undefined): Promise<string | undefined>;
  /** `process.platform`: decides how paths are compared. */
  platform: string;
}

/** Each request of the console, answered by the backend or by the editor. */
export function createConsoleHandlers(deps: ConsoleHandlerDeps): ConsoleHandlers {
  const { api } = deps;

  const open = (): readonly ProjectInfo[] => {
    const projects = deps.projects();
    if (projects === undefined) {
      throw new ConsoleError(ConsoleErrorCodes.noSolution, "No solution is open in the editor.");
    }

    return projects;
  };

  const key = (path: string): string => (deps.platform === "win32" ? path.toLowerCase() : path);

  /** The paths as the solution has them. A path that is not a project of the solution is refused. */
  const known = (paths: readonly string[]): string[] => {
    const byKey = new Map(open().map((project) => [key(project.path), project.path]));
    return paths.map((path) => {
      const found = byKey.get(key(path));
      if (found === undefined) {
        throw new ConsoleError(ConsoleErrorCodes.invalidParams, `Not a project of the open solution: ${path}`);
      }

      return found;
    });
  };

  const listed = (): ConsoleProject[] =>
    open().map((project) => ({ name: project.name, path: project.path, frameworks: project.frameworks }));

  /** Runs what the backend is asked, with its failures said in the terms of the console. */
  const ask = async <T>(run: () => Promise<T>): Promise<T> => {
    open();
    try {
      return await run();
    } catch (error) {
      throw toConsoleError(error);
    }
  };

  /** A change of packages: the steps the backend announces while it runs are passed on. */
  const change = async (
    progress: (step: OperationProgressParams) => void,
    run: () => Promise<OperationResult>
  ): Promise<OperationResult> => {
    const listening = api.onOperationProgress(progress);
    try {
      return await ask(run);
    } finally {
      listening.dispose();
    }
  };

  return {
    // Written as a promise chain so that having no solution is a rejection, as in every other request.
    projects: () => Promise.resolve().then(() => ({ projects: listed() })),
    pickProject: async (params) => {
      const projects = listed();
      const path = await deps.pickProject(projects, params.current);
      return path === undefined ? {} : { path: known([path])[0]! };
    },
    installed: () => ask(() => api.installedPackages()),
    updates: (params) => ask(() => api.packageUpdates({ ...params, noCache: false })),
    search: (params) => ask(() => api.searchPackages(params)),
    details: (params) => ask(() => api.packageDetails({ ...params, noCache: false })),
    vulnerabilities: () => ask(() => api.packageVulnerabilities({ noCache: false })),
    plan: (params) =>
      ask(() => {
        const changes = params.changes.map((item) => ({ ...item, projects: known(item.projects) }));
        return api.planPackages({ changes });
      }),
    install: (params, progress) =>
      change(progress, () => api.installPackage({ ...params, projects: known(params.projects) })),
    update: (params, progress) =>
      change(progress, () => {
        const changes = params.changes.map((item) => ({ ...item, projects: known(item.projects) }));
        return api.updatePackages({ changes });
      }),
    remove: (params, progress) =>
      change(progress, () => api.removePackage({ ...params, projects: known(params.projects) })),
    restore: (params, progress) =>
      change(progress, () =>
        api.restore(
          params.projects === undefined
            ? { force: params.force }
            : { force: params.force, projects: known(params.projects) }
        )
      ),
    sources: () =>
      ask(async () => ({
        sources: (await api.listSources()).effective.map((feed) => ({
          name: feed.name,
          source: feed.source,
          enabled: feed.enabled
        }))
      })),
    cancel: () =>
      ask(async () => {
        await api.cancelOperation();
        return {};
      })
  };
}

function toConsoleError(error: unknown): ConsoleError {
  if (error instanceof ConsoleError) {
    return error;
  }

  if (error instanceof ResponseError) {
    return new ConsoleError(ConsoleErrorCodes.backend, error.message);
  }

  if (error instanceof BackendStoppedError || error instanceof BackendRestartedError) {
    return new ConsoleError(ConsoleErrorCodes.stopped, error.message);
  }

  return new ConsoleError(ConsoleErrorCodes.internal, error instanceof Error ? error.message : String(error));
}
