import { workspace, RelativePattern, type Disposable } from "vscode";
import path from "node:path";
import { projectFileGlob, solutionFileGlob } from "../discovery.js";
import type { ExtensionLogger } from "#extension/logger";

export class PackageReferenceWatcher implements Disposable {
  private refreshTimeout: ReturnType<typeof setTimeout> | undefined;
  private watchers: Disposable[] = [];
  private structuralChangePending = false;
  private inputWatchers: Disposable[] = [];
  private inputKey = "";
  private disposed = false;
  private suspension = 0;
  private refreshPending = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly logger: ExtensionLogger,
    private readonly createFingerprint: () => Promise<string>,
    private readonly getFingerprint: () => string,
    private readonly setFingerprint: (fingerprint: string) => void,
    private readonly refreshPackages: (options?: {
      forceInventory?: boolean | undefined;
    }) => Promise<void>,
    private readonly refreshDiscovery: () => Promise<void>,
    private readonly invalidate: () => void = () => {},
  ) {}

  register(): void {
    this.disposed = false;
    this.disposeWatchers();

    const projectWatcher = workspace.createFileSystemWatcher(projectFileGlob);
    projectWatcher.onDidCreate(() => {
      this.scheduleStructuralRefresh();
    });
    projectWatcher.onDidChange(() => {
      this.scheduleRefresh();
    });
    projectWatcher.onDidDelete(() => {
      this.scheduleStructuralRefresh();
    });

    const solutionWatcher = workspace.createFileSystemWatcher(solutionFileGlob);
    solutionWatcher.onDidChange(() => {
      this.scheduleStructuralRefresh();
    });
    solutionWatcher.onDidCreate(() => {
      this.scheduleStructuralRefresh();
    });
    solutionWatcher.onDidDelete(() => {
      this.scheduleStructuralRefresh();
    });

    const centralPackageWatcher = workspace.createFileSystemWatcher(
      "**/Directory.Packages.props",
    );
    centralPackageWatcher.onDidCreate(() => {
      this.scheduleRefresh();
    });
    centralPackageWatcher.onDidChange(() => {
      this.scheduleRefresh();
    });
    centralPackageWatcher.onDidDelete(() => {
      this.scheduleRefresh();
    });

    const contextWatcher = workspace.createFileSystemWatcher(
      "**/{*.props,*.targets,global.json}",
    );
    contextWatcher.onDidCreate(() => this.scheduleRefresh());
    contextWatcher.onDidChange(() => this.scheduleRefresh());
    contextWatcher.onDidDelete(() => this.scheduleRefresh());
    const configWatcher = workspace.createFileSystemWatcher(
      "**/{NuGet.config,nuget.config,NuGet.Config}",
    );
    configWatcher.onDidCreate(() => this.scheduleStructuralRefresh());
    configWatcher.onDidChange(() => this.scheduleStructuralRefresh());
    configWatcher.onDidDelete(() => this.scheduleStructuralRefresh());
    this.watchers = [
      projectWatcher,
      solutionWatcher,
      centralPackageWatcher,
      contextWatcher,
      configWatcher,
    ];
  }

  setInputs(inputs: readonly string[]): void {
    const files = [...new Set(inputs)].sort();
    const key = JSON.stringify(files);
    if (key === this.inputKey || this.disposed) return;
    for (const watcher of this.inputWatchers) watcher.dispose();
    this.inputKey = key;
    this.inputWatchers = files.map((file) => {
      const pattern = path
        .basename(file)
        .replace(/[[\]*?{}]/g, (character) => `[${character}]`);
      const watcher = workspace.createFileSystemWatcher(
        new RelativePattern(path.dirname(file), pattern),
      );
      const changed = () =>
        path.basename(file).toLowerCase() === "nuget.config"
          ? this.scheduleStructuralRefresh()
          : this.scheduleRefresh();
      watcher.onDidCreate(changed);
      watcher.onDidChange(changed);
      watcher.onDidDelete(changed);
      return watcher;
    });
  }

  async suspendDuring<T>(action: () => Promise<T>): Promise<T> {
    this.suspension++;
    try {
      return await action();
    } finally {
      if (--this.suspension === 0 && this.refreshPending) this.resetTimer();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }
    this.disposeWatchers();
    for (const watcher of this.inputWatchers) watcher.dispose();
    this.inputWatchers = [];
    this.inputKey = "";
  }

  private disposeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
  }

  private scheduleRefresh(): void {
    this.resetTimer();
  }

  private scheduleStructuralRefresh(): void {
    this.structuralChangePending = true;
    this.resetTimer();
  }

  private resetTimer(): void {
    if (this.disposed) return;
    this.refreshPending = true;
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    this.refreshTimeout = setTimeout(() => {
      this.chain = this.chain
        .catch(() => {})
        .then(() => this.runScheduledRefresh())
        .catch(() => {
          this.logger.warning(
            "workspace",
            "Could not refresh changed project inputs.",
          );
        });
    }, 750);
  }

  private async runScheduledRefresh(): Promise<void> {
    if (this.disposed || this.suspension) return;
    this.refreshPending = false;
    const structural = this.structuralChangePending;
    this.structuralChangePending = false;

    if (structural) {
      this.invalidate();
      this.logger.information(
        "workspace",
        "Workspace structure changed, re-running discovery",
      );
      await this.refreshDiscovery();
      return;
    }

    await this.refreshChangedPackageReferences();
  }

  private async refreshChangedPackageReferences(): Promise<void> {
    const fingerprint = await this.createFingerprint();
    if (this.disposed || this.suspension) {
      this.refreshPending = true;
      return;
    }
    if (fingerprint === this.getFingerprint()) {
      this.logger.verbose(
        "workspace",
        "PackageReference change did not alter package fingerprint",
      );
      return;
    }

    this.logger.information(
      "workspace",
      "PackageReference change detected, refreshing packages",
    );
    this.setFingerprint(fingerprint);
    this.invalidate();
    await this.refreshPackages({ forceInventory: true });
  }
}
