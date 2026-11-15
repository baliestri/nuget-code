import * as assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import type { ExtensionApi } from "../../src/extension";

const TIMEOUT = 120_000;

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT;
  while (!condition()) {
    if (Date.now() > deadline) {
      assert.fail(`Timed out waiting for ${what}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("the extension in the editor", () => {
  let api: ExtensionApi;

  before(async () => {
    const extension = vscode.extensions.getExtension<ExtensionApi | undefined>("baliestri.nuget-code");
    assert.ok(extension, "The extension is not installed in the test editor.");
    const activated = await extension.activate();
    assert.ok(activated, "The extension did not activate in a workspace with a solution.");
    api = activated;
  });

  it("starts the backend and finds the .NET SDK", async () => {
    await until(() => api.session.state === "ready", "the backend to be ready");

    assert.ok(api.session.initializeResult?.sdk, "The backend reported no .NET SDK.");
  });

  it("opens the only solution of the workspace on its own", async () => {
    await until(() => api.session.solution.kind === "open", "the solution to open");

    assert.deepStrictEqual(api.session.solution, { kind: "open", name: "Sample.slnx" });
  });

  it("the restore command restores the solution and the log is delivered", async () => {
    const workspace = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
    const assets = join(workspace, "App", "obj", "project.assets.json");
    const messages: string[] = [];
    const subscription = api.session.api.onLogEntry((entry) => messages.push(entry.message));
    assert.strictEqual(existsSync(assets), false, "The project was restored before the command ran.");

    await vscode.commands.executeCommand("nuget.restore");

    assert.ok(existsSync(assets), "The restore command did not write the assets file.");
    // The log is delivered on its own and may arrive after the command has answered.
    await until(
      () => messages.some((message) => message.startsWith("Restore finished")),
      "the closing line of the restore in the backend log"
    );
    subscription.dispose();
  });

  it("the installed packages come back with the restored version", async () => {
    const installed = await api.session.api.installedPackages();

    const alpha = installed.projects[0]?.packages.find((item) => item.id === "Alpha");
    assert.strictEqual(alpha?.resolvedVersion, "1.0.0");
  });

  it("restarting the backend opens the solution again", async () => {
    await vscode.commands.executeCommand("nuget.restartBackend");
    await until(
      () => api.session.state === "ready" && api.session.solution.kind === "open",
      "the solution to open again"
    );

    const installed = await api.session.api.installedPackages();
    assert.strictEqual(installed.projects.length, 1);
  });

  it("the view opens and its page loads under the content security policy", async () => {
    let loaded = false;
    void api.view.ready.then(() => (loaded = true));

    await vscode.commands.executeCommand("nuget.open");

    // The page says it is ready only after its script ran and its bridge is listening.
    await until(() => loaded, "the page of the view to load");
  });

  it("answers the view's requests for the folders and their sizes", async () => {
    const listed = (await api.view.handlers.backend("listFolders", {})) as {
      folders: { title: string; path: string }[];
    };
    assert.ok(listed.folders.length > 0, "No folder was listed.");

    for (const folder of listed.folders) {
      const size = (await api.view.handlers.backend("folderSize", { path: folder.path })) as {
        exists: boolean;
        bytes: number;
      };
      assert.strictEqual(typeof size.exists, "boolean", `${folder.title} has no size answer.`);
    }

    // The global packages folder of the test workspace was written by the restore above.
    const global = listed.folders.find((folder) => folder.title === "Global Packages");
    assert.ok(global, "The global packages folder is not listed.");
    const size = (await api.view.handlers.backend("folderSize", { path: global.path })) as { bytes: number };
    assert.ok(size.bytes > 0, "The restored global packages folder measured as empty.");
  });

  it("contributes its commands", async () => {
    const commands = await vscode.commands.getCommands(true);

    for (const command of [
      "nuget.open",
      "nuget.selectSolution",
      "nuget.restore",
      "nuget.restartBackend",
      "nuget.showLog",
      "nuget.clearCredentials",
      "nuget.openConsole"
    ]) {
      assert.ok(commands.includes(command), `${command} is not registered.`);
    }
  });

  // Last: it removes the package the tests above rely on.
  it("the Package Manager Console opens in a terminal and its cmdlets reach the backend", async function () {
    const version = powershellVersion();
    if (version === undefined || version[0] < 7 || (version[0] === 7 && version[1] < 6)) {
      // Without a PowerShell the module loads in, the command would wait on a notification nobody answers.
      console.log("Skipped: there is no PowerShell 7.6 or newer in the PATH.");
      this.skip();
    }

    const workspace = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
    const listed = join(workspace, "console-listed.txt");
    const removed = join(workspace, "console-removed.txt");
    const project = join(workspace, "App", "App.csproj");
    assert.ok(readFileSync(project, "utf8").includes("Alpha"), "The project does not reference Alpha any more.");

    await vscode.commands.executeCommand("nuget.openConsole");
    const terminal = vscode.window.terminals.find((item) => item.name === "NuGet Package Manager Console");
    assert.ok(terminal, "The command did not open the console.");

    // The solution has one project, so it is the default one without anything being asked.
    terminal.sendText(
      `Get-Package | ForEach-Object { "$($_.ProjectName) $($_.Id) $($_.Version)" } | Set-Content -LiteralPath '${listed}'`
    );
    await until(() => existsSync(listed), "Get-Package to answer in the console");
    assert.strictEqual(readFileSync(listed, "utf8").trim(), "App Alpha 1.0.0");

    terminal.sendText(`Uninstall-Package Alpha; 'done' | Set-Content -LiteralPath '${removed}'`);
    await until(() => existsSync(removed), "Uninstall-Package to finish in the console");
    assert.ok(!readFileSync(project, "utf8").includes("Alpha"), "Uninstall-Package did not edit the project.");

    // Opening again shows the same terminal.
    await vscode.commands.executeCommand("nuget.openConsole");
    assert.strictEqual(
      vscode.window.terminals.filter((item) => item.name === "NuGet Package Manager Console").length,
      1
    );
    terminal.dispose();
  });
});

/** The major and minor of the `pwsh` in the PATH; undefined when there is none. */
function powershellVersion(): [number, number] | undefined {
  try {
    const match = /(\d+)\.(\d+)/.exec(execFileSync("pwsh", ["--version"], { encoding: "utf8" }));
    return match === null ? undefined : [Number(match[1]), Number(match[2])];
  } catch {
    return undefined;
  }
}
