import * as vscode from "vscode";
import { ChangeBatcher } from "./changeBatcher";

const BATCH_MS = 200;

/**
 * The files whose change the backend wants to hear about. The backend decides what each one affects, and
 * discards the echo of what it wrote itself; nothing is filtered here beyond these patterns.
 */
export const WATCH_PATTERNS: readonly string[] = [
  "**/*.{sln,slnx,slnf}",
  "**/*.{csproj,fsproj,vbproj}",
  "**/Directory.Build.{props,targets}",
  "**/Directory.Packages.props",
  "**/global.json",
  // NuGet reads the file under any casing.
  "**/[Nn][Uu][Gg][Ee][Tt].[Cc][Oo][Nn][Ff][Ii][Gg]",
  "**/obj/project.assets.json"
];

/** Reports file changes to the backend, grouped. */
export class FileWatcher implements vscode.Disposable {
  private readonly batcher: ChangeBatcher;
  private readonly watchers: vscode.FileSystemWatcher[];

  constructor(report: (paths: string[]) => void) {
    this.batcher = new ChangeBatcher(BATCH_MS, report);
    this.watchers = WATCH_PATTERNS.map((pattern) => {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const changed = (uri: vscode.Uri): void => this.batcher.add(uri.fsPath);
      watcher.onDidCreate(changed);
      watcher.onDidChange(changed);
      watcher.onDidDelete(changed);
      return watcher;
    });
  }

  dispose(): void {
    this.batcher.dispose();
    for (const watcher of this.watchers) watcher.dispose();
  }
}
