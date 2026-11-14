import type { BackendState } from "@nuget-code/backend-client";

export type SolutionState = { kind: "none" } | { kind: "opening" } | { kind: "open"; name: string };

export const Commands = {
  open: "nuget.open",
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
  /** The item is drawn as an error: the backend is not running. */
  error: boolean;
}

/**
 * What the status bar item shows for a state of the backend and of the solution. The text says the state
 * of the backend whenever it is not simply running; the tooltip always does.
 */
export function statusText(backend: BackendState, solution: SolutionState): StatusText {
  if (backend === "stopped") {
    return {
      text: "$(error) NuGet: stopped",
      tooltip: "The NuGet backend is stopped. Click to restart it.",
      command: Commands.restartBackend,
      error: true
    };
  }

  if (backend === "starting") {
    return {
      text: "$(sync~spin) NuGet: starting…",
      tooltip: "The NuGet backend is starting.",
      command: Commands.open,
      error: false
    };
  }

  if (solution.kind === "opening") {
    return {
      text: "$(sync~spin) NuGet: opening…",
      tooltip: "The NuGet backend is running and is opening the solution.",
      command: Commands.open,
      error: false
    };
  }

  // With a solution open the item leads to the view; with none, the text itself says what a click does.
  return solution.kind === "open"
    ? {
        text: `$(package) ${solution.name}`,
        tooltip: "The NuGet backend is running. Click to open the package manager.",
        command: Commands.open,
        error: false
      }
    : {
        text: "$(package) NuGet: select a solution",
        tooltip: "The NuGet backend is running, with no solution selected. Click to select one.",
        command: Commands.selectSolution,
        error: false
      };
}

/** What the status bar needs from a VS Code status bar item. */
export interface StatusItem {
  text: string;
  tooltip: unknown;
  command: unknown;
  backgroundColor: unknown;
  show(): void;
}

export class StatusBar {
  /** `errorBackground` is the editor's colour for a status bar item that reports an error. */
  constructor(
    private readonly item: StatusItem,
    private readonly errorBackground: unknown
  ) {}

  update(backend: BackendState, solution: SolutionState): void {
    const status = statusText(backend, solution);
    this.item.text = status.text;
    this.item.tooltip = status.tooltip;
    this.item.command = status.command;
    this.item.backgroundColor = status.error ? this.errorBackground : undefined;
    this.item.show();
  }
}
