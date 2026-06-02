import { ProgressLocation, window } from "vscode";
import { NuGetClient } from "#client";
import type { PackageFeed } from "#contracts";
import type { ExtensionLogger } from "#extension/logger";
import type { ExtensionSettings } from "#extension/settings";

const feedHealthTimeoutMs = 3000;

export class PackageFeedHealthNotifier {
  private readonly notifications = new Set<string>();

  constructor(
    private readonly logger: ExtensionLogger,
    private readonly getSettings: () => ExtensionSettings,
    private readonly onAuthenticated?: (feed: PackageFeed) => Promise<void>,
  ) {}

  async check(feeds: PackageFeed[]): Promise<void> {
    await Promise.all(
      feeds
        .filter((feed) => feed.enabled && isHttpFeed(feed))
        .map((feed) => this.checkSingle(feed)),
    );
  }

  private async checkSingle(feed: PackageFeed): Promise<void> {
    const result = await NuGetClient.checkFeedHealth({
      feed,
      settings: this.getSettings(),
      logger: this.logger,
      timeoutMs: feedHealthTimeoutMs,
    });
    if (result.ok) {
      return;
    }

    this.logger.warning(
      "nuget.feed",
      `Could not connect to ${feed.name}: ${result.error ?? "Unknown error"}`,
    );
    if (this.notifications.has(feed.id)) {
      return;
    }
    this.notifications.add(feed.id);

    if (!feed.hasCredentials && isCredentialProviderAuthError(result.error)) {
      await this.showCredentialProviderAuthNotification(feed, result.error);
      return;
    }

    window.showWarningMessage(
      `Could not connect to NuGet feed "${feed.name}": ${result.error ?? "Unknown error"}.`,
    );
  }

  private async showCredentialProviderAuthNotification(
    feed: PackageFeed,
    error: string | undefined,
  ): Promise<void> {
    if (isCredentialProviderMissing(error)) {
      await window.showWarningMessage(
        `A NuGet credential provider is required to connect to "${feed.name}" without NuGet.config credentials.`,
      );
      return;
    }

    const action = "Authenticate NuGet feed";
    const answer = await window.showWarningMessage(
      `Could not authenticate NuGet feed "${feed.name}". Run the credential provider interactively to sign in.`,
      action,
    );
    if (answer === action) {
      await this.authenticateFeed(feed);
    }
  }

  private async authenticateFeed(feed: PackageFeed): Promise<void> {
    const result = await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: `Authenticating NuGet feed "${feed.name}"`,
      },
      () =>
        NuGetClient.getFeedAuthorizationHeader({
          feed,
          settings: this.getSettings(),
          logger: this.logger,
          interactive: true,
          retry: true,
        }),
    );

    if (result.authorizationHeader) {
      await window.showInformationMessage(
        `Authenticated NuGet feed "${feed.name}".`,
      );
      await this.onAuthenticated?.(feed);
      return;
    }

    await window.showWarningMessage(
      `Could not authenticate NuGet feed "${feed.name}": ${result.error ?? "Unknown error"}.`,
    );
  }
}

function isCredentialProviderMissing(error: string | undefined): boolean {
  return (
    error?.toLowerCase().includes("credential provider was not found") === true
  );
}

function isCredentialProviderAuthError(error: string | undefined): boolean {
  const lower = error?.toLowerCase();
  return (
    lower?.includes("credential provider") === true ||
    lower?.includes("authentication required") === true ||
    lower?.includes("401") === true ||
    lower?.includes("403") === true
  );
}

function isHttpFeed(feed: PackageFeed): boolean {
  return feed.url.startsWith("http://") || feed.url.startsWith("https://");
}
