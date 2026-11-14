import type { BackendState } from "@nuget-code/backend-client";

export type SolutionState = { kind: "none" } | { kind: "opening" } | { kind: "open"; name: string };

export const Commands = {
  selectSolution: "nuget.selectSolution",
  restore: "nuget.restore",
  restartBackend: "nuget.restartBackend",
  showLog: "nuget.showLog",
  clearCredentials: "nuget.clearCredentials"
} as const;

export interface StatusText {
  text: string;
  tooltip: string;
  command: string;
}

/** What the status bar item shows for a state of the backend and of the solution. */
export function statusText(backend: BackendState, solution: SolutionState): StatusText {
  if (backend === "stopped") {
    return {
      text: "$(error) NuGet",
      tooltip: "The NuGet backend is not running. Click to restart it.",
      command: Commands.restartBackend
    };
  }

  if (backend === "starting" || solution.kind === "opening") {
    return {
      text: "$(sync~spin) NuGet",
      tooltip: backend === "starting" ? "Starting the NuGet backend…" : "Opening the solution…",
      command: Commands.selectSolution
    };
  }

  return solution.kind === "open"
    ? {
        text: `$(package) ${solution.name}`,
        tooltip: "NuGet: click to select another solution.",
        command: Commands.selectSolution
      }
    : {
        text: "$(package) Select Solution",
        tooltip: "NuGet: no solution is selected.",
        command: Commands.selectSolution
      };
}

/** What the status bar needs from a VS Code status bar item. */
export interface StatusItem {
  text: string;
  tooltip: unknown;
  command: unknown;
  show(): void;
}

export class StatusBar {
  constructor(private readonly item: StatusItem) {}

  update(backend: BackendState, solution: SolutionState): void {
    const status = statusText(backend, solution);
    this.item.text = status.text;
    this.item.tooltip = status.tooltip;
    this.item.command = status.command;
    this.item.show();
  }
}
