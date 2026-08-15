import { workspace, type Disposable } from "vscode";
import { projectFileGlob, solutionFileGlob } from "../discovery.js";
import type { ExtensionLogger } from "#extension/logger";

export class PackageReferenceWatcher implements Disposable {
  private refreshTimeout: ReturnType<typeof setTimeout> | undefined;
  private watchers: Disposable[] = [];
  private structuralChangePending = false;

  constructor(
    private readonly logger: ExtensionLogger,
    private readonly createFingerprint: () => Promise<string>,
    private readonly getFingerprint: () => string,
    private readonly setFingerprint: (fingerprint: string) => void,
    private readonly refreshPackages: (options?: {
      forceInventory?: boolean | undefined;
    }) => Promise<void>,
    private readonly refreshDiscovery: () => Promise<void>,
  ) {}

  register(): void {
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

    this.watchers = [projectWatcher, solutionWatcher, centralPackageWatcher];
  }

  dispose(): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }
    this.disposeWatchers();
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
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    this.refreshTimeout = setTimeout(() => {
      void this.runScheduledRefresh();
    }, 750);
  }

  private async runScheduledRefresh(): Promise<void> {
    const structural = this.structuralChangePending;
    this.structuralChangePending = false;

    if (structural) {
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
    await this.refreshPackages({ forceInventory: true });
  }
}
