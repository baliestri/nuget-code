import {
  loadPackageDetailsFromFeed,
  type PackageDetailsCache,
} from "#client/package-details";
import type {
  LoadState,
  PackageManagerEvent,
  PackageManagerState,
} from "#contracts";
import type { ExtensionLogger } from "#extension/logger";
import type { ExtensionSettings } from "#extension/settings";
import { ReadCoordinator } from "#extension/webview/read-coordinator";

interface PackageDetailsServiceOptions {
  getState(): PackageManagerState;
  setState(state: PackageManagerState): void;
  getSettings(): ExtensionSettings;
  getCache(): PackageDetailsCache;
  logger: ExtensionLogger;
  publish(message: PackageManagerEvent): void;
  persistPackageCache(): Promise<void>;
}
export class PackageDetailsService {
  private readonly reads = new ReadCoordinator();
  constructor(private readonly options: PackageDetailsServiceOptions) {}
  cancel(): void {
    this.reads.cancel("details");
    this.update(undefined, { status: "idle", stale: false, error: null });
  }
  dispose(): void {
    this.reads.dispose();
  }
  async loadPackageDetails(packageId: string, feedId: string): Promise<void> {
    const state = this.options.getState();
    const settings = this.options.getSettings();
    const item = [
      ...state.installedPackages,
      ...state.implicitPackages,
      ...state.availablePackages,
    ].find((item) => item.id === packageId);
    const feed = state.feeds.find(
      (feed) => feed.id === feedId && feed.enabled && feed.id !== "__all__",
    );
    const key = () =>
      JSON.stringify([
        this.options.getState().selectedTargetId,
        this.options.getState().selectedPackageId,
        this.options.getState().includePrerelease,
        this.options
          .getState()
          .feeds.map((feed) => [feed.id, feed.url, feed.enabled]),
        settings.network?.context(settings),
        packageId,
        feedId,
      ]);
    const contextKey = key();
    const ticket = this.reads.begin("details", contextKey);
    const current = () =>
      this.reads.isCurrent(ticket) &&
      this.options.getSettings() === settings &&
      key() === contextKey;
    if (!item || !feed) {
      this.update(undefined, {
        status: "failed",
        stale: false,
        error: "The selected package source is unavailable.",
      });
      return;
    }
    const cache = this.options.getCache();
    const cacheKey = JSON.stringify([
      contextKey,
      feed.url,
      item.name.toLowerCase(),
    ]);
    const previous =
      state.packageDetails?.packageId === packageId &&
      state.packageDetails.feedId === feedId
        ? state.packageDetails
        : undefined;
    this.update(previous, {
      status: "loading",
      stale: !!previous,
      error: null,
    });
    let status: LoadState["status"] = "ready";
    try {
      const details =
        cache.get(cacheKey) ??
        (await loadPackageDetailsFromFeed(item.name, feed, {
          includePrerelease: state.includePrerelease,
          settings,
          logger: this.options.logger,
          signal: ticket.signal,
        }));
      if (!current()) return;
      if (!details) throw new Error("Package details unavailable.");
      await cache.set(cacheKey, details);
      if (!current()) return;
      this.update(
        { packageId, feedId, packageItem: details },
        { status: "ready", stale: false, error: null },
      );
      await this.options.persistPackageCache();
    } catch (error) {
      status =
        ticket.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
          ? "idle"
          : "failed";
    } finally {
      if (this.reads.isCurrent(ticket)) {
        if (!current())
          this.update(undefined, { status: "idle", stale: false, error: null });
        else if (status !== "ready")
          this.update(this.options.getState().packageDetails, {
            status,
            stale: !!this.options.getState().packageDetails,
            error:
              status === "failed"
                ? "Could not load package details from the selected source."
                : null,
          });
      }
    }
  }
  private update(
    packageDetails: PackageManagerState["packageDetails"],
    details: LoadState,
  ): void {
    const current = this.options.getState();
    const patch = {
      packageDetails: packageDetails ?? null,
      flows: { ...current.flows, details },
    };
    this.options.setState({ ...current, ...patch });
    this.options.publish({ type: "stateDelta", patch });
  }
}
