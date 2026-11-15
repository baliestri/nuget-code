import * as vscode from "vscode";
import type { BackendSession } from "./backendSession";
import type { LogChannel } from "./logChannel";
import { systemPath } from "./paths";
import { buildCandidates, chooseAutomatically, samePath, toTarget, type SolutionCandidate } from "./solutionCandidates";

const REMEMBERED = "nuget.solution";
const SOLUTIONS = "**/*.{sln,slnx,slnf}";
const PROJECTS = "**/*.{csproj,fsproj,vbproj}";

/** Finds the solutions of the workspace and opens one: on its own when there is no doubt, else when asked. */
export class SolutionSelector implements vscode.Disposable {
  private readonly watcher = vscode.workspace.createFileSystemWatcher(SOLUTIONS, false, true, false);

  constructor(
    private readonly session: BackendSession,
    private readonly memory: vscode.Memento,
    private readonly log: LogChannel
  ) {}

  dispose(): void {
    this.watcher.dispose();
  }

  /** The candidates as they are now. `files.exclude` is honoured by the search. */
  async find(): Promise<SolutionCandidate[]> {
    const [solutions, projects] = await Promise.all([
      vscode.workspace.findFiles(SOLUTIONS),
      vscode.workspace.findFiles(PROJECTS)
    ]);
    const path = (uri: vscode.Uri): string => systemPath(uri.fsPath, process.platform);
    return buildCandidates({
      folders: (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
        name: folder.name,
        path: path(folder.uri)
      })),
      solutions: solutions.map(path),
      projects: projects.map(path),
      platform: process.platform
    });
  }

  /** Opens the remembered solution, or the only one. With several and none remembered, opens nothing. */
  async selectAutomatically(): Promise<void> {
    const choice = chooseAutomatically(await this.find(), this.memory.get<string>(REMEMBERED), process.platform);
    if (choice !== undefined) {
      await this.open(choice);
    }
  }

  /** Lets the user choose among the solutions of the workspace. */
  async pick(): Promise<void> {
    const candidates = await this.find();
    if (candidates.length === 0) {
      await vscode.window.showInformationMessage("NuGet found no solution or project in this workspace.");
      return;
    }

    const current = this.session.currentTarget?.path;
    const grouped = new Set(candidates.map((candidate) => candidate.folder)).size > 1;
    const items: (vscode.QuickPickItem & { candidate?: SolutionCandidate })[] = [];
    let folder: string | undefined;
    for (const candidate of candidates) {
      if (grouped && candidate.folder !== folder) {
        folder = candidate.folder;
        items.push({ label: folder, kind: vscode.QuickPickItemKind.Separator });
      }

      const isCurrent = current !== undefined && samePath(candidate.path, current, process.platform);
      items.push({
        label: `${isCurrent ? "$(check)" : candidate.kind === "implicit" ? "$(folder)" : "$(file)"} ${candidate.label}`,
        description: candidate.description,
        candidate
      });
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: "NuGet: Select Solution",
      placeHolder: "The solution NuGet works on",
      matchOnDescription: true
    });
    if (picked?.candidate !== undefined) {
      await this.memory.update(REMEMBERED, picked.candidate.path);
      await this.open(picked.candidate);
    }
  }

  /** Calls the listener when a solution file appears in or disappears from the workspace. */
  onDidChangeCandidates(listener: () => void): vscode.Disposable {
    return vscode.Disposable.from(this.watcher.onDidCreate(listener), this.watcher.onDidDelete(listener));
  }

  private async open(candidate: SolutionCandidate): Promise<void> {
    try {
      await this.session.openSolution(toTarget(candidate));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.host("error", `Opening ${candidate.path} failed: ${message}`);
      const choice = await vscode.window.showErrorMessage(
        `NuGet could not open ${candidate.label}. ${message}`,
        "Show Log"
      );
      if (choice === "Show Log") {
        this.log.show();
      }
    }
  }
}
