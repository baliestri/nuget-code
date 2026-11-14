import { existsSync } from "node:fs";
import * as vscode from "vscode";
import { isMuslRuntime, locateBackend } from "./backendLocator";
import { BackendSession } from "./backendSession";
import { clearCredentialsCommand, restoreCommand } from "./commands";
import { readSettings, SECTION, type Settings } from "./configuration";
import { createCredentialStore } from "./credentials";
import { FileWatcher } from "./fileWatcher";
import { LogChannel } from "./logChannel";
import { SolutionSelector } from "./solutionSelector";
import { Commands, StatusBar } from "./statusBar";

/** What the extension hands to whoever depends on it: the session with the backend. */
export interface ExtensionApi {
  session: BackendSession;
}

let active: BackendSession | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    return undefined;
  }

  let settings = currentSettings();
  const log = new LogChannel(vscode.window.createOutputChannel("NuGet", "log"), settings.logLevel);
  const item = vscode.window.createStatusBarItem("nuget.status", vscode.StatusBarAlignment.Left, 0);
  item.name = "NuGet";
  const status = new StatusBar(item);
  context.subscriptions.push(item);

  const session = new BackendSession({
    launch: () => {
      const located = locateBackend({
        extensionPath: context.extensionPath,
        override: settings.backendPath,
        platform: process.platform,
        arch: process.arch,
        isMusl: isMuslRuntime(),
        exists: existsSync
      });
      if ("error" in located) {
        throw new Error(located.error);
      }

      return located.launch;
    },
    cwd: folder.uri.fsPath,
    settings
  });
  active = session;

  const credentials = createCredentialStore(context);
  session.api.onCredentialsRequest((params) => credentials.resolve(params));
  session.api.onLogEntry((entry) => log.write(entry));
  session.client.onStderr((text) => log.host("error", text));
  session.onDidChange(() => status.update(session.state, session.solution));
  status.update(session.state, session.solution);

  let wasReady = false;
  session.client.onDidChangeState((state) => {
    if (state === "stopped" && wasReady) {
      void reportStopped(session, log);
    }

    wasReady = state === "ready" || (wasReady && state === "starting");
  });

  const selector = new SolutionSelector(session, context.workspaceState, log);

  context.subscriptions.push(
    selector,
    new FileWatcher((paths) => {
      if (session.state === "ready") {
        session.api.didChangeFiles({ paths }).catch((error: unknown) => log.host("error", messageOf(error)));
      }
    }),
    vscode.commands.registerCommand(Commands.selectSolution, () => selector.pick()),
    // A solution file that appears when none was open may now be the only choice.
    selector.onDidChangeCandidates(() => {
      if (session.state === "ready" && session.solution.kind === "none") {
        void selector.selectAutomatically();
      }
    }),
    vscode.commands.registerCommand(Commands.restore, () => restoreCommand(session, log)),
    vscode.commands.registerCommand(Commands.clearCredentials, () => clearCredentialsCommand(session, credentials)),
    vscode.commands.registerCommand(Commands.showLog, () => log.show()),
    vscode.commands.registerCommand(Commands.restartBackend, () => start(session, log, () => session.restart())),
    vscode.workspace.onDidChangeConfiguration((change) => {
      if (!change.affectsConfiguration(SECTION)) {
        return;
      }

      settings = currentSettings();
      log.minimum = settings.logLevel;
      session.applySettings(settings).catch((error: unknown) => log.host("error", messageOf(error)));
    })
  );

  await start(session, log, () => session.start());
  if (session.state === "ready") {
    await selector.selectAutomatically();
  }

  return { session };
}

export async function deactivate(): Promise<void> {
  await active?.dispose();
  active = undefined;
}

function currentSettings(): Settings {
  const configuration = vscode.workspace.getConfiguration(SECTION);
  return readSettings((key) => configuration.get(key));
}

/** Starts or restarts the backend and tells the user when it does not come up or has no SDK. */
async function start(session: BackendSession, log: LogChannel, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    log.host("error", messageOf(error));
    const choice = await vscode.window.showErrorMessage(
      `The NuGet backend could not be started. ${messageOf(error)}`,
      "Show Log"
    );
    if (choice === "Show Log") {
      log.show();
    }

    return;
  }

  if (session.initializeResult?.sdk === undefined) {
    const choice = await vscode.window.showWarningMessage(
      "The .NET SDK was not found. NuGet can list sources and search packages, but cannot open a solution.",
      "Open Settings"
    );
    if (choice === "Open Settings") {
      await vscode.commands.executeCommand("workbench.action.openSettings", "nuget.dotnetPath");
    }
  }
}

async function reportStopped(session: BackendSession, log: LogChannel): Promise<void> {
  const choice = await vscode.window.showErrorMessage(
    "The NuGet backend stopped repeatedly and was not started again.",
    "Restart",
    "Show Log"
  );
  if (choice === "Restart") {
    await start(session, log, () => session.restart());
  } else if (choice === "Show Log") {
    log.show();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
