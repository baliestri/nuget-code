import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { NuGetClient } from "#client";
import { PackageFeedHealthNotifier } from "./feed-health.js";

const vscodeMock = vscode as typeof vscode & {
  __resetVscodeMock(): void;
};

vi.mock("#client", () => ({
  NuGetClient: {
    checkFeedHealth: vi.fn(),
    getFeedAuthorizationHeader: vi.fn(),
  },
}));

describe("PackageFeedHealthNotifier", () => {
  beforeEach(() => {
    vscodeMock.__resetVscodeMock();
    vi.mocked(NuGetClient.checkFeedHealth).mockReset();
    vi.mocked(NuGetClient.getFeedAuthorizationHeader)
      .mockReset()
      .mockResolvedValue({
        authorizationHeader: "Basic token",
        providerFound: true,
      });
  });

  it("checks only enabled HTTP feeds and skips healthy feeds", async () => {
    vi.mocked(NuGetClient.checkFeedHealth).mockResolvedValue({ ok: true });
    const notifier = new PackageFeedHealthNotifier(logger() as never, settings);

    await notifier.check([
      { id: "local", name: "Local", url: "c:/packages", enabled: true },
      {
        id: "disabled",
        name: "Disabled",
        url: "https://disabled",
        enabled: false,
      },
      { id: "nuget", name: "nuget.org", url: "https://nuget", enabled: true },
    ]);

    expect(NuGetClient.checkFeedHealth).toHaveBeenCalledTimes(1);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it("warns once for failing feeds without auth errors", async () => {
    vi.mocked(NuGetClient.checkFeedHealth).mockResolvedValue({
      ok: false,
      error: "offline",
    });
    const log = logger();
    const onAuthenticated = vi.fn();
    const notifier = new PackageFeedHealthNotifier(
      log as never,
      settings,
      onAuthenticated,
    );
    const feed = {
      id: "nuget",
      name: "nuget.org",
      url: "https://nuget",
      enabled: true,
    };

    await notifier.check([feed]);
    await notifier.check([feed]);

    expect(log.warning).toHaveBeenCalledWith(
      "nuget.feed",
      "Could not connect to nuget.org: offline",
    );
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
  });

  it("warns when a credential provider is missing", async () => {
    vi.mocked(NuGetClient.checkFeedHealth).mockResolvedValue({
      ok: false,
      error: "Credential Provider was not found",
    });
    const notifier = new PackageFeedHealthNotifier(logger() as never, settings);

    await notifier.check([
      {
        id: "private",
        name: "Private",
        url: "https://packages.example.test/feed/index.json",
        enabled: true,
        hasCredentials: false,
      },
    ]);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'A NuGet credential provider is required to connect to "Private" without NuGet.config credentials.',
    );
  });

  it("authenticates credential providers in the background", async () => {
    vi.mocked(NuGetClient.checkFeedHealth).mockResolvedValue({
      ok: false,
      error: "401",
    });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      "Authenticate NuGet feed" as never,
    );
    const log = logger();
    const onAuthenticated = vi.fn();
    const notifier = new PackageFeedHealthNotifier(
      log as never,
      settings,
      onAuthenticated,
    );
    const feed = {
      id: "private",
      name: "Private",
      url: "https://packages.example.test/feed/index.json",
      enabled: true,
      hasCredentials: false,
    };

    await notifier.check([feed]);

    expect(NuGetClient.getFeedAuthorizationHeader).toHaveBeenCalledWith(
      expect.objectContaining({
        feed,
        interactive: true,
        logger: log,
        retry: true,
        settings: settings(),
      }),
    );
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Authenticated NuGet feed "Private".',
    );
    expect(onAuthenticated).toHaveBeenCalledWith(feed);
  });
});

function settings() {
  return { dotnetPath: "dotnet" } as never;
}

function logger() {
  return {
    warning: vi.fn(),
  };
}
