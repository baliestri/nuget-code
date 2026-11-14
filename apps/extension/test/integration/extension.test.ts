import * as assert from "node:assert";
import { existsSync } from "node:fs";
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

  it("contributes its commands", async () => {
    const commands = await vscode.commands.getCommands(true);

    for (const command of [
      "nuget.open",
      "nuget.selectSolution",
      "nuget.restore",
      "nuget.restartBackend",
      "nuget.showLog",
      "nuget.clearCredentials"
    ]) {
      assert.ok(commands.includes(command), `${command} is not registered.`);
    }
  });
});
