import { basename } from "node:path";
import {
  BackendClient,
  Emitter,
  type BackendApi,
  type BackendLaunch,
  type BackendState,
  type Disposable
} from "@nuget-code/backend-client";
import type { InitializeResult, SolutionOpenResult } from "@nuget-code/protocol";
import {
  requiresNotification,
  requiresRestart,
  toConfigurationParams,
  toInitializeParams,
  type Settings
} from "./configuration";
import type { SolutionState } from "./statusBar";

/** What to open: a solution file, or a folder with the projects found in it. */
export interface SolutionTarget {
  path: string;
  projects?: readonly string[];
}

export interface BackendSessionOptions {
  /** Throws when there is no backend to run on this machine. */
  launch: () => BackendLaunch;
  cwd: string;
  settings: Settings;
}

/**
 * The backend as the rest of the extension sees it: the process kept alive by the client, initialized with
 * the current settings, with the selected solution opened again after every restart.
 */
export class BackendSession {
  readonly client: BackendClient;

  private readonly changed = new Emitter<void>();
  private settings: Settings;
  private target: SolutionTarget | undefined;
  private solutionState: SolutionState = { kind: "none" };
  private initialized: InitializeResult | undefined;
  private openResult: SolutionOpenResult | undefined;

  constructor(options: BackendSessionOptions) {
    this.settings = options.settings;
    this.client = new BackendClient({
      launch: options.launch,
      cwd: options.cwd,
      onStarted: (api) => this.onStarted(api)
    });
    this.client.onDidChangeState(() => this.changed.fire());
  }

  get api(): BackendApi {
    return this.client.api;
  }

  get state(): BackendState {
    return this.client.state;
  }

  get solution(): SolutionState {
    return this.solutionState;
  }

  /** The solution that is open or being opened. */
  get currentTarget(): SolutionTarget | undefined {
    return this.target;
  }

  /** What the backend answered when the open solution was opened: its path and its projects. */
  get openedSolution(): SolutionOpenResult | undefined {
    return this.openResult;
  }

  /** What the backend said about itself when it last started; `sdk` is absent when no .NET SDK was found. */
  get initializeResult(): InitializeResult | undefined {
    return this.initialized;
  }

  /** Whether packages are checked for known vulnerabilities: the setting, as it is now. */
  get audit(): boolean {
    return this.settings.audit;
  }

  /** Whether the Package Manager Console can be opened: the setting, as it is now. */
  get consoleEnabled(): boolean {
    return this.settings.consoleEnabled;
  }

  /** The PowerShell the console runs in, as the setting says; empty to look for one. */
  get powershellPath(): string {
    return this.settings.powershellPath;
  }

  /**
   * Fires when the state of the backend or of the solution changes, or the audit or the console is turned
   * on or off.
   */
  onDidChange(listener: () => void): Disposable {
    return this.changed.on(listener);
  }

  start(): Promise<void> {
    return this.client.start();
  }

  restart(): Promise<void> {
    return this.client.restart();
  }

  /** Opens the solution, replacing the one that was open. On failure no solution is left open. */
  async openSolution(target: SolutionTarget): Promise<SolutionOpenResult> {
    this.target = target;
    this.openResult = undefined;
    this.setSolution({ kind: "opening" });
    try {
      const result = await this.api.openSolution(
        target.projects === undefined ? { path: target.path } : { path: target.path, projects: target.projects }
      );
      if (this.target === target) {
        this.openResult = result;
        this.setSolution({ kind: "open", name: basename(result.path) });
      }

      return result;
    } catch (error) {
      if (this.target === target) {
        this.target = undefined;
        this.openResult = undefined;
        this.setSolution({ kind: "none" });
      }

      throw error;
    }
  }

  async closeSolution(): Promise<void> {
    this.target = undefined;
    this.openResult = undefined;
    this.setSolution({ kind: "none" });
    await this.api.closeSolution();
  }

  /** Takes new settings: a restart when the backend only reads them at start, a notification otherwise. */
  async applySettings(settings: Settings): Promise<void> {
    const before = this.settings;
    this.settings = settings;
    if (requiresRestart(before, settings)) {
      await this.client.restart();
    } else if (requiresNotification(before, settings) && this.client.state === "ready") {
      await this.api.didChangeConfiguration(toConfigurationParams(settings));
    }

    // The view shows or hides the vulnerability warnings by it, and asks again once the backend knows.
    // And it shows or hides the button of the console.
    if (before.audit !== settings.audit || before.consoleEnabled !== settings.consoleEnabled) {
      this.changed.fire();
    }
  }

  dispose(): Promise<void> {
    return this.client.dispose();
  }

  private async onStarted(api: BackendApi): Promise<void> {
    this.initialized = await api.initialize(toInitializeParams(this.settings));
    const target = this.target;
    if (target === undefined) {
      return;
    }

    // After a restart: the solution that was open is opened again. A failure here leaves no solution open
    // and must not stop the backend that just came back.
    try {
      await this.openSolution(target);
    } catch {
      // The state already says there is no solution.
    }
  }

  private setSolution(state: SolutionState): void {
    this.solutionState = state;
    this.changed.fire();
  }
}
