import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConsoleProject } from "@nuget-code/console-protocol";
import * as vscode from "vscode";
import type { BackendSession } from "../backendSession";
import { Commands } from "../statusBar";
import { createConsoleHandlers } from "./consoleHandlers";
import { startConsoleServer, type RunningConsoleServer } from "./consoleServer";
import { CONSOLE_PROFILE, PackageManagerConsole } from "./consoleTerminal";
import {
  installCommand,
  locatePowerShell,
  moduleVersion,
  PowerShellActions,
  powerShellNotice,
  type PowerShellLocation
} from "./powershellLocator";

const POWERSHELL_SETTING = "nuget.console.powershellPath";
const INSTALL_PAGE = "https://learn.microsoft.com/powershell/scripting/install/installing-powershell";

/** What the console tells the user, and writes to the log of the extension. */
export interface ConsoleLog {
  host(level: "info" | "warning" | "error", message: string): void;
}

/**
 * The Package Manager Console in the editor: the command and the terminal profile that open it, the
 * channel its cmdlets ask through, and the lists and notices it shows.
 */
export function registerConsole(
  context: vscode.ExtensionContext,
  session: BackendSession,
  log: ConsoleLog
): vscode.Disposable[] {
  const folder = join(context.extensionPath, "console");
  const manifest = join(folder, "NuGetCode.psd1");
  let server: RunningConsoleServer | undefined;

  /** The version of PowerShell the module was built for; undefined when the module is not in the extension. */
  const minimum = (): string | undefined => {
    try {
      return moduleVersion(readFileSync(join(folder, "version.json"), "utf8"));
    } catch {
      return undefined;
    }
  };

  const projects = (): readonly ConsoleProject[] | undefined =>
    session.openedSolution?.projects.map((project) => ({
      name: project.name,
      path: project.path,
      frameworks: project.frameworks
    }));

  const locate = (): Promise<PowerShellLocation> =>
    locatePowerShell({
      configured: session.powershellPath,
      path: process.env["PATH"] ?? "",
      home: homedir(),
      platform: process.platform,
      minimum: minimum() ?? "",
      exists: existsSync,
      versionOf
    });

  const pmc = new PackageManagerConsole<vscode.Terminal>({
    enabled: () => session.consoleEnabled,
    projects,
    pickProject: (candidates) => pickProject(candidates, undefined, "Default project of the Package Manager Console"),
    manifest: () => (existsSync(manifest) && minimum() !== undefined ? manifest : undefined),
    locatePowerShell: locate,
    withoutPowerShell: (location) => withoutPowerShell(location, minimum() ?? "", session, locate, log),
    startServer: async () => {
      server = await startConsoleServer(
        createConsoleHandlers({
          api: session.api,
          projects: () => session.openedSolution?.projects,
          pickProject: async (candidates, current) => {
            const picked = await pickProject(candidates, current, "Default project of the Package Manager Console");
            // The list took the focus from the terminal the cmdlet is waiting in.
            pmc.focus();
            return picked;
          },
          platform: process.platform
        })
      );
      return server;
    },
    createTerminal: (options) =>
      vscode.window.createTerminal({ ...options, iconPath: new vscode.ThemeIcon("package") }),
    show: (terminal) => terminal.show(false),
    explain: (message) => {
      log.host("warning", message);
      void vscode.window.showWarningMessage(message);
    },
    platform: process.platform
  });

  return [
    vscode.commands.registerCommand(Commands.openConsole, () => pmc.open()),
    vscode.window.registerTerminalProfileProvider(CONSOLE_PROFILE, {
      provideTerminalProfile: async () => {
        const options = await pmc.profile();
        return options === undefined
          ? undefined
          : new vscode.TerminalProfile({ ...options, iconPath: new vscode.ThemeIcon("package") });
      }
    }),
    vscode.window.onDidOpenTerminal((terminal) => pmc.opened(terminal, terminal.name)),
    vscode.window.onDidCloseTerminal((terminal) => pmc.closed(terminal)),
    { dispose: () => void server?.dispose() }
  ];
}

/** What the executable answers to `--version`; undefined when it does not run or does not answer in time. */
function versionOf(path: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(path, ["--version"], { timeout: 10_000, windowsHide: true }, (error, stdout) =>
      resolve(error === null ? stdout.trim() : undefined)
    );
  });
}

async function pickProject(
  projects: readonly ConsoleProject[],
  current: string | undefined,
  title: string
): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(
    projects.map((project) => ({
      label: project.name,
      description: [project.frameworks.join(", "), project.path === current ? "default" : ""]
        .filter((part) => part !== "")
        .join(" • "),
      detail: project.path,
      path: project.path
    })),
    { title, placeHolder: "The project the cmdlets act on when -ProjectName is not given", matchOnDetail: true }
  );
  return picked?.path;
}

/**
 * Says there is no PowerShell the console can run in and offers what can be done about it. Installing
 * runs in a terminal the user sees, and only after they chose to.
 */
async function withoutPowerShell(
  location: Exclude<PowerShellLocation, { kind: "found" }>,
  minimum: string,
  session: BackendSession,
  locate: () => Promise<PowerShellLocation>,
  log: ConsoleLog
): Promise<string | undefined> {
  const dotnet = session.initializeResult?.sdk?.dotnetPath;
  const notice = powerShellNotice(location, minimum, dotnet);
  log.host("warning", notice.message);
  const choice = await vscode.window.showWarningMessage(notice.message, ...notice.actions);
  if (choice === PowerShellActions.openSettings) {
    await vscode.commands.executeCommand("workbench.action.openSettings", POWERSHELL_SETTING);
  } else if (choice === PowerShellActions.howToInstall) {
    await vscode.env.openExternal(vscode.Uri.parse(INSTALL_PAGE, true));
  } else if (choice === PowerShellActions.install && dotnet !== undefined) {
    const installed = (await install(dotnet, minimum)) ? await locate() : undefined;
    if (installed?.kind === "found") {
      return installed.path;
    }

    const failed =
      installed === undefined
        ? "PowerShell was not installed; the terminal shows why."
        : "PowerShell was installed, but it was not found afterwards.";
    log.host("error", failed);
    const next = await vscode.window.showErrorMessage(
      `${failed} Install it another way, or set ${POWERSHELL_SETTING}.`,
      PowerShellActions.howToInstall,
      PowerShellActions.openSettings
    );
    if (next === PowerShellActions.howToInstall) {
      await vscode.env.openExternal(vscode.Uri.parse(INSTALL_PAGE, true));
    } else if (next === PowerShellActions.openSettings) {
      await vscode.commands.executeCommand("workbench.action.openSettings", POWERSHELL_SETTING);
    }
  }

  return undefined;
}

/** Runs the install command as a task, in a terminal of its own, and answers whether it ended well. */
async function install(dotnet: string, version: string): Promise<boolean> {
  const { command, args } = installCommand(dotnet, version);
  const task = new vscode.Task(
    { type: "process" },
    vscode.TaskScope.Workspace,
    `Install PowerShell ${version}`,
    "NuGet",
    new vscode.ProcessExecution(command, args)
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    focus: true,
    panel: vscode.TaskPanelKind.Dedicated
  };

  const execution = await vscode.tasks.executeTask(task);
  return new Promise((resolve) => {
    const ended = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution === execution) {
        ended.dispose();
        resolve(event.exitCode === 0);
      }
    });
  });
}
