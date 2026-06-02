import { workspace, type Disposable } from "vscode";
import type { ExtensionLogger } from "#extension/logger";

export class PackageReferenceWatcher implements Disposable {
  private refreshTimeout: ReturnType<typeof setTimeout> | undefined;
  private watchers: Disposable[] = [];

  constructor(
    private readonly logger: ExtensionLogger,
    private readonly createFingerprint: () => Promise<string>,
    private readonly getFingerprint: () => string,
    private readonly setFingerprint: (fingerprint: string) => void,
    private readonly refreshPackages: (options?: {
      forceInventory?: boolean | undefined;
    }) => Promise<void>,
  ) {}

  register(): void {
    this.disposeWatchers();

    const watch = (pattern: string): Disposable => {
      const watcher = workspace.createFileSystemWatcher(pattern);
      watcher.onDidCreate(() => {
        this.scheduleRefresh();
      });
      watcher.onDidChange(() => {
        this.scheduleRefresh();
      });
      watcher.onDidDelete(() => {
        this.scheduleRefresh();
      });
      return watcher;
    };

    this.watchers = [
      watch("**/*.{csproj,fsproj,vbproj}"),
      watch("**/Directory.Packages.props"),
    ];
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
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    this.refreshTimeout = setTimeout(() => {
      void this.refreshChangedPackageReferences();
    }, 750);
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
