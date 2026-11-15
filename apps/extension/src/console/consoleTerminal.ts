import { ConsoleEnvironment, type ConsoleProject } from "@nuget-code/console-protocol";
import type { PowerShellLocation } from "./powershellLocator";

export const CONSOLE_NAME = "NuGet Package Manager Console";
export const CONSOLE_PROFILE = "nuget.console";

/** What a terminal of the editor is started with. */
export interface ConsoleTerminalOptions {
  name: string;
  shellPath: string;
  shellArgs: string[];
  env: Record<string, string>;
}

/** What opening the console needs from the editor and from the rest of the extension. */
export interface ConsoleDeps<Terminal> {
  /** The `nuget.console.enabled` setting. */
  enabled(): boolean;
  /** The projects of the open solution; undefined when no solution is open. */
  projects(): readonly ConsoleProject[] | undefined;
  /** Shows the list of projects; undefined when the user dismisses it. */
  pickProject(projects: readonly ConsoleProject[]): Promise<string | undefined>;
  /** The manifest of the console module inside the extension; undefined when it is not there. */
  manifest(): string | undefined;
  locatePowerShell(): Promise<PowerShellLocation>;
  /**
   * Tells the user there is no PowerShell to run the console in, and lets them install one. Answers with
   * the PowerShell that can be used after that, if there is one.
   */
  withoutPowerShell(location: Exclude<PowerShellLocation, { kind: "found" }>): Promise<string | undefined>;
  /** Starts listening for the console; called once, the first time a console is opened. */
  startServer(): Promise<{ address: string; token: string }>;
  createTerminal(options: ConsoleTerminalOptions): Terminal;
  show(terminal: Terminal): void;
  /** Says why the console was not opened. */
  explain(message: string): void;
  /** `process.platform`. */
  platform: string;
}

/** How PowerShell is started so that it stays open with the module loaded. */
export function shellArguments(manifest: string, platform: string): string[] {
  return [
    "-NoLogo",
    "-NoExit",
    // The module is not signed. The policy is given to this process only; nothing of the machine changes.
    ...(platform === "win32" ? ["-ExecutionPolicy", "Bypass"] : []),
    "-Command",
    `Import-Module '${manifest.replaceAll("'", "''")}'`
  ];
}

/**
 * The Package Manager Console of a window: one terminal running PowerShell with the module of the
 * extension, told through its environment where the extension listens and which project is the default.
 */
export class PackageManagerConsole<Terminal> {
  private terminal: Terminal | undefined;
  private server: Promise<{ address: string; token: string }> | undefined;
  private opening: Promise<void> | undefined;
  /** Set while the editor creates, from the profile, the terminal whose options were just given to it. */
  private expected = false;

  constructor(private readonly deps: ConsoleDeps<Terminal>) {}

  /** Whether the terminal is this window's console. */
  isConsole(terminal: Terminal): boolean {
    return this.terminal === terminal;
  }

  /** Opens the console, or shows the one that is open. One call at a time: a second one waits for the first. */
  open(): Promise<void> {
    this.opening ??= this.openOnce().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }

  /**
   * What the editor starts the terminal with when the console is chosen among the terminal profiles;
   * undefined when there is nothing to start, because the console is open or cannot be opened.
   */
  async profile(): Promise<ConsoleTerminalOptions | undefined> {
    if (this.showExisting()) {
      return undefined;
    }

    const options = await this.prepare();
    this.expected = options !== undefined;
    return options;
  }

  /** Called for every terminal the editor opens: the one it made from the profile is the console. */
  opened(terminal: Terminal, name: string): void {
    if (this.expected && this.terminal === undefined && name === CONSOLE_NAME) {
      this.expected = false;
      this.terminal = terminal;
    }
  }

  /** Called for every terminal that closes. After the console closes, another can be opened. */
  closed(terminal: Terminal): void {
    if (this.terminal === terminal) {
      this.terminal = undefined;
    }
  }

  /** Brings the console back to the front, as after a list of the editor took the focus from it. */
  focus(): void {
    if (this.terminal !== undefined) {
      this.deps.show(this.terminal);
    }
  }

  private async openOnce(): Promise<void> {
    if (this.showExisting()) {
      return;
    }

    const options = await this.prepare();
    // The console may have been opened from the profile while the user was choosing a project.
    if (options !== undefined && !this.showExisting()) {
      this.terminal = this.deps.createTerminal(options);
      this.deps.show(this.terminal);
    }
  }

  private showExisting(): boolean {
    if (this.terminal === undefined) {
      return false;
    }

    this.deps.show(this.terminal);
    return true;
  }

  /** Everything that comes before the terminal: undefined, with the reason said, when one cannot be opened. */
  private async prepare(): Promise<ConsoleTerminalOptions | undefined> {
    const { deps } = this;
    if (!deps.enabled()) {
      deps.explain("The Package Manager Console is turned off. Turn nuget.console.enabled on to use it.");
      return undefined;
    }

    const projects = deps.projects();
    if (projects === undefined) {
      deps.explain("The Package Manager Console works on a solution. Select one first.");
      return undefined;
    }

    const manifest = deps.manifest();
    if (manifest === undefined) {
      deps.explain("The module of the Package Manager Console was not found in the extension. Reinstall it.");
      return undefined;
    }

    const location = await deps.locatePowerShell();
    const shellPath = location.kind === "found" ? location.path : await deps.withoutPowerShell(location);
    if (shellPath === undefined) {
      return undefined;
    }

    // A solution with one project has nothing to choose; one without projects has no default project.
    const project = projects.length > 1 ? await deps.pickProject(projects) : (projects[0]?.path ?? "");
    if (project === undefined) {
      return undefined;
    }

    this.server ??= deps.startServer();
    let listening: { address: string; token: string };
    try {
      listening = await this.server;
    } catch (error) {
      // Not kept: the next attempt starts the server again.
      this.server = undefined;
      deps.explain(
        `The Package Manager Console could not be started. ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }

    return {
      name: CONSOLE_NAME,
      shellPath,
      shellArgs: shellArguments(manifest, deps.platform),
      env: {
        [ConsoleEnvironment.address]: listening.address,
        [ConsoleEnvironment.token]: listening.token,
        [ConsoleEnvironment.project]: project
      }
    };
  }
}
