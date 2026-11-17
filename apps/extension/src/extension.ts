import { existsSync } from "node:fs";
import * as vscode from "vscode";
import { isMuslRuntime, locateBackend } from "./backendLocator";
import { BackendSession } from "./backendSession";
import { createBackendHandler, createHostHandler, warningNotice } from "./bridgeHost";
import { clearCredentialsCommand, restoreCommand } from "./commands";
import { readSettings, SECTION, type Settings } from "./configuration";
import { registerConsole } from "./console/consoleHost";
import { createCredentialStore } from "./credentials";
import { registerEngagementPrompts } from "./engagement";
import { FileWatcher } from "./fileWatcher";
import { LogChannel } from "./logChannel";
import { NugetViewProvider, VIEW_ID } from "./nugetView";
import { systemPath } from "./paths";
import { samePath } from "./solutionCandidates";
import { SolutionSelector } from "./solutionSelector";
import { Commands, StatusBar } from "./statusBar";

/** What the extension hands to whoever depends on it: the session with the backend, and the view. */
export interface ExtensionApi {
  session: BackendSession;
  view: NugetViewProvider;
}

const FOLDER_SIZES = "nuget.folderSizes";

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
  const status = new StatusBar(item, new vscode.ThemeColor("statusBarItem.errorBackground"));
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
    cwd: systemPath(folder.uri.fsPath, process.platform),
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
  const view = new NugetViewProvider(context.extensionUri, session, {
    backend: createBackendHandler(session.api),
    host: createHostHandler({
      isKnownFolder: async (path) =>
        (await session.api.listFolders()).folders.some((folder) => samePath(folder.path, path, process.platform)),
      revealFolder: async (path) => {
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(path));
      },
      openSettings: async (query) => {
        await vscode.commands.executeCommand("workbench.action.openSettings", query ?? SECTION);
      },
      pickFolder: async (title) => {
        const picked = await vscode.window.showOpenDialog({
          title,
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false
        });
        const chosen = picked?.[0]?.fsPath;
        return chosen === undefined ? undefined : systemPath(chosen, process.platform);
      },
      openExternal: async (url) => {
        await vscode.env.openExternal(vscode.Uri.parse(url, true));
      },
      saveCredential: (source, username, password) => credentials.save(source, { username, password }),
      resetCredentials: async (source) => {
        if (session.state === "ready") {
          await session.api.resetCredentials({ source });
        }
      },
      runCommand: async (command) => {
        await vscode.commands.executeCommand(command);
      },
      notifyWarnings: (title, messages) => void notifyWarnings(log, title, messages),
      // Global, not of the workspace: the NuGet folders are the same whichever solution is open.
      readFolderSizes: () => context.globalState.get(FOLDER_SIZES),
      writeFolderSizes: async (sizes) => {
        await context.globalState.update(FOLDER_SIZES, sizes);
      },
      now: () => Date.now(),
      packagesFolder: async () => (await session.api.listSources()).globalPackagesFolder,
      folderExists: (path) => existsSync(path),
      copyText: async (text) => {
        await vscode.env.clipboard.writeText(text);
      },
      platform: process.platform,
      notify: (kind, messages) => {
        for (const message of messages) {
          log.host(kind, message);
        }

        // A notification is one line: the sentences follow one another.
        const show = kind === "warning" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
        void show(messages.join(" "));
      }
    })
  });

  context.subscriptions.push(
    selector,
    vscode.window.registerWebviewViewProvider(VIEW_ID, view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand(Commands.open, () => vscode.commands.executeCommand(`${VIEW_ID}.focus`)),
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
    ...registerConsole(context, session, log),
    registerEngagementPrompts(context),
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

  return { session, view };
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

const WARNINGS_SETTING = "notifications.operationWarnings";

/**
 * What a change did beyond what was asked always goes to the log. The notification about it is shown
 * unless the user silenced it, which turns the setting off for every workspace.
 */
async function notifyWarnings(log: LogChannel, title: string, messages: readonly string[]): Promise<void> {
  for (const message of messages) {
    log.host("warning", `${title}: ${message}`);
  }

  const configuration = vscode.workspace.getConfiguration(SECTION);
  if (configuration.get(WARNINGS_SETTING) === false) {
    return;
  }

  const choice = await vscode.window.showInformationMessage(warningNotice(messages), "Show Log", "Don't Show Again");
  if (choice === "Show Log") {
    log.show();
  } else if (choice === "Don't Show Again") {
    await configuration.update(WARNINGS_SETTING, false, vscode.ConfigurationTarget.Global);
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
